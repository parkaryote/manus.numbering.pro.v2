import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "../../shared/const.js";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

const AUTH_CONTEXT_TIMEOUT_MS = Number(process.env.AUTH_CONTEXT_TIMEOUT_MS ?? "12000");

function getRawCookieHeader(req: CreateExpressContextOptions["req"]): string {
  const reqLike = req as unknown as {
    headers?: { cookie?: string | string[] };
    get?: (name: string) => string | string[] | undefined;
  };
  const raw = reqLike.headers?.cookie ?? reqLike.get?.("cookie");
  if (!raw) return "";
  return Array.isArray(raw) ? raw.join("; ") : raw;
}

function hasSessionCookie(req: CreateExpressContextOptions["req"]): boolean {
  const cookieHeader = getRawCookieHeader(req);
  if (!cookieHeader) return false;
  try {
    const parsed = parseCookieHeader(cookieHeader);
    return typeof parsed[COOKIE_NAME] === "string" && parsed[COOKIE_NAME].length > 0;
  } catch {
    return cookieHeader.includes(`${COOKIE_NAME}=`);
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  if (!hasSessionCookie(opts.req)) {
    return {
      req: opts.req,
      res: opts.res,
      user: null,
    };
  }

  const authPromise = sdk
    .authenticateRequest(opts.req)
    .then((resolvedUser) => resolvedUser)
    .catch(() => null);

  let user: User | null;
  if (AUTH_CONTEXT_TIMEOUT_MS > 0) {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), AUTH_CONTEXT_TIMEOUT_MS);
    });
    user = await Promise.race<User | null>([authPromise, timeoutPromise]);
  } else {
    user = await authPromise;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
