import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SiteGate, useSiteAccess } from "./components/SiteGate";
import { trpc } from "./lib/trpc";
import { useState, useEffect } from "react";
import DashboardLayout from "./components/DashboardLayout";
import DemoDashboardLayout from "./components/DemoDashboardLayout";
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

const GUEST_ID_KEY = "numbering_guest_id";

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

function isGuestUser(user: { openId?: string; loginMethod?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return (
    (user.openId?.startsWith("guest_") ?? false) ||
    user.loginMethod === "guest"
  );
}

/**
 * 레이아웃 선택 헬퍼: 게스트면 DemoDashboardLayout, 일반 로그인이면 DashboardLayout
 */
function Layout({
  user,
  children,
  onAuthSuccess,
}: {
  user: { openId?: string; loginMethod?: string | null } | null | undefined;
  children: React.ReactNode;
  onAuthSuccess?: () => void;
}) {
  if (isGuestUser(user)) {
    return <DemoDashboardLayout onAuthSuccess={onAuthSuccess}>{children}</DemoDashboardLayout>;
  }
  return <DashboardLayout>{children}</DashboardLayout>;
}

function RouteRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);

  return null;
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

    const queryId = Number(new URLSearchParams(window.location.search).get("q"));
    const hasQueryTarget = Number.isFinite(queryId) && questions.some((q) => q.id === queryId);
    const targetQuestionId = hasQueryTarget ? queryId : questions[0].id;
    setLocation(`/practice/${targetQuestionId}?scrollNav=1`);
  }, [questions, setLocation, subjectId]);

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-muted-foreground text-sm">연속 연습 여는 중...</div>
    </div>
  );
}

function Router({ user, onAuthSuccess }: { user: { openId?: string; loginMethod?: string | null } | null | undefined; onAuthSuccess?: () => void }) {
  const canAccessDemo = !user || isGuestUser(user);

  return (
    <Switch>
      <Route path={"/"}>
        <Layout user={user} onAuthSuccess={onAuthSuccess}>
          <Home />
        </Layout>
      </Route>
      <Route path={"/subjects"}>
        <Layout user={user} onAuthSuccess={onAuthSuccess}>
          <Subjects />
        </Layout>
      </Route>
      <Route path={"/questions/:subjectId"}>
        {(params) => (
          <Layout user={user} onAuthSuccess={onAuthSuccess}>
            <Questions subjectId={parseInt(params.subjectId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/subject-practice/:subjectId"}>
        {(params) => (
          <Layout user={user} onAuthSuccess={onAuthSuccess}>
            <SubjectPracticeRedirect subjectId={parseInt(params.subjectId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/subject-exam/:subjectId"}>
        {(params) => (
          <Layout user={user} onAuthSuccess={onAuthSuccess}>
            <SubjectExam subjectId={parseInt(params.subjectId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/practice/:questionId"}>
        {(params) => (
          <Layout user={user} onAuthSuccess={onAuthSuccess}>
            <Practice questionId={parseInt(params.questionId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/test/:questionId"}>
        {(params) => (
          <Layout user={user} onAuthSuccess={onAuthSuccess}>
            <Test questionId={parseInt(params.questionId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/statistics"}>
        <Layout user={user} onAuthSuccess={onAuthSuccess}>
          <Statistics />
        </Layout>
      </Route>
      <Route path={"/demo"}>
        {canAccessDemo ? (
          <Layout user={user} onAuthSuccess={onAuthSuccess}>
            <Demo />
          </Layout>
        ) : (
          <RouteRedirect to="/subjects" />
        )}
      </Route>
      <Route path={"/login"}>
        <Login />
      </Route>
      <Route path={"/demo/practice/:questionId"}>
        {(params) =>
          canAccessDemo ? (
            <Layout user={user} onAuthSuccess={onAuthSuccess}>
              <Practice questionId={parseInt(params.questionId)} isDemo={true} />
            </Layout>
          ) : (
            <RouteRedirect to={`/practice/${parseInt(params.questionId)}`} />
          )
        }
      </Route>
      <Route path={"/demo/test/:questionId"}>
        {(params) =>
          canAccessDemo ? (
            <Layout user={user} onAuthSuccess={onAuthSuccess}>
              <Test questionId={parseInt(params.questionId)} isDemo={true} />
            </Layout>
          ) : (
            <RouteRedirect to={`/test/${parseInt(params.questionId)}`} />
          )
        }
      </Route>
      <Route path={"/demo/questions"}>
        {canAccessDemo ? (
          <Layout user={user} onAuthSuccess={onAuthSuccess}>
            <Demo />
          </Layout>
        ) : (
          <RouteRedirect to="/subjects" />
        )}
      </Route>
      <Route path={"/demo/questions/"}>
        {canAccessDemo ? (
          <Layout user={user} onAuthSuccess={onAuthSuccess}>
            <Demo />
          </Layout>
        ) : (
          <RouteRedirect to="/subjects" />
        )}
      </Route>
      <Route path={"/demo/questions/:subjectId"}>
        {(params) =>
          canAccessDemo ? (
            <Layout user={user} onAuthSuccess={onAuthSuccess}>
              <Questions subjectId={parseInt(params.subjectId)} isDemo={true} />
            </Layout>
          ) : (
            <RouteRedirect to="/subjects" />
          )
        }
      </Route>
      <Route path={"/admin/demo-management"}>
        <DashboardLayout>
          <AdminDemoManagement />
        </DashboardLayout>
      </Route>
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const autoGuestLogin = trpc.auth.autoGuestLogin.useMutation();
  // 먼저 현재 세션 확인 (이미 로그인된 경우 게스트 로그인 건너뜀)
  const [initDone, setInitDone] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: initDone,
    retry: false,
    refetchOnWindowFocus: true,
  });

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
    async function init() {
      try {
        // 1) 먼저 현재 세션 확인
        const res = await fetch("/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          const user = data?.[0]?.result?.data?.json;
          if (user && user.loginMethod !== "guest") {
            // 이미 정식 계정으로 로그인됨 → 게스트 로그인 건너뜀
            setCurrentUser(user);
            setInitDone(true);
            return;
          }
        }
      } catch {
        // 세션 확인 실패 → 게스트 로그인 시도
      }

      // 2) 정식 계정 없으면 게스트 로그인
      const guestId = getOrCreateGuestId();
      autoGuestLogin.mutate({ guestId }, {
        onSuccess: async () => {
          // 게스트 로그인 후 최신 user 정보 fetch
          try {
            const res2 = await fetch("/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D", {
              credentials: "include",
            });
            if (res2.ok) {
              const data2 = await res2.json();
              setCurrentUser(data2?.[0]?.result?.data?.json ?? null);
            }
          } catch { /* ignore */ }
          setInitDone(true);
        },
        onError: () => setInitDone(true),
      });
    }
    init();
  }, []);

  useEffect(() => {
    if (!initDone) return;
    if (meQuery.isLoading) return;
    setCurrentUser(meQuery.data ?? null);
  }, [initDone, meQuery.data, meQuery.isLoading]);

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

  return (
    <TooltipProvider>
      <Toaster />
      <Router user={currentUser} onAuthSuccess={handleAuthSuccess} />
    </TooltipProvider>
  );
}

function App() {
  // 임시 비활성화: 베타 테스트 동안 접속 비밀번호 게이트를 우회합니다.
  // 다시 사용할 때 false로 변경하세요.
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
