import { track } from "@vercel/analytics/react";
import { useEffect, useRef } from "react";

const HEARTBEAT_INTERVAL_MS = 30_000;

type UserLike =
  | {
      id?: number;
      role?: "user" | "admin";
      loginMethod?: string | null;
    }
  | null
  | undefined;

function getUserType(user: UserLike): "anonymous" | "guest" | "member" | "admin" {
  if (!user?.id) return "anonymous";
  if (user.role === "admin") return "admin";
  if (user.loginMethod === "guest") return "guest";
  return "member";
}

export function useVercelAnalytics(path: string, user: UserLike) {
  const currentPathRef = useRef(path);
  const activeMsRef = useRef(0);
  const interactionCountRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const visibleRef = useRef(typeof document !== "undefined" ? !document.hidden : true);
  const focusedRef = useRef(typeof document !== "undefined" ? document.hasFocus() : true);

  const userType = getUserType(user);

  const updateActiveMs = () => {
    const now = Date.now();
    const delta = Math.max(0, now - lastTickRef.current);
    if (visibleRef.current && focusedRef.current) {
      activeMsRef.current += delta;
    }
    lastTickRef.current = now;
  };

  const flushEngagement = (reason: string) => {
    updateActiveMs();
    const activeSeconds = Math.round(activeMsRef.current / 1000);
    const interactions = interactionCountRef.current;
    if (activeSeconds <= 0 && interactions <= 0 && reason !== "route_change") return;
    track("engagement", {
      path: currentPathRef.current,
      reason,
      userType,
      activeSeconds,
      interactions,
    });
    activeMsRef.current = 0;
    interactionCountRef.current = 0;
  };

  useEffect(() => {
    flushEngagement("route_change");
    currentPathRef.current = path;
    track("app_route_view", { path, userType });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, userType]);

  useEffect(() => {
    const handleInteraction = () => {
      interactionCountRef.current += 1;
    };
    const handleVisibilityChange = () => {
      updateActiveMs();
      visibleRef.current = !document.hidden;
      if (!visibleRef.current) {
        flushEngagement("hidden");
      }
    };
    const handleFocus = () => {
      updateActiveMs();
      focusedRef.current = true;
    };
    const handleBlur = () => {
      updateActiveMs();
      focusedRef.current = false;
      flushEngagement("blur");
    };
    const handleBeforeUnload = () => {
      flushEngagement("unload");
    };

    const interval = window.setInterval(() => {
      flushEngagement("heartbeat");
    }, HEARTBEAT_INTERVAL_MS);

    window.addEventListener("click", handleInteraction, { passive: true });
    window.addEventListener("keydown", handleInteraction);
    window.addEventListener("pointerdown", handleInteraction, { passive: true });
    window.addEventListener("touchstart", handleInteraction, { passive: true });
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("pointerdown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      flushEngagement("unmount");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
