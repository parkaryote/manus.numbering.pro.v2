import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

const AUTH_CONTEXT_TIMEOUT_MS = Number(
  process.env.AUTH_CONTEXT_TIMEOUT_MS ?? "1200"
);

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const authPromise = sdk
    .authenticateRequest(opts.req)
    .then((resolvedUser) => resolvedUser)
    .catch(() => null);

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), AUTH_CONTEXT_TIMEOUT_MS);
  });

  const user = await Promise.race<User | null>([authPromise, timeoutPromise]);

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
