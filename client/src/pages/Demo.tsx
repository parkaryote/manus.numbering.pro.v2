import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useLocation } from "wouter";
import { BookOpen, Star, LogIn, UserPlus, Zap, X } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DemoConfidenceRow = {
  questionId: number;
  displayOrder: number;
  displayScore: number;
  state: "green" | "yellow" | "red";
  isStarred: number;
};

function getSignalFillClass(state?: string) {
  if (state === "green") return "bg-emerald-500";
  if (state === "yellow") return "bg-amber-400";
  if (state === "red") return "bg-rose-500 dark:bg-rose-400";
  return "bg-neutral-200 dark:bg-neutral-700";
}

function getAggregateBadgeClass(state?: string) {
  if (state === "green") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (state === "yellow") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  if (state === "red") return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";
  return "bg-muted text-muted-foreground";
}

// 과목별 미니 그리드 (데모용 — 예시 안정도 반영)
function DemoSubjectMiniGrid({ items }: { items?: DemoConfidenceRow[] }) {
  const sorted = [...(items ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  if (sorted.length === 0) {
    return (
      <div className="flex items-center gap-1.5 mt-2">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div
            key={`placeholder-${idx}`}
            className="rounded-md w-3 h-3 bg-neutral-200 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-700"
            title="데모 문제 미설정"
          />
        ))}
        <span className="text-[11px] text-muted-foreground">미리보기 없음</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {sorted.map((q) => {
        const fill = getSignalFillClass(q.state);
        const border = q.isStarred === 1
          ? "border-[2px] border-black dark:border-black"
          : "border border-neutral-200 dark:border-neutral-700";
        return (
        <div
          key={q.questionId}
          className={`rounded-md w-3 h-3 ${fill} ${border}`}
          title={`문제 ${q.displayOrder} · ${Math.round(q.displayScore)}점${q.isStarred === 1 ? " (중요)" : ""}`}
        />
      );
      })}
    </div>
  );
}

type AuthMode = "none" | "signup" | "login";

export default function Demo() {
  const [, setLocation] = useLocation();
  const [authMode, setAuthMode] = useState<AuthMode>("none");
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // 가입 폼
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // 로그인 폼
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const { data: subjects, isLoading } = trpc.demo.subjects.useQuery();

  const simpleSignupMutation = trpc.auth.simpleSignup.useMutation({
    onSuccess: () => {
      toast.success("가입 완료! 로그인되었습니다.");
      setLocation("/");
    },
    onError: (error) => {
      toast.error(error.message || "가입 실패");
    },
  });

  const simpleLoginMutation = trpc.auth.simpleLogin.useMutation({
    onSuccess: () => {
      toast.success("로그인되었습니다.");
      setLocation("/");
    },
    onError: (error) => {
      toast.error(error.message || "로그인 실패");
    },
  });

  const handleSignup = () => {
    if (!username.trim()) { toast.error("아이디를 입력해주세요"); return; }
    if (password.length < 4) { toast.error("비밀번호는 4자 이상이어야 합니다"); return; }
    if (password !== passwordConfirm) { toast.error("비밀번호가 일치하지 않습니다"); return; }
    simpleSignupMutation.mutate({ username, password });
  };

  const handleLogin = () => {
    if (!loginIdentifier.trim()) { toast.error("아이디 또는 이메일을 입력해주세요"); return; }
    if (!loginPassword.trim()) { toast.error("비밀번호를 입력해주세요"); return; }
    simpleLoginMutation.mutate({ identifier: loginIdentifier, password: loginPassword });
  };

  const resetForms = () => {
    setUsername(""); setPassword(""); setPasswordConfirm("");
    setLoginIdentifier(""); setLoginPassword("");
    setAuthMode("none");
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">과목 관리</h1>
          <p className="text-muted-foreground mt-1">데모 모드 — 로그인하면 나만의 과목을 만들 수 있습니다</p>
        </div>
        <Button variant="outline" onClick={() => setAuthMode(authMode === "none" ? "login" : "none")} className="gap-2">
          <LogIn className="h-4 w-4" />
          로그인 / 가입
        </Button>
      </div>

      {/* 가입/로그인 패널 */}
      {authMode !== "none" && (
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium">계정으로 시작하면 나만의 과목과 문제를 추가하고 학습 통계를 쌓을 수 있습니다.</p>
              <Button variant="ghost" size="icon" className="h-6 w-6 -mt-1 -mr-1" onClick={resetForms}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Tabs value={authMode} onValueChange={(v) => setAuthMode(v as AuthMode)}>
              <TabsList className="mb-4">
                <TabsTrigger value="signup" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" />간편 가입</TabsTrigger>
                <TabsTrigger value="login" className="gap-1.5"><Zap className="h-3.5 w-3.5" />간편 로그인</TabsTrigger>
              </TabsList>

              <TabsContent value="signup">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                  <div className="space-y-1">
                    <Label htmlFor="username">아이디</Label>
                    <Input id="username" placeholder="2~20자" value={username}
                      onChange={(e) => setUsername(e.target.value)} disabled={simpleSignupMutation.isPending} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="password">비밀번호</Label>
                    <Input id="password" type="password" placeholder="4자 이상" value={password}
                      onChange={(e) => setPassword(e.target.value)} disabled={simpleSignupMutation.isPending} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="passwordConfirm">비밀번호 확인</Label>
                    <Input id="passwordConfirm" type="password" placeholder="비밀번호 재입력" value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                      disabled={simpleSignupMutation.isPending} />
                  </div>
                  <div className="sm:col-span-2 flex gap-2 pt-1">
                    <Button onClick={handleSignup} disabled={simpleSignupMutation.isPending} className="gap-2">
                      <UserPlus className="h-4 w-4" />
                      {simpleSignupMutation.isPending ? "처리중..." : "계정 만들기"}
                    </Button>
                    <Button variant="outline" onClick={resetForms}>취소</Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="login">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                  <div className="space-y-1">
                    <Label htmlFor="loginIdentifier">아이디 또는 이메일</Label>
                    <Input id="loginIdentifier" placeholder="아이디 또는 이메일" value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)} disabled={simpleLoginMutation.isPending} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="loginPassword">비밀번호</Label>
                    <Input id="loginPassword" type="password" placeholder="비밀번호" value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                      disabled={simpleLoginMutation.isPending} />
                  </div>
                  <div className="sm:col-span-2 flex gap-2 pt-1">
                    <Button onClick={handleLogin} disabled={simpleLoginMutation.isPending} className="gap-2">
                      <Zap className="h-4 w-4" />
                      {simpleLoginMutation.isPending ? "처리중..." : "로그인"}
                    </Button>
                    <Button variant="outline" onClick={resetForms}>취소</Button>
                    <Button variant="ghost" onClick={() => { setLocation("/login"); }} className="ml-auto gap-1.5 text-muted-foreground">
                      <LogIn className="h-3.5 w-3.5" />
                      소셜 로그인으로 전환
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* 데모 과목 목록 — Subjects.tsx와 동일한 카드 구조 */}
      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">로딩 중...</p>
        </div>
      ) : !subjects || subjects.length === 0 ? (
        <Card className="shadow-elegant">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">아직 데모 과목이 없습니다</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {subjects.map((subject) => (
            <DemoSubjectCard key={subject.id} subject={subject} />
          ))}
        </div>
      )}
    </div>
  );
}

function DemoSubjectCard({ subject }: { subject: any }) {
  const [, setLocation] = useLocation();
  const { data: confidencePreview } = trpc.demo.confidenceBySubject.useQuery({ subjectId: subject.id });
  const questionCount = confidencePreview?.aggregate?.totalQuestions ?? 0;
  const avgScore = confidencePreview?.aggregate?.averageScore ?? 0;
  const aggregateState = confidencePreview?.aggregate?.state;
  const aggregateClass = getAggregateBadgeClass(aggregateState);
  const isExample = Boolean((confidencePreview as any)?.isExample);
  const helperText =
    questionCount > 0
      ? `${questionCount}개 문제 · 클릭하여 연습 시작`
      : "공개 데모 문제가 아직 없습니다";

  return (
    <Card className="shadow-elegant hover:shadow-lg transition-all cursor-pointer"
      onClick={() => setLocation(`/demo/questions/${subject.id}`)}>
      <CardHeader className="flex flex-row items-start gap-3 pb-3">
        <div className="w-4 h-4 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: subject.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <CardTitle className="text-lg">{subject.name}</CardTitle>
            <Badge variant="secondary" className="gap-1 text-xs py-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              <Star className="w-2.5 h-2.5" />
              데모
            </Badge>
          </div>
          {subject.description && (
            <CardDescription className="line-clamp-1 mb-1">{subject.description}</CardDescription>
          )}
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs text-muted-foreground">{helperText}</p>
            {questionCount > 0 && (
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${aggregateClass}`}>
                안정도 {Math.round(avgScore)}점
              </span>
            )}
            {isExample && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">예시</span>
            )}
          </div>
          <DemoSubjectMiniGrid items={(confidencePreview?.questions as DemoConfidenceRow[] | undefined) ?? []} />
        </div>
      </CardHeader>
    </Card>
  );
}
