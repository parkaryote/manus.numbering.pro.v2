import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { Analytics } from "@vercel/analytics/react";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

// Declare gtag for TypeScript
declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

const GA4_MEASUREMENT_ID = (import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined)?.trim() ?? "";
const UMAMI_ENDPOINT = (import.meta.env.VITE_ANALYTICS_ENDPOINT as string | undefined)?.trim() ?? "";
const UMAMI_WEBSITE_ID = (import.meta.env.VITE_ANALYTICS_WEBSITE_ID as string | undefined)?.trim() ?? "";

function initAnalytics() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  if (UMAMI_ENDPOINT && UMAMI_WEBSITE_ID) {
    const umamiScript = document.createElement("script");
    umamiScript.defer = true;
    umamiScript.src = `${UMAMI_ENDPOINT.replace(/\/+$/, "")}/umami`;
    umamiScript.setAttribute("data-website-id", UMAMI_WEBSITE_ID);
    document.head.appendChild(umamiScript);
  }

  if (!GA4_MEASUREMENT_ID) {
    return;
  }

  const gaScript = document.createElement("script");
  gaScript.async = true;
  gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
    GA4_MEASUREMENT_ID
  )}`;
  document.head.appendChild(gaScript);

  window.dataLayer = window.dataLayer || [];
  window.gtag = (...args: any[]) => {
    window.dataLayer!.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA4_MEASUREMENT_ID, {
    anonymize_ip: true,
    allow_google_signals: false,
  });
}

initAnalytics();

const TRPC_FETCH_TIMEOUT_MS = 12000;
const TRPC_AUTH_FETCH_TIMEOUT_MS = 30000;
const TRPC_OCR_FETCH_TIMEOUT_MS = 180000;

function resolveTrpcTimeoutMs(input: RequestInfo | URL): number {
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  // OCR는 파일 업로드/원격 처리 시작에 시간이 걸릴 수 있으므로 별도 타임아웃을 사용한다.
  if (
    rawUrl.includes("/api/trpc/ocr.startJob") ||
    rawUrl.includes("/api/trpc/ocr.getStatus") ||
    rawUrl.includes("/api/trpc/ocr.getResult")
  ) {
    return TRPC_OCR_FETCH_TIMEOUT_MS;
  }

  // 로그인/세션 확인은 외부 OAuth + DB round trip으로 지연될 수 있다.
  if (rawUrl.includes("/api/trpc/auth.")) {
    return TRPC_AUTH_FETCH_TIMEOUT_MS;
  }

  return TRPC_FETCH_TIMEOUT_MS;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 60_000,
      gcTime: 10 * 60_000,
    },
    mutations: {
      retry: false,
    },
  },
});
const GUEST_ID_KEY = "numbering_guest_id";

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  const hasGuestId = Boolean(localStorage.getItem(GUEST_ID_KEY));
  if (hasGuestId) {
    // In guest mode, avoid hard redirects that can create reload loops.
    // App routing/layout already handles fallback to demo pages.
    return;
  }

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// Track page views with GA4
if (typeof window !== "undefined" && window.gtag) {
  window.gtag("event", "page_view", {
    page_path: window.location.pathname,
    page_title: document.title,
  });
}

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        const controller = new AbortController();
        const timeoutMs = resolveTrpcTimeoutMs(input);
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          signal: controller.signal,
        }).finally(() => {
          clearTimeout(timeout);
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
      <Analytics />
    </QueryClientProvider>
  </trpc.Provider>
);
