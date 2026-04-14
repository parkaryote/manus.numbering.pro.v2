const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPE = "openid email profile";
const GOOGLE_REDIRECT_PATH = "/login";

function base64Encode(input: string): string {
  const utf8 = encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return btoa(utf8);
}

function base64Decode(input: string): string {
  const binary = atob(input);
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
  try {
    const decoded = JSON.parse(base64Decode(state)) as { returnTo?: string };
    return sanitizeReturnTo(decoded?.returnTo);
  } catch {
    return "/";
  }
}

export function startGoogleOAuthLogin(input: {
  clientId: string;
  returnTo: string;
}) {
  const clientId = input.clientId.trim();
  if (!clientId) {
    throw new Error("Google OAuth clientId가 비어 있습니다.");
  }

  const redirectUri = `${window.location.origin}${GOOGLE_REDIRECT_PATH}`;
  const state = buildGoogleState(input.returnTo);
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

