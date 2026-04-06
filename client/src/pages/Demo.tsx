import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { FileText, Image as ImageIcon, Table, LogIn, Zap, UserPlus } from "lucide-react";
import { getLoginUrl } from "@/const";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AuthMode = "none" | "signup" | "login";

export default function Demo() {
  const [, setLocation] = useLocation();
  const [authMode, setAuthMode] = useState<AuthMode>("none");

  // 가입 폼 상태
  const [accessPassword, setAccessPassword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // 로그인 폼 상태
  const [loginUsername, setLoginUsername] = useState("");
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
    if (!accessPassword.trim()) { toast.error("접속 비밀번호를 입력해주세요"); return; }
    if (!username.trim()) { toast.error("아이디를 입력해주세요"); return; }
    if (password.length < 4) { toast.error("비밀번호는 4자 이상이어야 합니다"); return; }
    if (password !== passwordConfirm) { toast.error("비밀번호가 일치하지 않습니다"); return; }
    simpleSignupMutation.mutate({ accessPassword, username, password });
  };

  const handleLogin = () => {
    if (!loginUsername.trim()) { toast.error("아이디를 입력해주세요"); return; }
    if (!loginPassword.trim()) { toast.error("비밀번호를 입력해주세요"); return; }
    simpleLoginMutation.mutate({ username: loginUsername, password: loginPassword });
  };

  return (
    <div className="container max-w-4xl py-8 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-4xl font-semibold tracking-tight">데모 모드</h1>
        <p className="text-muted-foreground mt-2">로그인 없이 예시 문제를 체험할 수 있습니다</p>
      </div>

      {/* 로그인/가입 카드 */}
      {authMode === "none" ? (
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="font-medium">나만의 문제를 만들고 학습 기록을 저장하려면?</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  계정을 만들면 과목 생성, 문제 추가, 학습 통계 기능을 사용할 수 있습니다
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" onClick={() => setAuthMode("signup")} className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  간편 가입
                </Button>
                <Button variant="outline" onClick={() => setAuthMode("login")} className="gap-2">
                  <Zap className="h-4 w-4" />
                  간편 로그인
                </Button>
                <Button onClick={() => { window.location.href = getLoginUrl(); }} className="gap-2">
                  <LogIn className="h-4 w-4" />
                  Manus 로그인
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-6 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="py-5">
            <Tabs value={authMode === "login" ? "login" : "signup"} onValueChange={(v) => setAuthMode(v as AuthMode)}>
              <TabsList className="mb-4">
                <TabsTrigger value="signup">간편 가입</TabsTrigger>
                <TabsTrigger value="login">간편 로그인</TabsTrigger>
              </TabsList>

              {/* 가입 탭 */}
              <TabsContent value="signup">
                <div className="space-y-3 max-w-sm">
                  <p className="text-sm text-muted-foreground">접속 비밀번호를 확인한 후 개인 계정을 만듭니다.</p>
                  <div className="space-y-1">
                    <Label htmlFor="accessPassword">접속 비밀번호</Label>
                    <Input
                      id="accessPassword"
                      type="password"
                      placeholder="사이트 접속 비밀번호"
                      value={accessPassword}
                      onChange={(e) => setAccessPassword(e.target.value)}
                      disabled={simpleSignupMutation.isPending}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="username">아이디</Label>
                    <Input
                      id="username"
                      placeholder="2~20자 아이디"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={simpleSignupMutation.isPending}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="password">비밀번호</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="4자 이상"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={simpleSignupMutation.isPending}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="passwordConfirm">비밀번호 확인</Label>
                    <Input
                      id="passwordConfirm"
                      type="password"
                      placeholder="비밀번호 재입력"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                      disabled={simpleSignupMutation.isPending}
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button onClick={handleSignup} disabled={simpleSignupMutation.isPending} className="gap-2">
                      <UserPlus className="h-4 w-4" />
                      {simpleSignupMutation.isPending ? "처리중..." : "계정 만들기"}
                    </Button>
                    <Button variant="outline" onClick={() => { setAuthMode("none"); setAccessPassword(""); setUsername(""); setPassword(""); setPasswordConfirm(""); }}>
                      취소
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* 로그인 탭 */}
              <TabsContent value="login">
                <div className="space-y-3 max-w-sm">
                  <p className="text-sm text-muted-foreground">기존에 만든 계정으로 로그인합니다.</p>
                  <div className="space-y-1">
                    <Label htmlFor="loginUsername">아이디</Label>
                    <Input
                      id="loginUsername"
                      placeholder="아이디"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      disabled={simpleLoginMutation.isPending}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="loginPassword">비밀번호</Label>
                    <Input
                      id="loginPassword"
                      type="password"
                      placeholder="비밀번호"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                      disabled={simpleLoginMutation.isPending}
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button onClick={handleLogin} disabled={simpleLoginMutation.isPending} className="gap-2">
                      <Zap className="h-4 w-4" />
                      {simpleLoginMutation.isPending ? "처리중..." : "로그인"}
                    </Button>
                    <Button variant="outline" onClick={() => { setAuthMode("none"); setLoginUsername(""); setLoginPassword(""); }}>
                      취소
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* 데모 과목 목록 */}
      {isLoading ? (
        <Card className="shadow-elegant">
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">로딩 중...</p>
          </CardContent>
        </Card>
      ) : subjects && subjects.length > 0 ? (
        <div className="space-y-4">
          {subjects.map((subject) => (
            <Card key={subject.id} className="shadow-elegant hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: subject.color || "#3B82F6" }}
                  />
                  <CardTitle>{subject.name}</CardTitle>
                </div>
                {subject.description && (
                  <CardDescription>{subject.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <DemoQuestions subjectId={subject.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="shadow-elegant">
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">아직 데모 과목이 없습니다</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DemoQuestions({ subjectId }: { subjectId: number }) {
  const [, setLocation] = useLocation();
  const { data: questions, isLoading } = trpc.demo.questions.useQuery({ subjectId });

  if (isLoading) return <p className="text-sm text-muted-foreground">문제 로딩 중...</p>;
  if (!questions || questions.length === 0) return <p className="text-sm text-muted-foreground">등록된 문제가 없습니다</p>;

  return (
    <div className="space-y-2">
      {questions.map((question) => {
        const isImageQuestion = !!question.imageUrl;
        const isTableQuestion = !!question.tableData;
        const questionType = isTableQuestion ? "table" : isImageQuestion ? "image" : "text";
        const practiceCount = parseInt(localStorage.getItem(`demo_practice_count_${question.id}`) || "0", 10);

        return (
          <div
            key={question.id}
            className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
            onClick={() => setLocation(`/demo/practice/${question.id}`)}
          >
            <div className="flex items-center gap-3 flex-1">
              {questionType === "text" && <FileText className="h-4 w-4 text-blue-500 shrink-0" />}
              {questionType === "image" && <ImageIcon className="h-4 w-4 text-green-500 shrink-0" />}
              {questionType === "table" && <Table className="h-4 w-4 text-purple-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium line-clamp-1">{question.question}</p>
                <p className="text-sm text-muted-foreground">
                  난이도: {question.difficulty === "easy" ? "쉬움" : question.difficulty === "medium" ? "보통" : "어려움"} · 누적 연습: {practiceCount}
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Button variant="outline" size="sm" onClick={() => setLocation(`/demo/test/${question.id}`)}>
                시험 모드
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
