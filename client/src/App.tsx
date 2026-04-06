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

function Router() {
  return (
    <Switch>
      <Route path={"/"}>
        <DashboardLayout>
          <Home />
        </DashboardLayout>
      </Route>
      <Route path={"/subjects"}>
        <DashboardLayout>
          <Subjects />
        </DashboardLayout>
      </Route>
      <Route path={"/questions/:subjectId"}>
        {(params) => (
          <DashboardLayout>
            <Questions subjectId={parseInt(params.subjectId)} />
          </DashboardLayout>
        )}
      </Route>
      <Route path={"/subject-practice/:subjectId"}>
        {(params) => (
          <DashboardLayout>
            <SubjectPractice subjectId={parseInt(params.subjectId)} />
          </DashboardLayout>
        )}
      </Route>
      <Route path={"/subject-exam/:subjectId"}>
        {(params) => (
          <DashboardLayout>
            <SubjectExam subjectId={parseInt(params.subjectId)} />
          </DashboardLayout>
        )}
      </Route>
      <Route path={"/practice/:questionId"}>
        {(params) => (
          <DashboardLayout>
            <Practice questionId={parseInt(params.questionId)} />
          </DashboardLayout>
        )}
      </Route>
      <Route path={"/test/:questionId"}>
        {(params) => (
          <DashboardLayout>
            <Test questionId={parseInt(params.questionId)} />
          </DashboardLayout>
        )}
      </Route>
      <Route path={"/statistics"}>
        <DashboardLayout>
          <Statistics />
        </DashboardLayout>
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

function AppContent() {
  const autoGuestLogin = trpc.auth.autoGuestLogin.useMutation();
  const [guestReady, setGuestReady] = useState(false);

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
      <Router />
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
