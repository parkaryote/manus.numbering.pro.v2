type RequestLike = {
  protocol?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type SessionCookieOptions = {
  domain?: string;
  httpOnly: boolean;
  path: string;
  sameSite: "lax" | "none";
  secure: boolean;
};

function isSecureRequest(req: RequestLike) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers?.["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

function getRequestHost(req: RequestLike): string {
  const forwardedHost = req.headers?.["x-forwarded-host"];
  const hostHeader = req.headers?.host;
  const raw = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) || "";
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.split(":")[0] ?? "";
}

export function getSessionCookieOptions(
  req: RequestLike
): SessionCookieOptions {
  const hostname = getRequestHost(req);
  const shouldSetSharedDomain =
    hostname === "numbering.pro" || hostname === "www.numbering.pro";

  const secure = isSecureRequest(req);

  return {
    domain: shouldSetSharedDomain ? ".numbering.pro" : undefined,
    httpOnly: true,
    path: "/",
    // SameSite=None requires Secure=true. On local http dev, use Lax so
    // browsers accept and persist the session cookie.
    sameSite: secure ? "none" : "lax",
    secure,
  };
}
