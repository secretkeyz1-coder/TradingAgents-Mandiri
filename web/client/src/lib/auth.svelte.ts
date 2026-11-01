// Who is signed in. The server says whether a login is needed at all (none
// without APP_PASSWORD, as in local development) and keeps the session in an
// HttpOnly cookie, so this side only asks and reacts. Sign-up, the links sent
// by e-mail (verify, new password) and Google sign-in end up here too.

import type { Account } from './api';

type Session = { auth: boolean; user: Account | null };
/** What the server offers on the login page (server/src/auth.ts). */
export type AuthConfig = { signup: boolean; google: boolean; mail: boolean; trialDays: number };
type Notice = { text: string; tone: 'success' | 'error' | 'info' };

/** The ?notice=… a server redirect leaves in the address after a link or Google sign-in. */
const NOTICES: Record<string, Notice> = {
  'trial-started': { text: 'Email terverifikasi. Trial Pro kamu sudah aktif.', tone: 'success' },
  'email-verified': { text: 'Email terverifikasi.', tone: 'success' },
  'verify-failed': { text: 'Tautan verifikasi sudah kedaluwarsa atau sudah dipakai. Kirim ulang dari menu Profil.', tone: 'error' },
  'email-taken': { text: 'Email itu sudah dipakai akun lain.', tone: 'error' },
  'google-failed': { text: 'Masuk dengan Google gagal. Coba lagi.', tone: 'error' },
  'google-cancelled': { text: 'Masuk dengan Google dibatalkan.', tone: 'info' },
  'google-off': { text: 'Masuk dengan Google belum diaktifkan di server ini.', tone: 'info' },
  'signup-closed': { text: 'Pendaftaran belum dibuka. Minta akses ke admin.', tone: 'info' },
  'account-disabled': { text: 'Akun ini dinonaktifkan. Hubungi admin.', tone: 'error' },
};

class Auth {
  /** 'checking' until the first answer; 'out' shows the login page. */
  state = $state<'checking' | 'in' | 'out'>('checking');
  enabled = $state(false);
  user = $state<Account | null>(null);
  isAdmin = $derived(this.user?.role === 'admin');
  /** Set when the session check itself failed (server down), not when signed out. */
  error = $state('');
  config = $state<AuthConfig>({ signup: false, google: false, mail: false, trialDays: 7 });
  /** A message from the link that opened the page, shown once. */
  notice = $state<Notice | null>(null);
  /**
   * The ticket the server hands over when the password (or Google, or a reset link)
   * was right but the account has two-step sign-in: the code step still has to pass.
   */
  challenge = $state<string | null>(null);

  /** Takes ?notice=… out of the address, so a reload does not show it again. */
  takeNotice() {
    const at = location.hash.indexOf('?');
    if (at < 0) return;
    const q = new URLSearchParams(location.hash.slice(at + 1));
    const code = q.get('notice');
    if (!code) return;
    this.notice = NOTICES[code] ?? null;
    q.delete('notice');
    const rest = q.toString();
    history.replaceState(null, '', `${location.pathname}${location.hash.slice(0, at)}${rest ? `?${rest}` : ''}`);
  }

  async check() {
    try {
      const res = await fetch('/api/session');
      if (res.status === 401) {
        this.enabled = true;
        await this.loadConfig();
        this.state = 'out';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#signedIn(await res.json());
    } catch (e) {
      this.error = `Server tidak bisa dihubungi (${(e as Error).message}).`;
      this.state = 'out';
    }
  }

  async loadConfig() {
    try {
      const res = await fetch('/api/auth/config');
      if (res.ok) this.config = await res.json();
    } catch {
      /* the login form works without the extras */
    }
  }

  async #post(path: string, body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({ error: `HTTP ${res.status}` })) };
    } catch (e) {
      return { ok: false, status: 0, body: { error: `Server tidak bisa dihubungi (${(e as Error).message}).` } };
    }
  }

  /** Each returns an error message, or '' when it worked; with two-step sign-in, '' leaves a challenge to answer. */
  async login(username: string, password: string): Promise<string> {
    const r = await this.#post('/api/login', { username, password });
    if (!r.ok) return String(r.body.error ?? 'Gagal masuk');
    this.error = '';
    if (r.body.twoFactor) this.challenge = String(r.body.ticket);
    else this.#signedIn(r.body as Session);
    return '';
  }

  /** The code step: a code from the authenticator app or a recovery code. The page reloads into the app after it. */
  async verify(code: string): Promise<string> {
    const r = await this.#post('/api/login/2fa', { ticket: this.challenge, code });
    // 410: the ticket ran out; the password step starts over.
    if (r.status === 410) this.challenge = null;
    return r.ok ? '' : String(r.body.error ?? 'Gagal memeriksa kode');
  }

  async signup(form: { email: string; password: string; phone: string; acceptTerms: boolean }): Promise<string> {
    const r = await this.#post('/api/signup', { ...form, phone: form.phone || undefined });
    if (!r.ok) return String(r.body.error ?? 'Gagal mendaftar');
    this.#signedIn(r.body as Session);
    return '';
  }

  async forgot(email: string): Promise<string> {
    const r = await this.#post('/api/password/forgot', { email });
    return r.ok ? '' : String(r.body.error ?? 'Gagal mengirim');
  }

  async reset(token: string, password: string): Promise<string> {
    const r = await this.#post('/api/password/reset', { token, password });
    if (r.ok && r.body.twoFactor) this.challenge = String(r.body.ticket);
    return r.ok ? '' : String(r.body.error ?? 'Gagal menyimpan');
  }

  async logout() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    // A fresh page drops every store, stream and cached answer of the session.
    location.reload();
  }

  /** An API call answered 401 mid-session: the cookie expired or the password changed. */
  expired() {
    if (this.state === 'in' && this.enabled) location.reload();
  }

  #signedIn(session: Session) {
    this.enabled = session.auth;
    this.user = session.user;
    this.state = 'in';
  }
}

export const auth = new Auth();
