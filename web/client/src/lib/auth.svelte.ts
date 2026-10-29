// Who is signed in. The server says whether a login is needed at all (none
// without APP_PASSWORD, as in local development) and keeps the session in an
// HttpOnly cookie, so this side only asks and reacts.

type Session = { auth: boolean; user: string | null };

class Auth {
  /** 'checking' until the first answer; 'out' shows the login page. */
  state = $state<'checking' | 'in' | 'out'>('checking');
  enabled = $state(false);
  user = $state<string | null>(null);
  /** Set when the session check itself failed (server down), not when signed out. */
  error = $state('');

  async check() {
    try {
      const res = await fetch('/api/session');
      if (res.status === 401) {
        this.enabled = true;
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

  /** Returns an error message, or '' once signed in. */
  async login(username: string, password: string): Promise<string> {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return body.error ?? `HTTP ${res.status}`;
      this.error = '';
      this.#signedIn(body);
      return '';
    } catch (e) {
      return `Server tidak bisa dihubungi (${(e as Error).message}).`;
    }
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
