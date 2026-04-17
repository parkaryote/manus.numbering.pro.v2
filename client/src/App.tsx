import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SiteGate, useSiteAccess } from "./components/SiteGate";
import { trpc } from "./lib/trpc";
import { useState, useEffect, useMemo, useRef } from "react";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Subjects from "./pages/Subjects";
import Questions from "./pages/Questions";
import Practice from "./pages/Practice";
import Test from "./pages/Test";
import Statistics from "./pages/Statistics";
import Demo from "./pages/Demo";
import SubjectExam from "./pages/SubjectExam";
import Login from "./pages/Login";
import SharedSubject from "./pages/SharedSubject";
import { useBetaTelemetry } from "./hooks/useBetaTelemetry";
import { useVercelAnalytics } from "./hooks/useVercelAnalytics";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";

const GUEST_ID_KEY = "numbering_guest_id";
const RECENT_AUTH_AT_KEY = "numbering_recent_auth_at";
const PARTIAL_DENTURE_SUBJECT_NAME = "국소의치학";
const PARTIAL_DENTURE_DEMO_UNLOCK_KEY = "numbering_demo_unlock_partial_denture_v1";
const INIT_MAX_WAIT_MS = 2_500;
const AUTH_ME_FETCH_TIMEOUT_MS = 2_000;
const GUEST_BOOTSTRAP_BLOCK_MAX_MS = 900;
const RECENT_AUTH_GRACE_MS = 10 * 60 * 1000;
const AUTH_RESOLVE_MAX_WAIT_MS = 8_000;
const DEMO_BRIDGE_RETRY_DELAY_MS = 450;
const DEMO_BRIDGE_MAX_ERROR_RETRIES = 8;

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

function normalizeClientSubjectName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function isPartialDentureSubjectNameClient(value: string | null | undefined): boolean {
  return normalizeClientSubjectName(value) === normalizeClientSubjectName(PARTIAL_DENTURE_SUBJECT_NAME);
}

function readPartialDentureDemoUnlockState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PARTIAL_DENTURE_DEMO_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function writePartialDentureDemoUnlockState(next: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (next) {
      window.localStorage.setItem(PARTIAL_DENTURE_DEMO_UNLOCK_KEY, "1");
    } else {
      window.localStorage.removeItem(PARTIAL_DENTURE_DEMO_UNLOCK_KEY);
    }
  } catch {
    // ignore storage failures
  }
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

function DemoSubjectRouteBridge({
  demoSubjectId,
  target,
}: {
  demoSubjectId: number;
  target: "questions" | "subject-exam";
}) {
  const [, setLocation] = useLocation();
  const guestId = useMemo(() => getOrCreateGuestId(), []);
  const [errorRetryCount, setErrorRetryCount] = useState(0);
  const resolveQuery = trpc.demo.resolveSubjectWorkspace.useQuery(
    { demoSubjectId, guestId },
    {
      refetchOnWindowFocus: false,
      retry: false,
    }
  );
  const mappedSubjectId = resolveQuery.data?.mappedSubjectId ?? null;
  const isPending = resolveQuery.data?.pending === true;

  useEffect(() => {
    if (mappedSubjectId || !isPending || resolveQuery.isLoading) {
      return;
    }
    const timer = window.setTimeout(() => {
      void resolveQuery.refetch();
    }, DEMO_BRIDGE_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isPending, mappedSubjectId, resolveQuery.isLoading, resolveQuery.refetch]);

  useEffect(() => {
    if (!resolveQuery.isError || mappedSubjectId) {
      if (errorRetryCount !== 0) setErrorRetryCount(0);
      return;
    }
    if (resolveQuery.isLoading) return;
    if (errorRetryCount >= DEMO_BRIDGE_MAX_ERROR_RETRIES) return;
    const timer = window.setTimeout(() => {
      setErrorRetryCount((count) => count + 1);
      void resolveQuery.refetch();
    }, DEMO_BRIDGE_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    errorRetryCount,
    mappedSubjectId,
    resolveQuery.isError,
    resolveQuery.isLoading,
    resolveQuery.refetch,
  ]);

  useEffect(() => {
    if (!mappedSubjectId) return;
    const params = new URLSearchParams();
    params.set("demo", "1");
    params.set("demoSubjectId", String(demoSubjectId));
    setLocation(`/${target}/${mappedSubjectId}?${params.toString()}`);
  }, [demoSubjectId, mappedSubjectId, setLocation, target]);

  const isAutoRetryingError = resolveQuery.isError && errorRetryCount < DEMO_BRIDGE_MAX_ERROR_RETRIES;
  const isLoading =
    resolveQuery.isLoading ||
    (!mappedSubjectId && (isPending || isAutoRetryingError));
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">데모 작업공간 연결 중...</div>
      </div>
    );
  }

  if (resolveQuery.isError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="space-y-2 text-center">
          <div className="text-muted-foreground text-sm">데모 작업공간 연결이 지연되고 있습니다.</div>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void resolveQuery.refetch()}>
              다시 시도
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLocation("/demo")}>
              데모 홈으로
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!mappedSubjectId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="space-y-2 text-center">
          <div className="text-muted-foreground text-sm">개인 데모 과목을 찾지 못했습니다.</div>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void resolveQuery.refetch()}>
              다시 시도
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLocation("/demo")}>
              데모 홈으로
            </Button>
          </div>
        </div>
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
  const guestId = useMemo(() => getOrCreateGuestId(), []);
  const [errorRetryCount, setErrorRetryCount] = useState(0);
  const resolveQuery = trpc.demo.resolveQuestionWorkspace.useQuery(
    { demoQuestionId, guestId },
    {
      refetchOnWindowFocus: false,
      retry: false,
    }
  );
  const mappedQuestionId = resolveQuery.data?.mappedQuestionId ?? null;
  const mappedDemoSubjectId = resolveQuery.data?.mappedDemoSubjectId ?? null;
  const isPending = resolveQuery.data?.pending === true;

  useEffect(() => {
    if (mappedQuestionId || !isPending || resolveQuery.isLoading) {
      return;
    }
    const timer = window.setTimeout(() => {
      void resolveQuery.refetch();
    }, DEMO_BRIDGE_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isPending, mappedQuestionId, resolveQuery.isLoading, resolveQuery.refetch]);

  useEffect(() => {
    if (!resolveQuery.isError || mappedQuestionId) {
      if (errorRetryCount !== 0) setErrorRetryCount(0);
      return;
    }
    if (resolveQuery.isLoading) return;
    if (errorRetryCount >= DEMO_BRIDGE_MAX_ERROR_RETRIES) return;
    const timer = window.setTimeout(() => {
      setErrorRetryCount((count) => count + 1);
      void resolveQuery.refetch();
    }, DEMO_BRIDGE_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    errorRetryCount,
    mappedQuestionId,
    resolveQuery.isError,
    resolveQuery.isLoading,
    resolveQuery.refetch,
  ]);

  useEffect(() => {
    if (!mappedQuestionId) return;
    const params = new URLSearchParams();
    params.set("demo", "1");
    if (mappedDemoSubjectId) {
      params.set("demoSubjectId", String(mappedDemoSubjectId));
    }
    if (target === "practice") {
      params.set("scrollNav", "1");
    }
    const query = params.toString();
    setLocation(`/${target}/${mappedQuestionId}${query ? `?${query}` : ""}`);
  }, [mappedDemoSubjectId, mappedQuestionId, setLocation, target]);

  const isAutoRetryingError = resolveQuery.isError && errorRetryCount < DEMO_BRIDGE_MAX_ERROR_RETRIES;
  const isLoading =
    resolveQuery.isLoading ||
    (!mappedQuestionId && (isPending || isAutoRetryingError));
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">데모 문제 연결 중...</div>
      </div>
    );
  }

  if (resolveQuery.isError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="space-y-2 text-center">
          <div className="text-muted-foreground text-sm">데모 문제 연결이 지연되고 있습니다.</div>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void resolveQuery.refetch()}>
              다시 시도
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLocation("/demo")}>
              데모 홈으로
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!mappedQuestionId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="space-y-2 text-center">
          <div className="text-muted-foreground text-sm">개인 데모 문제를 찾지 못했습니다.</div>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void resolveQuery.refetch()}>
              다시 시도
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLocation("/demo")}>
              데모 홈으로
            </Button>
          </div>
        </div>
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
  subjectId?: number;
  children: React.ReactNode;
}) {
  const [password, setPassword] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const hasValidSubjectId = Number.isFinite(subjectId) && Number(subjectId) > 0;
  const subjectQuery = trpc.subjects.getById.useQuery(
    { id: Number(subjectId) },
    {
      enabled: hasValidSubjectId,
      refetchOnWindowFocus: false,
      retry: false,
    }
  );
  const verifyPassword = trpc.demo.verifySubjectPassword.useMutation({
    onSuccess: () => {
      writePartialDentureDemoUnlockState(true);
      setIsUnlocked(true);
      setPassword("");
      toast.success("국소의치학 접근이 열렸습니다.");
    },
    onError: (error) => {
      toast.error(error.message || "비밀번호를 다시 확인해주세요.");
    },
  });

  useEffect(() => {
    setIsUnlocked(readPartialDentureDemoUnlockState());
    setStorageReady(true);
  }, []);

  const requiresPassword = isPartialDentureSubjectNameClient(subjectQuery.data?.name);

  useEffect(() => {
    if (!requiresPassword) {
      setIsUnlocked(true);
    }
  }, [requiresPassword]);

  if (!hasValidSubjectId) return <>{children}</>;

  if (!storageReady || subjectQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[56vh] px-4">
        <div className="text-muted-foreground text-sm">과목 접근 권한을 확인하는 중...</div>
      </div>
    );
  }

  if (subjectQuery.isError || !subjectQuery.data) {
    return (
      <div className="flex items-center justify-center min-h-[56vh] px-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="space-y-2">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <LockKeyhole className="h-5 w-5 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl">과목 정보를 확인할 수 없습니다</CardTitle>
            <CardDescription>새로고침 후 다시 시도해주세요.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!requiresPassword || isUnlocked) {
    return <>{children}</>;
  }

  const handleSubmit = () => {
    if (!password.trim()) {
      toast.error("비밀번호를 입력해주세요.");
      return;
    }
    verifyPassword.mutate({ subjectId: Number(subjectId), password });
  };

  return (
    <div className="flex items-center justify-center min-h-[56vh] px-4 py-10">
      <Card className="w-full max-w-md shadow-xl border-border/70">
        <CardHeader className="space-y-3">
          <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center">
            <LockKeyhole className="h-5 w-5 text-foreground" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl">국소의치학 데모 접근</CardTitle>
            <CardDescription>
              이 과목은 비밀번호 확인 후 열람할 수 있습니다.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="partial-denture-demo-password">비밀번호</Label>
            <Input
              id="partial-denture-demo-password"
              type="password"
              value={password}
              placeholder="비밀번호 입력"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>
          <Button
            className="w-full"
            disabled={verifyPassword.isPending}
            onClick={handleSubmit}
          >
            {verifyPassword.isPending ? "확인 중..." : "들어가기"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DemoMappedRoutePasswordGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [location] = useLocation();
  const demoSubjectId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") !== "1") return null;
    const raw = Number(params.get("demoSubjectId"));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }, [location]);

  if (!demoSubjectId) return <>{children}</>;
  return <DemoSubjectPasswordGate subjectId={demoSubjectId}>{children}</DemoSubjectPasswordGate>;
}

function Router({
  user,
  onAuthSuccess,
}: {
  user: { loginMethod?: string | null; role?: "user" | "admin" } | null | undefined;
  onAuthSuccess?: () => void;
}) {
  const [location] = useLocation();
  const isAdmin = user?.role === "admin";
  const isGuest = !user || isGuestUser(user);
  const shouldCheckEmptyState = Boolean(
    user && !isGuestUser(user) && (location === "/" || location === "/subjects")
  );
  const subjectCountQuery = trpc.subjects.count.useQuery(undefined, {
    enabled: shouldCheckEmptyState,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const subjectCountDecisionPending = shouldCheckEmptyState && subjectCountQuery.isLoading;
  const hasNoSubjects =
    shouldCheckEmptyState &&
    !subjectCountQuery.isLoading &&
    (subjectCountQuery.data ?? 0) <= 0;
  const shouldShowDemoHome = isGuest || hasNoSubjects;
  const canAccessDemo = !user || isGuestUser(user) || isAdmin || hasNoSubjects;

  return (
    <Switch>
      <Route path={"/subjects"}>
        <Layout>
          {subjectCountDecisionPending ? (
            <div className="py-12 text-center text-sm text-muted-foreground">과목 목록을 불러오는 중...</div>
          ) : (
            <Subjects />
          )}
        </Layout>
      </Route>
      <Route path={"/questions/:subjectId"}>
        {(params) => (
          <Layout>
            <DemoMappedRoutePasswordGate>
              <Questions subjectId={parseInt(params.subjectId)} />
            </DemoMappedRoutePasswordGate>
          </Layout>
        )}
      </Route>
      <Route path={"/subject-practice/:subjectId"}>
        {(params) => (
          <Layout>
            <DemoMappedRoutePasswordGate>
              <SubjectPracticeRedirect subjectId={parseInt(params.subjectId)} />
            </DemoMappedRoutePasswordGate>
          </Layout>
        )}
      </Route>
      <Route path={"/subject-exam/:subjectId"}>
        {(params) => (
          <Layout>
            <DemoMappedRoutePasswordGate>
              <SubjectExam subjectId={parseInt(params.subjectId)} />
            </DemoMappedRoutePasswordGate>
          </Layout>
        )}
      </Route>
      <Route path={"/practice/:questionId"}>
        {(params) => (
          <Layout>
            <DemoMappedRoutePasswordGate>
              <Practice questionId={parseInt(params.questionId)} />
            </DemoMappedRoutePasswordGate>
          </Layout>
        )}
      </Route>
      <Route path={"/test/:questionId"}>
        {(params) => (
          <Layout>
            <DemoMappedRoutePasswordGate>
              <Test questionId={parseInt(params.questionId)} />
            </DemoMappedRoutePasswordGate>
          </Layout>
        )}
      </Route>
      <Route path={"/statistics"}>
        <Layout>
          <Statistics demoPreview={shouldShowDemoHome} />
        </Layout>
      </Route>
      <Route path={"/demo"}>
        {canAccessDemo ? (
          <Layout>
            <Demo />
          </Layout>
        ) : (
          <RouteRedirect to="/subjects" />
        )}
      </Route>
      <Route path={"/demo/subjects"}>
        {canAccessDemo ? (
          <Layout>
            <Subjects demoWorkspace={isAdmin} />
          </Layout>
        ) : (
          <RouteRedirect to="/subjects" />
        )}
      </Route>
      <Route path={"/demo/subjects/"}>
        <RouteRedirect to="/demo/subjects" />
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
              {isAdmin ? (
                <DemoQuestionPasswordGate questionId={parseInt(params.questionId)}>
                  <Practice questionId={parseInt(params.questionId)} isDemo />
                </DemoQuestionPasswordGate>
              ) : (
                <DemoQuestionPasswordGate questionId={parseInt(params.questionId)}>
                  <DemoQuestionRouteBridge
                    demoQuestionId={parseInt(params.questionId)}
                    target="practice"
                  />
                </DemoQuestionPasswordGate>
              )}
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
              {isAdmin ? (
                <DemoQuestionPasswordGate questionId={parseInt(params.questionId)}>
                  <Test questionId={parseInt(params.questionId)} isDemo />
                </DemoQuestionPasswordGate>
              ) : (
                <DemoQuestionPasswordGate questionId={parseInt(params.questionId)}>
                  <DemoQuestionRouteBridge
                    demoQuestionId={parseInt(params.questionId)}
                    target="test"
                  />
                </DemoQuestionPasswordGate>
              )}
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
              {isAdmin ? (
                <DemoSubjectPasswordGate subjectId={parseInt(params.subjectId)}>
                  <SubjectExam subjectId={parseInt(params.subjectId)} isDemo />
                </DemoSubjectPasswordGate>
              ) : (
                <DemoSubjectPasswordGate subjectId={parseInt(params.subjectId)}>
                  <DemoSubjectRouteBridge
                    demoSubjectId={parseInt(params.subjectId)}
                    target="subject-exam"
                  />
                </DemoSubjectPasswordGate>
              )}
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
              {isAdmin ? (
                <DemoSubjectPasswordGate subjectId={parseInt(params.subjectId)}>
                  <Questions subjectId={parseInt(params.subjectId)} demoWorkspace />
                </DemoSubjectPasswordGate>
              ) : (
                <DemoSubjectPasswordGate subjectId={parseInt(params.subjectId)}>
                  <DemoSubjectRouteBridge
                    demoSubjectId={parseInt(params.subjectId)}
                    target="questions"
                  />
                </DemoSubjectPasswordGate>
              )}
            </Layout>
          ) : (
            <RouteRedirect to="/subjects" />
          )
        }
      </Route>
      <Route path={"/admin/demo-management"}>
        <RouteRedirect to="/demo/subjects" />
      </Route>
      <Route path={"/"}>
        {subjectCountDecisionPending ? (
          <Layout>
            <div className="py-12 text-center text-sm text-muted-foreground">학습 현황을 불러오는 중...</div>
          </Layout>
        ) : shouldShowDemoHome ? (
          <Layout>
            <Demo />
          </Layout>
        ) : (
          <Layout>
            <Home />
          </Layout>
        )}
      </Route>
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const utils = trpc.useUtils();
  const autoGuestLogin = trpc.auth.autoGuestLogin.useMutation();
  const [location, setLocation] = useLocation();
  // 먼저 현재 세션 확인 (이미 로그인된 경우 게스트 로그인 건너뜀)
  const [initDone, setInitDone] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [guestBootstrapFailed, setGuestBootstrapFailed] = useState(false);
  const [guestBootstrapAttempted, setGuestBootstrapAttempted] = useState(false);
  const [guestBootstrapGateOpened, setGuestBootstrapGateOpened] = useState(false);
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: initDone,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  useBetaTelemetry(currentUser, location);
  useVercelAnalytics(location, currentUser);
  const prevUserIdRef = useRef<number | null>(null);

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

    if (meQuery.data) {
      setCurrentUser(meQuery.data);
      if (!isGuestUser(meQuery.data)) {
        clearRecentAuthAttempt();
      }
      return;
    }

    if (location === "/login") {
      setCurrentUser(null);
      return;
    }

    // 방금 로그인 직후에는 auth.me 응답 지연이 있을 수 있으므로
    // recent auth grace 동안은 사용자 상태를 성급히 지우지 않는다.
    if (hasRecentAuthAttempt()) return;
    setCurrentUser(null);
  }, [initDone, location, meQuery.data, meQuery.isLoading]);

  useEffect(() => {
    const currentUserId = Number.isFinite(currentUser?.id) ? Number(currentUser.id) : null;
    if (prevUserIdRef.current === currentUserId) return;
    prevUserIdRef.current = currentUserId;
    if (currentUserId !== null) {
      void utils.invalidate();
    }
  }, [currentUser?.id, utils]);

  useEffect(() => {
    if (!initDone) return;
    if (location === "/login") return;
    if (currentUser) return;
    if (!hasRecentAuthAttempt()) return;

    const timer = window.setTimeout(async () => {
      try {
        const latest = await meQuery.refetch();
        if (latest.data) {
          setCurrentUser(latest.data);
          return;
        }
      } catch {
        // ignore and fallback to login screen below
      }
      const returnTo = `${window.location.pathname}${window.location.search}`;
      setLocation(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }, AUTH_RESOLVE_MAX_WAIT_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentUser, initDone, location, meQuery.refetch, setLocation]);

  useEffect(() => {
    if (!initDone) return;
    if (meQuery.isLoading) return;
    if (autoGuestLogin.isPending) return;
    if (guestBootstrapFailed) return;
    if (currentUser) return;
    if (location === "/login") return;
    if (hasRecentAuthAttempt()) return;

    const guestId = getOrCreateGuestId();
    setGuestBootstrapAttempted(true);
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
          window.setTimeout(() => {
            setGuestBootstrapFailed(false);
          }, 3000);
        },
      }
    );
  }, [
    autoGuestLogin,
    autoGuestLogin.isPending,
    currentUser,
    guestBootstrapFailed,
    guestBootstrapAttempted,
    guestBootstrapGateOpened,
    initDone,
    location,
    meQuery,
    meQuery.isLoading,
  ]);

  useEffect(() => {
    if (!guestBootstrapAttempted) return;
    if (guestBootstrapGateOpened) return;
    const timer = window.setTimeout(() => {
      setGuestBootstrapGateOpened(true);
    }, GUEST_BOOTSTRAP_BLOCK_MAX_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [guestBootstrapAttempted, guestBootstrapGateOpened]);

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

  if (
    !currentUser &&
    location !== "/login" &&
    !hasRecentAuthAttempt() &&
    (!guestBootstrapAttempted || (autoGuestLogin.isPending && !guestBootstrapGateOpened))
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">게스트 세션 준비 중...</p>
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
  const TEMP_DISABLE_SITE_GATE =
    import.meta.env.DEV || import.meta.env.VITE_DISABLE_SITE_GATE === "true";
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
