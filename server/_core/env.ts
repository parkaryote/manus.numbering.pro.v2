function parseBooleanEnv(value: string | undefined, defaultValue = false): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleOAuthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  partialDentureDemoPassword: process.env.PARTIAL_DENTURE_DEMO_PASSWORD ?? "",
  sessionCookieSameSite: (process.env.SESSION_COOKIE_SAMESITE ?? "lax").trim().toLowerCase(),
  siteGatePassword: process.env.SITE_GATE_PASSWORD ?? "",
  signupAccessPassword: process.env.SIGNUP_ACCESS_PASSWORD ?? "",
  telemetryExcludedIps: parseCsvEnv(process.env.TELEMETRY_EXCLUDED_IPS),
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  allowDemoPublishing: parseBooleanEnv(process.env.ALLOW_DEMO_PUBLISHING, false),
  // Safety-first default:
  // keep user/demo content unless an explicit delete action is requested.
  dataSafetyMode: parseBooleanEnv(process.env.DATA_SAFETY_MODE, true),
};
