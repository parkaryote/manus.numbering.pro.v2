import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
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
import SubjectPractice from "./pages/SubjectPractice";
import SubjectExam from "./pages/SubjectExam";

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

function Router({ user, onAuthSuccess }: { user: { openId?: string; loginMethod?: string | null } | null | undefined; onAuthSuccess?: () => void }) {
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
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
              <div className="text-4xl">🚧</div>
              <h2 className="text-xl font-bold">준비 중입니다</h2>
              <p className="text-muted-foreground text-sm max-w-xs">수직 스크롤 연습 모드는 현재 준비 중입니다. 곧 업데이트될 예정입니다.</p>
              <button
                className="mt-2 text-sm text-primary hover:underline"
                onClick={() => window.history.back()}
              >← 돌아가기</button>
            </div>
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
        <DemoDashboardLayout>
          <Demo />
        </DemoDashboardLayout>
      </Route>
      <Route path={"/demo/practice/:questionId"}>
        {(params) => (
          <DemoDashboardLayout>
            <Practice questionId={parseInt(params.questionId)} isDemo={true} />
          </DemoDashboardLayout>
        )}
      </Route>
      <Route path={"/demo/test/:questionId"}>
        {(params) => (
          <DemoDashboardLayout>
            <Test questionId={parseInt(params.questionId)} isDemo={true} />
          </DemoDashboardLayout>
        )}
      </Route>
      <Route path={"/demo/questions/:subjectId"}>
        {(params) => (
          <DemoDashboardLayout>
            <Questions subjectId={parseInt(params.subjectId)} isDemo={true} />
          </DemoDashboardLayout>
        )}
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

  // 로그인/가입 성공 후 currentUser를 업데이트하는 함수 (reload 없이 레이아웃 전환)
  const handleAuthSuccess = async () => {
    try {
      const res = await fetch("/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        const user = data?.[0]?.result?.data?.json;
        if (user) {
          setCurrentUser(user);
          return;
        }
      }
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
  const { granted, grant } = useSiteAccess();

  if (!granted) {
    return (
      <ErrorBoundary>
        <ThemeProvider defaultTheme="light" switchable={false}>
          <SiteGate onGranted={grant} />
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable={true}>
        <AppContent />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
