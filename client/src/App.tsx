import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SiteGate, useSiteAccess } from "./components/SiteGate";
import { trpc } from "./lib/trpc";
import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Subjects from "./pages/Subjects";
import Questions from "./pages/Questions";
import Practice from "./pages/Practice";
import Test from "./pages/Test";
import Statistics from "./pages/Statistics";
import Demo from "./pages/Demo";
import AdminDemoManagement from "./pages/AdminDemoManagement";
import SubjectExam from "./pages/SubjectExam";
import Login from "./pages/Login";
import SharedSubject from "./pages/SharedSubject";
import { useBetaTelemetry } from "./hooks/useBetaTelemetry";
import { useVercelAnalytics } from "./hooks/useVercelAnalytics";

const GUEST_ID_KEY = "numbering_guest_id";
const RECENT_AUTH_AT_KEY = "numbering_recent_auth_at";
const INIT_MAX_WAIT_MS = 2_500;
const AUTH_ME_FETCH_TIMEOUT_MS = 5_000;
const RECENT_AUTH_GRACE_MS = 20_000;
const DEMO_PUBLISHING_ENABLED = import.meta.env.VITE_ALLOW_DEMO_PUBLISHING === "true";
const PARTIAL_DENTURE_SUBJECT_NAME = "국소의치학";
const PARTIAL_DENTURE_DEMO_PASSWORD = "우파교수";
const PARTIAL_DENTURE_DEMO_UNLOCK_KEY = "demo_unlock_partial_denture";
const UNLOCK_KEY_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;

type PartialDentureUnlockRecord = {
  at: number;
  version: number;
};

function normalizePartialDentureUnlock(value: string | null): PartialDentureUnlockRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed && Number.isFinite(parsed.at)) {
      return { at: parsed.at, version: Number(parsed.version) || 1 };
    }
  } catch {
    // 호환성을 위해 과거 숫자 문자열 처리
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return { at: numeric, version: 1 };
}

function isPartialDentureUnlockedNow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(PARTIAL_DENTURE_DEMO_UNLOCK_KEY);
    const parsed = normalizePartialDentureUnlock(raw);
    if (!parsed) return false;
    if (parsed.at <= 0) return false;
    if (!Number.isFinite(parsed.at)) return false;
    if (Date.now() - parsed.at > UNLOCK_KEY_TIMEOUT_MS) {
      localStorage.removeItem(PARTIAL_DENTURE_DEMO_UNLOCK_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function setPartialDentureUnlock() {
  if (typeof window === "undefined") return;
  const payload: PartialDentureUnlockRecord = {
    at: Date.now(),
    version: 1,
  };
  localStorage.setItem(PARTIAL_DENTURE_DEMO_UNLOCK_KEY, JSON.stringify(payload));
}

async function fetchAuthMeWithTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D", {
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0]?.result?.data?.json ?? null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function getOrCreateGuestId(): string {
  try {
    let guestId = localStorage.getItem(GUEST_ID_KEY);
    if (!guestId) {
      guestId = Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
      localStorage.setItem(GUEST_ID_KEY, guestId);
    }
    return guestId;
  } catch {
    return Math.random().toString(36).substring(2, 11);
  }
}

function hasRecentAuthAttempt(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(RECENT_AUTH_AT_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at) || at <= 0) return false;
    return Date.now() - at <= RECENT_AUTH_GRACE_MS;
  } catch {
    return false;
  }
}

function clearRecentAuthAttempt() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(RECENT_AUTH_AT_KEY);
  } catch {
    // ignore
  }
}

function isGuestUser(user: { loginMethod?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return user.loginMethod === "guest";
}

/**
 * 레이아웃 선택 헬퍼: 로그인 전후 동일 UX를 위해 DashboardLayout 통일
 */
function Layout({
  children,
}: {
  children: React.ReactNode;
  user?: { loginMethod?: string | null } | null | undefined;
  onAuthSuccess?: () => void;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}

function RouteRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);

  return null;
}

function hashSeedToInt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandomFactory(seed: string): () => number {
  let a = hashSeedToInt(seed) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleBySeed<T>(items: T[], seed: string): T[] {
  if (items.length <= 1) return [...items];
  const result = [...items];
  const random = seededRandomFactory(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function SubjectPracticeRedirect({ subjectId }: { subjectId: number }) {
  const [, setLocation] = useLocation();
  const { data: questions } = trpc.questions.listBySubject.useQuery(
    { subjectId },
    { enabled: Number.isFinite(subjectId) }
  );

  useEffect(() => {
    if (!questions) return;
    if (questions.length === 0) {
      setLocation(`/questions/${subjectId}`);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const queryId = Number(params.get("q"));
    const isRandomMode = params.get("random") !== "0";
    const hasQueryTarget = Number.isFinite(queryId) && questions.some((q) => q.id === queryId);
    if (isRandomMode) {
      const providedSeed = (params.get("seed") || "").trim();
      const seed = providedSeed || `${subjectId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const ordered = shuffleBySeed(questions, seed);
      const targetQuestionId = hasQueryTarget ? queryId : ordered[0].id;
      setLocation(`/practice/${targetQuestionId}?scrollNav=1&random=1&seed=${encodeURIComponent(seed)}`);
      return;
    }

    const targetQuestionId = hasQueryTarget ? queryId : questions[0].id;
    setLocation(`/practice/${targetQuestionId}?scrollNav=1`);
  }, [questions, setLocation, subjectId]);

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-muted-foreground text-sm">랜덤 연습 여는 중...</div>
    </div>
  );
}

function resolveMappedSubjectId(
  demoSubjectId: number,
  userSubjects: Array<{ id: number; name: string; demoSourceSubjectId?: number | null }> | undefined,
  demoSubjects: Array<{ id: number; name: string }> | undefined
): number | null {
  if (!Number.isFinite(demoSubjectId)) return null;
  if (!userSubjects || userSubjects.length === 0) return null;

  const byId = userSubjects.find((subject) => subject.id === demoSubjectId);
  if (byId) return byId.id;

  const bySource = userSubjects.find(
    (subject) => subject.demoSourceSubjectId === demoSubjectId
  );
  if (bySource) return bySource.id;

  const demoSubject = demoSubjects?.find((subject) => subject.id === demoSubjectId);
  if (!demoSubject) return null;

  const byName = userSubjects.find((subject) => subject.name === demoSubject.name);
  return byName?.id ?? null;
}

function DemoSubjectRouteBridge({
  demoSubjectId,
  target,
}: {
  demoSubjectId: number;
  target: "questions" | "subject-exam";
}) {
  const [, setLocation] = useLocation();
  const [retriedOnce, setRetriedOnce] = useState(false);
  const subjectsQuery = trpc.subjects.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const demoSubjectsQuery = trpc.demo.subjects.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const mappedSubjectId = resolveMappedSubjectId(
    demoSubjectId,
    (subjectsQuery.data as Array<{ id: number; name: string; demoSourceSubjectId?: number | null }> | undefined) ?? undefined,
    (demoSubjectsQuery.data as Array<{ id: number; name: string }> | undefined) ?? undefined
  );

  useEffect(() => {
    if (!mappedSubjectId) return;
    const params = new URLSearchParams();
    params.set("demo", "1");
    params.set("demoSubjectId", String(demoSubjectId));
    setLocation(`/${target}/${mappedSubjectId}?${params.toString()}`);
  }, [demoSubjectId, mappedSubjectId, setLocation, target]);

  useEffect(() => {
    if (mappedSubjectId) return;
    if (subjectsQuery.isLoading) return;
    if (retriedOnce) return;
    setRetriedOnce(true);
    void subjectsQuery.refetch();
  }, [mappedSubjectId, retriedOnce, subjectsQuery]);

  const isLoading = subjectsQuery.isLoading || demoSubjectsQuery.isLoading || !retriedOnce;
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">데모 작업공간 연결 중...</div>
      </div>
    );
  }

  if (!mappedSubjectId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">개인 데모 과목을 찾지 못했습니다. 다시 시도해주세요.</div>
      </div>
    );
  }

  return null;
}

function DemoQuestionRouteBridge({
  demoQuestionId,
  target,
}: {
  demoQuestionId: number;
  target: "practice" | "test";
}) {
  const [, setLocation] = useLocation();
  const questionsQuery = trpc.questions.listAll.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const mappedQuestionId = useMemo(() => {
    if (!questionsQuery.data) return null;
    const bySource = questionsQuery.data.find(
      (question) => question.demoSourceQuestionId === demoQuestionId
    );
    if (bySource) return bySource.id;
    const byId = questionsQuery.data.find((question) => question.id === demoQuestionId);
    return byId?.id ?? null;
  }, [demoQuestionId, questionsQuery.data]);

  useEffect(() => {
    if (!mappedQuestionId) return;
    setLocation(`/${target}/${mappedQuestionId}`);
  }, [mappedQuestionId, setLocation, target]);

  if (questionsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">데모 문제 연결 중...</div>
      </div>
    );
  }

  if (!mappedQuestionId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">개인 데모 문제를 찾지 못했습니다.</div>
      </div>
    );
  }

  return null;
}

function DemoQuestionPasswordGate({
  questionId,
  children,
}: {
  questionId: number;
  children: React.ReactNode;
}) {
  const { data: question, isLoading, isError } = trpc.questions.getById.useQuery({ id: questionId });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">데모 문제 연결 중...</div>
      </div>
    );
  }

  if (!question || isError || !question.subjectId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">개인 데모 문제를 찾지 못했습니다.</div>
      </div>
    );
  }

  return (
    <DemoSubjectPasswordGate subjectId={question.subjectId}>
      {children}
    </DemoSubjectPasswordGate>
  );
}

function DemoSubjectPasswordGate({
  subjectId,
  children,
}: {
  subjectId: number;
  children: React.ReactNode;
}) {
  const { data: demoSubjects, isLoading } = trpc.demo.subjects.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unlocked, setUnlocked] = useState(() => {
    return isPartialDentureUnlockedNow();
  });

  const subjectName = useMemo(() => {
    const row = demoSubjects?.find((subject) => subject.id === subjectId);
    return (row?.name ?? "").trim();
  }, [demoSubjects, subjectId]);
  const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const requiresPassword = normalize(subjectName) === normalize(PARTIAL_DENTURE_SUBJECT_NAME);

  const handleUnlock = () => {
    if (password.trim() === PARTIAL_DENTURE_DEMO_PASSWORD) {
      setPartialDentureUnlock();
      setUnlocked(true);
      setPassword("");
      setError("");
      return;
    }
    setError("비밀번호가 올바르지 않습니다.");
  };

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PARTIAL_DENTURE_DEMO_UNLOCK_KEY) return;
      setUnlocked(isPartialDentureUnlockedNow());
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">데모 접근 확인 중...</div>
      </div>
    );
  }

  if (!requiresPassword || unlocked) {
    return <>{children}</>;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">{PARTIAL_DENTURE_SUBJECT_NAME} 접근 비밀번호</h2>
      <p className="text-xs text-muted-foreground">데모 과목을 열려면 비밀번호가 필요합니다.</p>
      <p className="text-[11px] text-muted-foreground/80">한 번 입력하면 데모 전 구간에서 기억됩니다.</p>
      <div className="space-y-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleUnlock();
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          placeholder="비밀번호 입력"
        />
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
        <button
          type="button"
          onClick={handleUnlock}
          className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-95 transition-opacity"
        >
          입장
        </button>
      </div>
    </div>
  );
}

function Router({
  user,
  onAuthSuccess,
}: {
  user: { loginMethod?: string | null; role?: "user" | "admin" } | null | undefined;
  onAuthSuccess?: () => void;
}) {
  const isAdmin = user?.role === "admin";
  const isGuest = !user || isGuestUser(user);
  const canAccessDemo = !user || isGuestUser(user) || isAdmin;

  return (
    <Switch>
      <Route path={"/"}>
        {isGuest ? (
          <Layout>
            <Demo />
          </Layout>
        ) : (
          <Layout>
            <Home />
          </Layout>
        )}
      </Route>
      <Route path={"/subjects"}>
        <Layout>
          <Subjects />
        </Layout>
      </Route>
      <Route path={"/questions/:subjectId"}>
        {(params) => (
          <Layout>
            <Questions subjectId={parseInt(params.subjectId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/subject-practice/:subjectId"}>
        {(params) => (
          <Layout>
            <SubjectPracticeRedirect subjectId={parseInt(params.subjectId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/subject-exam/:subjectId"}>
        {(params) => (
          <Layout>
            <SubjectExam subjectId={parseInt(params.subjectId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/practice/:questionId"}>
        {(params) => (
          <Layout>
            <Practice questionId={parseInt(params.questionId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/test/:questionId"}>
        {(params) => (
          <Layout>
            <Test questionId={parseInt(params.questionId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/statistics"}>
        {isGuest ? (
          <RouteRedirect to="/demo" />
        ) : (
          <Layout>
            <Statistics />
          </Layout>
        )}
      </Route>
      <Route path={"/demo"}>
        {canAccessDemo ? (
          <Layout>
            {isAdmin ? <Subjects demoWorkspace /> : <Demo />}
          </Layout>
        ) : (
          <RouteRedirect to="/subjects" />
        )}
      </Route>
      <Route path={"/login"}>
        <Login />
      </Route>
      <Route path={"/shared/:token"}>
        {(params) => <SharedSubject token={params.token} />}
      </Route>
      <Route path={"/demo/practice/:questionId"}>
        {(params) =>
          canAccessDemo ? (
            <Layout>
              <DemoQuestionPasswordGate questionId={parseInt(params.questionId)}>
                {isAdmin ? (
                  <Practice questionId={parseInt(params.questionId)} isDemo />
                ) : (
                  <Practice questionId={parseInt(params.questionId)} isDemo />
                )}
              </DemoQuestionPasswordGate>
            </Layout>
          ) : (
            <RouteRedirect to={`/practice/${parseInt(params.questionId)}`} />
          )
        }
      </Route>
      <Route path={"/demo/test/:questionId"}>
        {(params) =>
          canAccessDemo ? (
            <Layout>
              <DemoQuestionPasswordGate questionId={parseInt(params.questionId)}>
                {isAdmin ? (
                  <Test questionId={parseInt(params.questionId)} isDemo />
                ) : (
                  <Test questionId={parseInt(params.questionId)} isDemo />
                )}
              </DemoQuestionPasswordGate>
            </Layout>
          ) : (
            <RouteRedirect to={`/test/${parseInt(params.questionId)}`} />
          )
        }
      </Route>
      <Route path={"/demo/subject-exam/:subjectId"}>
        {(params) =>
          canAccessDemo ? (
            <Layout>
              <DemoSubjectPasswordGate subjectId={parseInt(params.subjectId)}>
                {isAdmin ? (
                  <SubjectExam subjectId={parseInt(params.subjectId)} isDemo />
                ) : (
                  <SubjectExam subjectId={parseInt(params.subjectId)} isDemo />
                )}
              </DemoSubjectPasswordGate>
            </Layout>
          ) : (
            <RouteRedirect to={`/subject-exam/${parseInt(params.subjectId)}`} />
          )
        }
      </Route>
      <Route path={"/demo/questions"}>
        <RouteRedirect to="/demo" />
      </Route>
      <Route path={"/demo/questions/"}>
        <RouteRedirect to="/demo" />
      </Route>
      <Route path={"/demo/questions/:subjectId"}>
        {(params) =>
          canAccessDemo ? (
            <Layout>
              <DemoSubjectPasswordGate subjectId={parseInt(params.subjectId)}>
                {isAdmin ? (
                  <Questions subjectId={parseInt(params.subjectId)} demoWorkspace />
                ) : (
                  <Questions subjectId={parseInt(params.subjectId)} isDemo />
                )}
              </DemoSubjectPasswordGate>
            </Layout>
          ) : (
            <RouteRedirect to="/subjects" />
          )
        }
      </Route>
      <Route path={"/admin/demo-management"}>
        {DEMO_PUBLISHING_ENABLED ? (
          <DashboardLayout>
            <AdminDemoManagement />
          </DashboardLayout>
        ) : (
          <RouteRedirect to="/subjects" />
        )}
      </Route>
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const autoGuestLogin = trpc.auth.autoGuestLogin.useMutation();
  const [location, setLocation] = useLocation();
  // 먼저 현재 세션 확인 (이미 로그인된 경우 게스트 로그인 건너뜀)
  const [initDone, setInitDone] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [guestBootstrapFailed, setGuestBootstrapFailed] = useState(false);
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: initDone,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: initDone && location !== "/login" && hasRecentAuthAttempt() ? 700 : false,
  });

  useBetaTelemetry(currentUser, location);
  useVercelAnalytics(location, currentUser);

  // 로그인/가입 성공 후 currentUser를 업데이트하는 함수 (reload 없이 레이아웃 전환)
  const handleAuthSuccess = async () => {
    try {
      const latest = await meQuery.refetch();
      setCurrentUser(latest.data ?? null);
      return;
    } catch { /* ignore */ }
    window.location.reload();
  };

  useEffect(() => {
    let cancelled = false;
    const safeSetInitDone = () => {
      if (!cancelled) setInitDone(true);
    };
    const initTimeout = window.setTimeout(() => {
      safeSetInitDone();
    }, INIT_MAX_WAIT_MS);

    async function init() {
      let authProbeFailed = false;
      try {
        // 1) 먼저 현재 세션 확인
        const user = await fetchAuthMeWithTimeout(AUTH_ME_FETCH_TIMEOUT_MS);
      if (user) {
        // 이미 로그인된 사용자(정식/게스트)면 게스트 재로그인 건너뜀
        setCurrentUser(user);
        if (!isGuestUser(user)) {
          clearRecentAuthAttempt();
        }
        safeSetInitDone();
        return;
      }
      } catch {
        // 일시적 네트워크/서버 지연 시 게스트 세션으로 덮어쓰지 않음
        authProbeFailed = true;
      }

      if (authProbeFailed) {
        safeSetInitDone();
        return;
      }

      // 2) 정식 계정이 없더라도 앱 진입을 막지 않는다.
      // 게스트 세션 부트스트랩은 아래 별도 effect에서 처리한다.
      safeSetInitDone();
    }
    init();
    return () => {
      cancelled = true;
      window.clearTimeout(initTimeout);
    };
  }, []);

  useEffect(() => {
    if (!initDone) return;
    if (meQuery.isLoading) return;
    setCurrentUser(meQuery.data ?? null);
    if (meQuery.data && !isGuestUser(meQuery.data)) {
      clearRecentAuthAttempt();
    }
  }, [initDone, meQuery.data, meQuery.isLoading]);

  useEffect(() => {
    if (!initDone) return;
    if (meQuery.isLoading) return;
    if (autoGuestLogin.isPending) return;
    if (guestBootstrapFailed) return;
    if (currentUser) return;
    if (location === "/login") return;
    if (hasRecentAuthAttempt()) return;

    const guestId = getOrCreateGuestId();
    autoGuestLogin.mutate(
      { guestId },
      {
        onSuccess: () => {
          void (async () => {
            try {
              const latest = await meQuery.refetch();
              setCurrentUser(latest.data ?? null);
            } catch {
              // ignore
            }
          })();
        },
        onError: () => {
          setGuestBootstrapFailed(true);
        },
      }
    );
  }, [
    autoGuestLogin,
    autoGuestLogin.isPending,
    currentUser,
    guestBootstrapFailed,
    initDone,
    location,
    meQuery,
    meQuery.isLoading,
  ]);

  if (!initDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">입장 중...</p>
        </div>
      </div>
    );
  }

  if (!currentUser && location !== "/login" && hasRecentAuthAttempt() && meQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">로그인 세션 확인 중...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Toaster />
      <Router user={currentUser} onAuthSuccess={handleAuthSuccess} />
    </TooltipProvider>
  );
}

function App() {
  // 접속 비밀번호 게이트 활성화 상태
  const TEMP_DISABLE_SITE_GATE = true;
  const { granted, grant } = useSiteAccess();
  const globalFooterNotice = (
    <p className="pointer-events-none fixed bottom-1.5 left-1/2 z-50 -translate-x-1/2 select-none text-[10px] text-muted-foreground/45">
      본 자료는 내부 학습용이며, 요청 시 삭제됩니다.
    </p>
  );

  if (!TEMP_DISABLE_SITE_GATE && !granted) {
    return (
      <ErrorBoundary>
        <ThemeProvider defaultTheme="light" switchable={false}>
          <SiteGate onGranted={grant} />
          {globalFooterNotice}
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable={true}>
        <AppContent />
        {globalFooterNotice}
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
