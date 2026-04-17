import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { consumeGoogleOAuthState, getGoogleRedirectUri, parseGoogleStateReturnTo, startGoogleOAuthLogin } from "@/lib/googleOAuth";
import { Chrome, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const GOOGLE_SOCIAL_BUTTON_META = {
  label: "Google로 계속",
  className: "bg-white text-black border hover:bg-neutral-50",
  icon: <Chrome className="h-4 w-4" />,
} as const;

const GUEST_ID_KEY = "numbering_guest_id";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const RECENT_AUTH_AT_KEY = "numbering_recent_auth_at";

function isGuestUser(user: { loginMethod?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return user.loginMethod === "guest";
}

function sanitizeNextPath(path: string | null | undefined): string {
  if (!path) return "/";
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  if (path === "/login" || path.startsWith("/login?")) return "/";
  return path;
}

function getOrCreateId(key: string): string {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const next = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(key, next);
    return next;
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function markRecentAuthAttempt() {
  try {
    localStorage.setItem(RECENT_AUTH_AT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export default function Login() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"social" | "account">("social");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");
  const [hasProcessedGoogleCode, setHasProcessedGoogleCode] = useState(false);
  const [blockingMessage, setBlockingMessage] = useState<string | null>(null);
  const googleReturnToRef = useRef("/");
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const finishAuthAndRedirect = (nextPath: string, successMessage: string) => {
    setBlockingMessage("로그인 완료, 이동 중...");
    markRecentAuthAttempt();
    try {
      localStorage.removeItem(GUEST_ID_KEY);
    } catch {
      // ignore
    }
    toast.success(successMessage);
    void utils.auth.me.invalidate();
    window.location.assign(sanitizeNextPath(nextPath));
  };

  const finishGuestAndRedirect = (nextPath: string) => {
    setBlockingMessage("게스트 세션 적용 중...");
    markRecentAuthAttempt();
    void utils.auth.me.invalidate();
    window.location.replace(sanitizeNextPath(nextPath));
  };

  const googleLogin = trpc.auth.googleLoginWithCode.useMutation({
    onSuccess: () => {
      const nextPath = googleReturnToRef.current || "/";
      finishAuthAndRedirect(nextPath, "로그인되었습니다.");
    },
    onError: (error) => {
      setBlockingMessage(null);
      const raw = (error?.message ?? "").toLowerCase();
      if (raw.includes("aborted") || raw.includes("aborterror") || raw.includes("signal is aborted")) {
        toast.error("서버 응답이 지연되었습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      toast.error(error.message || "Google 로그인 실패");
    },
  });

  const loginMutation = trpc.auth.simpleLogin.useMutation({
    onSuccess: () => {
      finishAuthAndRedirect("/", "로그인되었습니다.");
    },
    onError: (error) => {
      setBlockingMessage(null);
      toast.error(error.message || "로그인 실패");
    },
  });

  const signupMutation = trpc.auth.simpleSignup.useMutation({
    onSuccess: () => {
      finishAuthAndRedirect("/", "가입 완료! 로그인되었습니다.");
    },
    onError: (error) => {
      setBlockingMessage(null);
      toast.error(error.message || "가입 실패");
    },
  });

  const guestLogin = trpc.auth.autoGuestLogin.useMutation({
    onSuccess: () => {
      finishGuestAndRedirect(requestedReturnTo);
    },
    onError: () => {
      setBlockingMessage(null);
      toast.error("게스트 시작에 실패했습니다.");
    },
  });

  const isPending =
    googleLogin.isPending ||
    loginMutation.isPending ||
    signupMutation.isPending ||
    guestLogin.isPending;
  const isUiLocked = isPending || Boolean(blockingMessage);

  useEffect(() => {
    if (hasProcessedGoogleCode) return;

    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");

    if (error) {
      setHasProcessedGoogleCode(true);
      setBlockingMessage(null);
      toast.error("Google 로그인 승인에 실패했습니다.");
      window.history.replaceState({}, "", "/login");
      return;
    }

    if (!code) return;

    setHasProcessedGoogleCode(true);
    markRecentAuthAttempt();
    if (!consumeGoogleOAuthState(state)) {
      setBlockingMessage(null);
      toast.error("Google 로그인 요청 검증에 실패했습니다. 다시 시도해주세요.");
      window.history.replaceState({}, "", "/login");
      return;
    }
    setBlockingMessage("Google 로그인 처리 중...");
    googleReturnToRef.current = parseGoogleStateReturnTo(state);
    window.history.replaceState({}, "", "/login");
    googleLogin.mutate({ code, redirectUri: getGoogleRedirectUri() });
  }, [googleLogin, hasProcessedGoogleCode]);

  const requestedReturnTo = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo");
    return sanitizeNextPath(returnTo);
  }, []);

  useEffect(() => {
    if (!meQuery.data) return;
    if (blockingMessage) return;
    if (isGuestUser(meQuery.data)) {
      setLocation(requestedReturnTo);
      return;
    }
    setLocation(requestedReturnTo);
  }, [blockingMessage, meQuery.data, requestedReturnTo, setLocation]);

  const socialButtons = useMemo(
    () => {
      return (
        <Button
          onClick={() => {
            if (!GOOGLE_CLIENT_ID) {
              toast.error("Google OAuth 클라이언트 ID가 설정되지 않았습니다.");
              return;
            }
            try {
              markRecentAuthAttempt();
              setBlockingMessage("Google 로그인 화면으로 이동 중...");
              startGoogleOAuthLogin({
                clientId: GOOGLE_CLIENT_ID,
                returnTo: requestedReturnTo,
              });
            } catch (error) {
              setBlockingMessage(null);
              toast.error(error instanceof Error ? error.message : "Google 로그인 시작 실패");
            }
          }}
          className={`w-full justify-start gap-2 ${GOOGLE_SOCIAL_BUTTON_META.className}`}
          disabled={isUiLocked}
        >
          {GOOGLE_SOCIAL_BUTTON_META.icon}
          {GOOGLE_SOCIAL_BUTTON_META.label}
        </Button>
      );
    },
    [isUiLocked, requestedReturnTo]
  );

  const handleLogin = () => {
    if (!identifier.trim()) {
      toast.error("아이디 또는 이메일을 입력해주세요.");
      return;
    }
    if (!password.trim()) {
      toast.error("비밀번호를 입력해주세요.");
      return;
    }
    markRecentAuthAttempt();
    setBlockingMessage("아이디 로그인 처리 중...");
    loginMutation.mutate({ identifier, password });
  };

  const handleSignup = () => {
    if (!signupUsername.trim()) {
      toast.error("아이디를 입력해주세요.");
      return;
    }
    if (signupPassword.length < 8) {
      toast.error("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (signupPassword !== signupPasswordConfirm) {
      toast.error("비밀번호가 일치하지 않습니다.");
      return;
    }
    markRecentAuthAttempt();
    setBlockingMessage("가입 처리 중...");
    signupMutation.mutate({
      username: signupUsername,
      password: signupPassword,
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl font-semibold">로그인</CardTitle>
          <CardDescription>계정을 선택해 계속 진행하세요.</CardDescription>
          {blockingMessage && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-border/80 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/50 border-t-transparent" />
              <span>{blockingMessage}</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              if (isUiLocked) return;
              setTab(v as "social" | "account");
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="social" disabled={isUiLocked}>소셜</TabsTrigger>
              <TabsTrigger value="account" disabled={isUiLocked}>아이디</TabsTrigger>
            </TabsList>

            <TabsContent value="social" className="space-y-3 pt-3">
              {socialButtons}
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => {
                  if (isGuestUser(meQuery.data)) {
                    finishGuestAndRedirect(requestedReturnTo);
                    return;
                  }
                  const guestId = getOrCreateId(GUEST_ID_KEY);
                  setBlockingMessage("게스트로 입장 중...");
                  guestLogin.mutate({ guestId });
                }}
                disabled={isUiLocked}
              >
                <ShieldCheck className="h-4 w-4" />
                게스트로 계속
              </Button>
            </TabsContent>

            <TabsContent value="account" className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label htmlFor="login-identifier">아이디 또는 이메일</Label>
                <Input
                  id="login-identifier"
                  placeholder="아이디 또는 이메일"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  disabled={isUiLocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">비밀번호</Label>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleLogin()}
                  disabled={isUiLocked}
                />
              </div>
              <Button className="w-full" onClick={handleLogin} disabled={isUiLocked}>
                로그인
              </Button>

              <div className="h-px bg-border" />

              <div className="space-y-2">
                <Label htmlFor="signup-username">새 아이디</Label>
                <Input
                  id="signup-username"
                  value={signupUsername}
                  onChange={e => setSignupUsername(e.target.value)}
                  disabled={isUiLocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">새 비밀번호</Label>
                <Input
                  id="signup-password"
                  type="password"
                  value={signupPassword}
                  onChange={e => setSignupPassword(e.target.value)}
                  disabled={isUiLocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password-confirm">비밀번호 확인</Label>
                <Input
                  id="signup-password-confirm"
                  type="password"
                  value={signupPasswordConfirm}
                  onChange={e => setSignupPasswordConfirm(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSignup()}
                  disabled={isUiLocked}
                />
              </div>
              <Button variant="outline" className="w-full" onClick={handleSignup} disabled={isUiLocked}>
                가입 후 시작
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
