import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { getOrCreateAnalyticsSessionId } from "@/lib/analyticsSession";

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_EVENTS_PER_BATCH = 60;

type TelemetryEventInput = {
  sessionId: string;
  path: string;
  eventType: string;
  activeMs?: number;
  interactionCount?: number;
  visible?: boolean;
  occurredAt?: string;
  payload?: unknown;
};

export function useBetaTelemetry(
  user: { id?: number } | null | undefined,
  path: string
) {
  const ingest = trpc.telemetry.ingest.useMutation();
  const sessionIdRef = useRef<string>(getOrCreateAnalyticsSessionId());
  const activeMsRef = useRef(0);
  const interactionCountRef = useRef(0);
  const pendingEventsRef = useRef<TelemetryEventInput[]>([]);
  const lastTickAtRef = useRef<number>(Date.now());
  const currentPathRef = useRef<string>(path);
  const visibleRef = useRef<boolean>(typeof document !== "undefined" ? !document.hidden : true);
  const focusedRef = useRef<boolean>(typeof document !== "undefined" ? document.hasFocus() : true);

  const isEnabled = Boolean(user?.id);

  const enqueueEvent = (eventType: string, payload?: unknown) => {
    pendingEventsRef.current.push({
      sessionId: sessionIdRef.current,
      path: currentPathRef.current,
      eventType,
      visible: visibleRef.current,
      occurredAt: new Date().toISOString(),
      ...(payload === undefined ? {} : { payload }),
    });
  };

  const updateActiveMs = () => {
    const now = Date.now();
    const delta = Math.max(0, now - lastTickAtRef.current);
    if (visibleRef.current && focusedRef.current) {
      activeMsRef.current += delta;
    }
    lastTickAtRef.current = now;
  };

  const flush = (eventType: string, force = false) => {
    if (!isEnabled) return;
    updateActiveMs();

    const activeMs = Math.max(0, Math.round(activeMsRef.current));
    const interactionCount = Math.max(0, interactionCountRef.current);

    const hasHeartbeatPayload = activeMs > 0 || interactionCount > 0;
    if (hasHeartbeatPayload || force) {
      pendingEventsRef.current.push({
        sessionId: sessionIdRef.current,
        path: currentPathRef.current,
        eventType,
        activeMs,
        interactionCount,
        visible: visibleRef.current,
        occurredAt: new Date().toISOString(),
      });
      activeMsRef.current = 0;
      interactionCountRef.current = 0;
    }

    const batch = pendingEventsRef.current.splice(0, MAX_EVENTS_PER_BATCH);
    if (batch.length === 0) return;
    ingest.mutate({ events: batch });
  };

  useEffect(() => {
    currentPathRef.current = path;
    if (!isEnabled) return;
    enqueueEvent("route_change", { path });
    flush("page_view", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, isEnabled]);

  useEffect(() => {
    if (!isEnabled) return;

    const handleInteraction = () => {
      interactionCountRef.current += 1;
    };

    const handleVisibilityChange = () => {
      updateActiveMs();
      visibleRef.current = !document.hidden;
      flush("visibility_change", true);
    };

    const handleFocus = () => {
      updateActiveMs();
      focusedRef.current = true;
    };

    const handleBlur = () => {
      updateActiveMs();
      focusedRef.current = false;
      flush("window_blur", true);
    };

    const handleBeforeUnload = () => {
      flush("before_unload", true);
    };

    const interval = window.setInterval(() => {
      flush("heartbeat");
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
      flush("unmount", true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnabled]);
}
