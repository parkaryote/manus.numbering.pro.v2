import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { parseGoogleStateReturnTo, startGoogleOAuthLogin } from "@/lib/googleOAuth";
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
  const googleReturnToRef = useRef("/");

  const googleLogin = trpc.auth.googleLoginWithCode.useMutation({
    onSuccess: () => {
      toast.success("로그인되었습니다.");
      const nextPath = googleReturnToRef.current || "/";
      void utils.auth.me.invalidate();
      window.location.replace(nextPath);
    },
    onError: (error) => {
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
      toast.success("로그인되었습니다.");
      void utils.auth.me.invalidate();
      window.location.replace("/");
    },
    onError: (error) => {
      toast.error(error.message || "로그인 실패");
    },
  });

  const signupMutation = trpc.auth.simpleSignup.useMutation({
    onSuccess: () => {
      toast.success("가입 완료! 로그인되었습니다.");
      void utils.auth.me.invalidate();
      window.location.replace("/");
    },
    onError: (error) => {
      toast.error(error.message || "가입 실패");
    },
  });

  const guestLogin = trpc.auth.autoGuestLogin.useMutation({
    onSuccess: () => {
      setLocation("/");
    },
    onError: () => {
      toast.error("게스트 시작에 실패했습니다.");
    },
  });

  const isPending =
    googleLogin.isPending ||
    loginMutation.isPending ||
    signupMutation.isPending ||
    guestLogin.isPending;

  useEffect(() => {
    if (hasProcessedGoogleCode) return;

    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");

    if (error) {
      setHasProcessedGoogleCode(true);
      toast.error("Google 로그인 승인에 실패했습니다.");
      window.history.replaceState({}, "", "/login");
      return;
    }

    if (!code) return;

    setHasProcessedGoogleCode(true);
    googleReturnToRef.current = parseGoogleStateReturnTo(state);
    window.history.replaceState({}, "", "/login");
    googleLogin.mutate({ code });
  }, [googleLogin, hasProcessedGoogleCode]);

  const requestedReturnTo = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo");
    if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
    return returnTo;
  }, []);

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
              startGoogleOAuthLogin({
                clientId: GOOGLE_CLIENT_ID,
                returnTo: requestedReturnTo,
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
      );
    },
    [isPending, requestedReturnTo]
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
    loginMutation.mutate({ identifier, password });
  };

  const handleSignup = () => {
    if (!signupUsername.trim()) {
      toast.error("아이디를 입력해주세요.");
      return;
    }
    if (signupPassword.length < 4) {
      toast.error("비밀번호는 4자 이상이어야 합니다.");
      return;
    }
    if (signupPassword !== signupPasswordConfirm) {
      toast.error("비밀번호가 일치하지 않습니다.");
      return;
    }
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
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={v => setTab(v as "social" | "account")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="social">소셜</TabsTrigger>
              <TabsTrigger value="account">아이디</TabsTrigger>
            </TabsList>

            <TabsContent value="social" className="space-y-3 pt-3">
              {socialButtons}
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => {
                  const guestId = getOrCreateId(GUEST_ID_KEY);
                  guestLogin.mutate({ guestId });
                }}
                disabled={isPending}
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
                  disabled={isPending}
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
                  disabled={isPending}
                />
              </div>
              <Button className="w-full" onClick={handleLogin} disabled={isPending}>
                로그인
              </Button>

              <div className="h-px bg-border" />

              <div className="space-y-2">
                <Label htmlFor="signup-username">새 아이디</Label>
                <Input
                  id="signup-username"
                  value={signupUsername}
                  onChange={e => setSignupUsername(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">새 비밀번호</Label>
                <Input
                  id="signup-password"
                  type="password"
                  value={signupPassword}
                  onChange={e => setSignupPassword(e.target.value)}
                  disabled={isPending}
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
                  disabled={isPending}
                />
              </div>
              <Button variant="outline" className="w-full" onClick={handleSignup} disabled={isPending}>
                가입 후 시작
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
