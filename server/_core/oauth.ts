import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const.js";
import * as db from "../db.js";
import { getSessionCookieOptions } from "./cookies.js";
import { sdk } from "./sdk.js";

type OAuthRequestLike = {
  query?: Record<string, unknown>;
};

type OAuthResponseLike = {
  status: (code: number) => { json: (payload: unknown) => void };
  cookie: (name: string, value: string, options?: Record<string, unknown>) => void;
  redirect: (status: number, path: string) => void;
};

type OAuthAppLike = {
  get: (
    path: string,
    handler: (req: OAuthRequestLike, res: OAuthResponseLike) => Promise<void> | void
  ) => void;
};

function getQueryParam(req: OAuthRequestLike, key: string): string | undefined {
  const value = req.query?.[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: OAuthAppLike) {
  const handleOAuthCallback = async (req: OAuthRequestLike, res: OAuthResponseLike) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req as any);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  };

  app.get("/api/oauth/callback", handleOAuthCallback);
  app.get("/oauth/callback", handleOAuthCallback);
}
