import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Subjects from "./pages/Subjects";
import Questions from "./pages/Questions";
import Practice from "./pages/Practice";
import Test from "./pages/Test";
import Statistics from "./pages/Statistics";

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
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
