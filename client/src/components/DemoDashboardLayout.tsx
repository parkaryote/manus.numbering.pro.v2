import { useState } from "react";
import { Chrome, LogIn, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { startGoogleOAuthLogin } from "@/lib/googleOAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";

type AuthTab = "login" | "signup";
const GOOGLE_SOCIAL_BUTTON_META = {
  label: "Google로 계속",
  className: "bg-white text-black border hover:bg-neutral-50",
  icon: <Chrome className="h-4 w-4" />,
} as const;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

function isGuestUser(user: { loginMethod?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return user.loginMethod === "guest";
}

function AuthModal({
  open,
  defaultTab,
  onClose,
  onAuthSuccess,
}: {
  open: boolean;
  defaultTab: AuthTab;
  onClose: () => void;
  onAuthSuccess?: () => void;
}) {
  const [tab, setTab] = useState<AuthTab>(defaultTab);

  // 가입 폼
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // 로그인 폼
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [, setLocation] = useLocation();

  const signupMutation = trpc.auth.simpleSignup.useMutation({
    onSuccess: () => {
      toast.success("가입 완료! 로그인되었습니다.");
      onClose();
      if (onAuthSuccess) onAuthSuccess(); else window.location.reload();
      setLocation("/");
    },
    onError: (err) => toast.error(err.message || "가입 실패"),
  });

  const loginMutation = trpc.auth.simpleLogin.useMutation({
    onSuccess: () => {
      toast.success("로그인되었습니다.");
      onClose();
      if (onAuthSuccess) onAuthSuccess(); else window.location.reload();
      setLocation("/");
    },
    onError: (err) => toast.error(err.message || "로그인 실패"),
  });
  const isPending = signupMutation.isPending || loginMutation.isPending;

  const handleSignup = () => {
    if (!username.trim()) { toast.error("아이디를 입력해주세요"); return; }
    if (password.length < 8) { toast.error("비밀번호는 8자 이상이어야 합니다"); return; }
    if (password !== passwordConfirm) { toast.error("비밀번호가 일치하지 않습니다"); return; }
    signupMutation.mutate({ username, password });
  };

  const handleLogin = () => {
    if (!loginIdentifier.trim()) { toast.error("아이디 또는 이메일을 입력해주세요"); return; }
    if (!loginPassword.trim()) { toast.error("비밀번호를 입력해주세요"); return; }
    loginMutation.mutate({ identifier: loginIdentifier, password: loginPassword });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>계정</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as AuthTab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">로그인</TabsTrigger>
            <TabsTrigger value="signup">가입</TabsTrigger>
          </TabsList>

          {/* 로그인 탭 */}
          <TabsContent value="login" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Button
                onClick={() => {
                  if (!GOOGLE_CLIENT_ID) {
                    toast.error("Google OAuth 클라이언트 ID가 설정되지 않았습니다.");
                    return;
                  }
                  try {
                    startGoogleOAuthLogin({
                      clientId: GOOGLE_CLIENT_ID,
                      returnTo: `${window.location.pathname}${window.location.search}`,
                    });
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Google 로그인 시작 실패");
                  }
                }}
                className={`w-full justify-start gap-2 ${GOOGLE_SOCIAL_BUTTON_META.className}`}
                disabled={isPending}
              >
                {GOOGLE_SOCIAL_BUTTON_META.icon}
                {GOOGLE_SOCIAL_BUTTON_META.label}
              </Button>
            </div>

            <div className="h-px bg-border" />

            <div className="space-y-2">
              <Label htmlFor="login-identifier">아이디 또는 이메일</Label>
              <Input
                id="login-identifier"
                placeholder="아이디 또는 이메일 입력"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">비밀번호</Label>
              <Input
                id="login-password"
                type="password"
                placeholder="비밀번호 입력"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                disabled={isPending}
              />
            </div>
            <Button
              className="w-full gap-2"
              onClick={handleLogin}
              disabled={isPending}
            >
              <LogIn className="h-4 w-4" />
              {loginMutation.isPending ? "로그인 중..." : "로그인"}
            </Button>
          </TabsContent>

          {/* 가입 탭 */}
          <TabsContent value="signup" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="signup-username">아이디</Label>
              <Input
                id="signup-username"
                placeholder="사용할 아이디 입력"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">비밀번호</Label>
              <Input
                id="signup-password"
                type="password"
                placeholder="비밀번호 (4자 이상)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-confirm">비밀번호 확인</Label>
              <Input
                id="signup-confirm"
                type="password"
                placeholder="비밀번호 재입력"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                disabled={isPending}
              />
            </div>
            <Button
              className="w-full gap-2"
              onClick={handleSignup}
              disabled={isPending}
            >
              <UserPlus className="h-4 w-4" />
              {signupMutation.isPending ? "처리 중..." : "계정 만들기"}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default function DemoDashboardLayout({
  children,
  onAuthSuccess,
}: {
  children: React.ReactNode;
  onAuthSuccess?: () => void;
}) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const isGuest = isGuestUser(user);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<AuthTab>("login");

  const openLogin = () => { setAuthTab("login"); setAuthOpen(true); };
  const openSignup = () => { setAuthTab("signup"); setAuthOpen(true); };
  const handleClose = () => setAuthOpen(false);

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="shrink-0 border-b bg-background/95 px-4 py-2">
        <div className="mx-auto w-full max-w-[1400px] flex items-center justify-between">
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="inline-flex flex-col items-start leading-tight hover:opacity-90 transition-opacity text-left"
            aria-label="대시보드로 이동"
          >
            <span className="text-[30px] font-black tracking-tight text-black dark:text-white">
              numbering.pro
            </span>
            <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
              Number it. Remember it like a pro
            </span>
          </button>
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500 dark:text-neutral-400">
            Beta Test
          </span>
        </div>
      </div>

      {/* 로그인 유도 배너 - 게스트 사용자에게만 표시 */}
      {isGuest && (
        <div className="shrink-0 bg-primary/5 border-b border-primary/10 px-4 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground leading-snug">
            <span className="font-medium text-foreground">나만의 학습 통계</span>를 쌓고 문제를 추가하려면 로그인하세요.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={openLogin}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <LogIn className="h-3 w-3" />
              로그인
            </button>
            <span className="text-muted-foreground/40 text-xs">|</span>
            <button
              onClick={openSignup}
              className="inline-flex items-center gap-1 text-xs font-medium bg-primary text-primary-foreground px-2 py-1 rounded-md hover:bg-primary/90 transition-colors"
            >
              <UserPlus className="h-3 w-3" />
              가입
            </button>
          </div>
        </div>
      )}

      {/* 메인 콘텐츠 */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        <div className="w-full max-w-[1400px] mx-auto px-3 md:px-6 py-4">
          {children}
        </div>
      </main>

      {/* 로그인/가입 모달 */}
      <AuthModal
        open={authOpen}
        defaultTab={authTab}
        onClose={handleClose}
        onAuthSuccess={onAuthSuccess}
      />
    </div>
  );
}
