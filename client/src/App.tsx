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
}: {
  user: { openId?: string; loginMethod?: string | null } | null | undefined;
  children: React.ReactNode;
}) {
  if (isGuestUser(user)) {
    return <DemoDashboardLayout>{children}</DemoDashboardLayout>;
  }
  return <DashboardLayout>{children}</DashboardLayout>;
}

function Router({ user }: { user: { openId?: string; loginMethod?: string | null } | null | undefined }) {
  return (
    <Switch>
      <Route path={"/"}>
        <Layout user={user}>
          <Home />
        </Layout>
      </Route>
      <Route path={"/subjects"}>
        <Layout user={user}>
          <Subjects />
        </Layout>
      </Route>
      <Route path={"/questions/:subjectId"}>
        {(params) => (
          <Layout user={user}>
            <Questions subjectId={parseInt(params.subjectId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/subject-practice/:subjectId"}>
        {(params) => (
          <Layout user={user}>
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
          <Layout user={user}>
            <SubjectExam subjectId={parseInt(params.subjectId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/practice/:questionId"}>
        {(params) => (
          <Layout user={user}>
            <Practice questionId={parseInt(params.questionId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/test/:questionId"}>
        {(params) => (
          <Layout user={user}>
            <Test questionId={parseInt(params.questionId)} />
          </Layout>
        )}
      </Route>
      <Route path={"/statistics"}>
        <Layout user={user}>
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
  const [guestReady, setGuestReady] = useState(false);
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    enabled: guestReady,
  });

  useEffect(() => {
    const guestId = getOrCreateGuestId();
    autoGuestLogin.mutate({ guestId }, {
      onSuccess: () => setGuestReady(true),
      onError: () => setGuestReady(true), // 실패해도 앱 진입 허용
    });
  }, []);

  if (!guestReady) {
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
      <Router user={meQuery.data} />
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
