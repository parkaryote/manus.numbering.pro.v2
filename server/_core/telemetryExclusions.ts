import { ENV } from "./env.js";

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string | undefined };
};

function resolveHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function normalizeClientIp(rawValue: string | null | undefined): string {
  const value = (rawValue ?? "").trim().toLowerCase();
  if (!value) return "";
  const withoutForwardedList = value.split(",")[0]?.trim() ?? value;
  const withoutIpv6Prefix = withoutForwardedList.startsWith("::ffff:")
    ? withoutForwardedList.slice(7)
    : withoutForwardedList;
  return withoutIpv6Prefix;
}

export function resolveClientIp(req: RequestLike | null | undefined): string {
  if (!req) return "unknown";
  const forwardedFor = resolveHeaderValue(req.headers?.["x-forwarded-for"]);
  const forwarded = forwardedFor?.split(",")[0]?.trim();
  return normalizeClientIp(forwarded || req.ip || req.socket?.remoteAddress || "unknown");
}

export function isTelemetryExcludedRequest(req: RequestLike | null | undefined): boolean {
  const clientIp = resolveClientIp(req);
  if (!clientIp || clientIp === "unknown") return false;
  return ENV.telemetryExcludedIps.some((candidate) => normalizeClientIp(candidate) === clientIp);
}
