const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPE = "openid email profile";
const GOOGLE_REDIRECT_PATH = "/login";
const GOOGLE_REDIRECT_URI_ENV = (import.meta.env.VITE_GOOGLE_OAUTH_REDIRECT_URI ?? "").trim();
const GOOGLE_CANONICAL_REDIRECT_URI = "https://numbering.pro/login";
const GOOGLE_STATE_STORAGE_KEY = "numbering_google_oauth_state";
const GOOGLE_STATE_FALLBACK_STORAGE_KEY = "numbering_google_oauth_state_fallback";
const GOOGLE_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function base64Encode(input: string): string {
  const utf8 = encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return btoa(utf8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeStateValue(input: string): string {
  return input.trim().replace(/ /g, "+");
}

function base64Decode(input: string): string {
  const normalized = normalizeStateValue(input).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const escaped = Array.from(binary)
    .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .join("");
  return decodeURIComponent(escaped);
}

function sanitizeReturnTo(path: string | null | undefined): string {
  if (!path) return "/";
  if (!path.startsWith("/")) return "/";
  if (path.startsWith("//")) return "/";
  return path;
}

function parseGoogleStateUnsafe(state: string): { returnTo?: string; issuedAt?: number; nonce?: string } | null {
  try {
    return JSON.parse(base64Decode(state)) as { returnTo?: string; issuedAt?: number; nonce?: string };
  } catch {
    return null;
  }
}

export function buildGoogleState(returnTo: string): string {
  return base64Encode(
    JSON.stringify({
      returnTo: sanitizeReturnTo(returnTo),
      issuedAt: Date.now(),
      nonce: Math.random().toString(36).slice(2),
    })
  );
}

export function parseGoogleStateReturnTo(state: string | null | undefined): string {
  if (!state) return "/";
  const decoded = parseGoogleStateUnsafe(state);
  return sanitizeReturnTo(decoded?.returnTo);
}

export function storeGoogleOAuthState(state: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(GOOGLE_STATE_STORAGE_KEY, state);
  } catch {
    // ignore
  }
  try {
    window.localStorage.setItem(GOOGLE_STATE_FALLBACK_STORAGE_KEY, state);
  } catch {
    // ignore
  }
}

export function consumeGoogleOAuthState(state: string | null | undefined): boolean {
  if (!state || typeof window === "undefined") return false;
  const normalizedState = normalizeStateValue(state);
  let matched = false;
  try {
    const expected = window.sessionStorage.getItem(GOOGLE_STATE_STORAGE_KEY);
    const fallback = window.localStorage.getItem(GOOGLE_STATE_FALLBACK_STORAGE_KEY);
    window.sessionStorage.removeItem(GOOGLE_STATE_STORAGE_KEY);
    window.localStorage.removeItem(GOOGLE_STATE_FALLBACK_STORAGE_KEY);
    matched = expected === normalizedState || fallback === normalizedState;
  } catch {
    return false;
  }
  if (!matched) return false;

  const decoded = parseGoogleStateUnsafe(normalizedState);
  if (!decoded || typeof decoded.issuedAt !== "number") return false;
  const age = Date.now() - decoded.issuedAt;
  if (age < -60_000 || age > GOOGLE_STATE_MAX_AGE_MS) return false;
  if (!decoded.nonce || decoded.nonce.length < 8) return false;
  return true;
}

export function startGoogleOAuthLogin(input: {
  clientId: string;
  returnTo: string;
}) {
  const clientId = input.clientId.trim();
  if (!clientId) {
    throw new Error("Google OAuth clientId가 비어 있습니다.");
  }

  const redirectUri = getGoogleRedirectUri();
  const state = buildGoogleState(input.returnTo);
  storeGoogleOAuthState(state);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "online",
    prompt: "select_account",
    state,
  });
  window.location.assign(`${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`);
}

export function getGoogleRedirectUri(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname.toLowerCase();
    const isCanonicalHost = host === "numbering.pro" || host === "www.numbering.pro";
    const isRailwayHost = host.endsWith(".up.railway.app");
    if (isCanonicalHost || isRailwayHost) {
      return GOOGLE_CANONICAL_REDIRECT_URI;
    }
  }
  if (GOOGLE_REDIRECT_URI_ENV) return GOOGLE_REDIRECT_URI_ENV;
  return `${window.location.origin}${GOOGLE_REDIRECT_PATH}`;
}
