// Two-step sign-in with an authenticator app: TOTP (RFC 6238; HMAC-SHA1,
// 30-second steps, six digits), which Google Authenticator, Authy, 1Password
// and the like read once from a QR code. Recovery codes, each good for one
// sign-in, cover a lost phone; only their hashes are kept.
import { createHash, createHmac, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;

/** A new secret: 20 random bytes in base32, as authenticator apps expect. */
export function newSecret(): string {
  let bits = "";
  for (const b of randomBytes(20)) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function decode(secret: string): Buffer {
  let bits = "";
  for (const ch of secret.toUpperCase()) {
    const v = ALPHABET.indexOf(ch);
    if (v >= 0) bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The six-digit code for one 30-second step. */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** The step a typed code belongs to, allowing a phone clock one step off either way; null when it matches none. */
export function matchStep(secret: string, code: string, now = Date.now()): number | null {
  const typed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const step = Math.floor(now / STEP_MS);
  for (const s of [step, step - 1, step + 1]) if (codeAt(secret, s) === typed) return s;
  return null;
}

/** What the authenticator app reads from the QR code. */
export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** A recovery code as stored: lower case, letters and digits only, hashed. */
export const hashRecovery = (code: string) => createHash("sha256").update(code.toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");

/** Recovery codes like "k7m2-9xq4", without look-alike characters; the hashes are what the database keeps. */
export function newRecoveryCodes(n = 8): { codes: string[]; hashes: string[] } {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: n }, () => {
    const s = Array.from(randomBytes(8), (b) => chars[b % chars.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}
