const SESSION_KEY = "numbering_beta_session_id";

function createSessionId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateAnalyticsSessionId() {
  if (typeof window === "undefined") return createSessionId();
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const next = createSessionId();
    window.sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return createSessionId();
  }
}

export function getAnalyticsRequestMeta() {
  if (typeof window === "undefined") {
    return {
      clientSessionId: createSessionId(),
      pagePath: "",
    };
  }

  return {
    clientSessionId: getOrCreateAnalyticsSessionId(),
    pagePath: `${window.location.pathname}${window.location.search}`,
  };
}
