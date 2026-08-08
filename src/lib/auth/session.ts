/**
 * Password-gate session handling for the mediasurface admin.
 *
 * Simple by design, per CLAUDE.md decision #6: server-side password gate,
 * HttpOnly signed session cookie, HMAC via Web Crypto. No per-user accounts
 * — everyone who knows the password shares the same session shape.
 *
 * Uses the Web Crypto API (crypto.subtle) rather than Node's `crypto` module
 * so this works unmodified in both Edge middleware and normal Node routes.
 */

export const SESSION_COOKIE_NAME = "ms_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 1 day

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET environment variable is not set. Generate one and add it " +
        "to the Vercel project's Environment Variables (Production + Preview)."
    );
  }
  return secret;
}

function getAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "ADMIN_PASSWORD environment variable is not set. Add it to the Vercel " +
        "project's Environment Variables (Production + Preview)."
    );
  }
  return password;
}

async function getSigningKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Constant-time-ish string comparison for the submitted password.
 * Not a full constant-time guarantee (early-outs on length mismatch), but
 * sufficient for a low-stakes two-person password gate.
 */
export function checkPassword(candidate: string): boolean {
  const expected = getAdminPassword();
  if (candidate.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Creates a signed session token: base64url(payload) + "." + base64url(HMAC signature). */
export async function createSessionToken(): Promise<string> {
  const payload = JSON.stringify({
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  });
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload));
  const key = await getSigningKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return `${payloadB64}.${toBase64Url(signature)}`;
}

/** Verifies a session token's signature and expiry. Never throws on bad input. */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<boolean> {
  if (!token) return false;

  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return false;

  try {
    const key = await getSigningKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(sigB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payloadB64))
    ) as { exp?: number };

    if (typeof payload.exp !== "number") return false;
    return Date.now() <= payload.exp;
  } catch {
    // Malformed token (bad base64, bad JSON, etc.) — treat as unauthenticated.
    return false;
  }
}
