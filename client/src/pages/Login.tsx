import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Chrome, Apple, CircleUserRound, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

type SocialProvider = "google" | "apple" | "kakao" | "naver";

const SOCIAL_PROVIDER_META: Record<
  SocialProvider,
  { label: string; className: string; icon?: React.ReactNode }
> = {
  google: {
    label: "Google로 계속",
    className: "bg-white text-black border hover:bg-neutral-50",
    icon: <Chrome className="h-4 w-4" />,
  },
  apple: {
    label: "Apple로 계속",
    className: "bg-black text-white hover:bg-neutral-800",
    icon: <Apple className="h-4 w-4" />,
  },
  kakao: {
    label: "Kakao로 계속",
    className: "bg-[#FEE500] text-black hover:bg-[#f5dc00]",
  },
  naver: {
    label: "Naver로 계속",
    className: "bg-[#03C75A] text-white hover:bg-[#02b352]",
  },
};

const SOCIAL_ID_KEY_PREFIX = "numbering_social_id_";
const GUEST_ID_KEY = "numbering_guest_id";

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
  const [tab, setTab] = useState<"social" | "account">("social");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");

  const socialLogin = trpc.auth.socialLogin.useMutation({
    onSuccess: () => {
      toast.success("로그인되었습니다.");
      setLocation("/");
    },
    onError: error => {
      toast.error(error.message || "소셜 로그인 실패");
    },
  });

  const loginMutation = trpc.auth.simpleLogin.useMutation({
    onSuccess: () => {
      toast.success("로그인되었습니다.");
      setLocation("/");
    },
    onError: error => {
      toast.error(error.message || "로그인 실패");
    },
  });

  const signupMutation = trpc.auth.simpleSignup.useMutation({
    onSuccess: () => {
      toast.success("가입 완료! 로그인되었습니다.");
      setLocation("/");
    },
    onError: error => {
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
    socialLogin.isPending ||
    loginMutation.isPending ||
    signupMutation.isPending ||
    guestLogin.isPending;

  const socialButtons = useMemo(
    () =>
      (Object.keys(SOCIAL_PROVIDER_META) as SocialProvider[]).map(provider => {
        const meta = SOCIAL_PROVIDER_META[provider];
        return (
          <Button
            key={provider}
            onClick={() => {
              const socialId = getOrCreateId(
                `${SOCIAL_ID_KEY_PREFIX}${provider}`
              );
              socialLogin.mutate({ provider, socialId });
            }}
            className={`w-full justify-start gap-2 ${meta.className}`}
            disabled={isPending}
          >
            {meta.icon ?? <CircleUserRound className="h-4 w-4" />}
            {meta.label}
          </Button>
        );
      }),
    [isPending, socialLogin]
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
          <Tabs
            value={tab}
            onValueChange={v => setTab(v as "social" | "account")}
          >
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
              <Button
                className="w-full"
                onClick={handleLogin}
                disabled={isPending}
              >
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
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSignup}
                disabled={isPending}
              >
                가입 후 시작
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
