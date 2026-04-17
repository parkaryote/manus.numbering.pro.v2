import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Lock } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { resolveRenderableImageUrl } from "@/lib/renderableImageUrl";

function parseTableSummary(raw?: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    const rows = Number(parsed?.rows ?? 0);
    const cols = Number(parsed?.cols ?? 0);
    if (!rows || !cols) return "표 문제";
    return `표 문제 (${rows}x${cols})`;
  } catch {
    return "표 문제";
  }
}

export default function SharedSubject({ token }: { token: string }) {
  const [, setLocation] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [opened, setOpened] = useState<{
    subject: { id: number; name: string; description?: string | null; color?: string | null };
    questions: Array<{
      id: number;
      question: string;
      answer: string;
      imageUrl?: string | null;
      tableData?: string | null;
      displayOrder?: number | null;
    }>;
    disclaimer: string;
  } | null>(null);
  const [index, setIndex] = useState(0);

  const accessMutation = trpc.share.accessByToken.useMutation({
    onSuccess: (data) => {
      setOpened(data as any);
      setIndex(0);
      toast.success("공유 세트를 열었습니다.");
    },
    onError: (error) => {
      toast.error(error.message || "공유 세트 열기 실패");
    },
  });
  const importMutation = trpc.share.importByToken.useMutation({
    onSuccess: async (data) => {
      await Promise.all([
        utils.subjects.list.invalidate(),
        utils.questions.listBySubject.invalidate(),
      ]);
      toast.success(`"${data.subjectName}" 과목으로 저장했습니다.`);
      setLocation(`/questions/${data.subjectId}`);
    },
    onError: (error) => {
      toast.error(error.message || "내 계정 저장 실패");
    },
  });

  const questions = useMemo(() => {
    if (!opened?.questions) return [];
    return [...opened.questions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }, [opened]);

  const current = questions[index];
  const currentTableSummary = current?.tableData ? parseTableSummary(current.tableData) : "";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">공유 문제 세트</h1>
      </div>

      {!opened ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              비밀번호 보호 공유
            </CardTitle>
            <CardDescription>비밀번호를 입력하면 공유된 과목 문제 세트를 열람할 수 있습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              저작권이 있는 자료의 유출에는 본인 책임입니다. 공유받은 자료의 무단 재배포를 금지합니다.
            </div>
            <div className="space-y-2">
              <Label htmlFor="shared-password">공유 비밀번호</Label>
              <Input
                id="shared-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (!password.trim()) return;
                  if (!agreed) return;
                  accessMutation.mutate({ token, password });
                }}
                placeholder="비밀번호 입력"
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>저작권 관련 책임 안내를 확인했습니다.</span>
            </label>
            <Button
              className="w-full"
              disabled={!password.trim() || !agreed || accessMutation.isPending}
              onClick={() => accessMutation.mutate({ token, password })}
            >
              {accessMutation.isPending ? "확인 중..." : "세트 열기"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: opened.subject.color || "#3B82F6" }}
                  />
                  <CardTitle>{opened.subject.name}</CardTitle>
                  <Badge variant="secondary">{questions.length}문제</Badge>
                </div>
                {isAuthenticated ? (
                  <Button
                    size="sm"
                    onClick={() => importMutation.mutate({ token, password })}
                    disabled={importMutation.isPending}
                  >
                    {importMutation.isPending ? "저장 중..." : "저장 후 과목 페이지 열기"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={authLoading}
                    onClick={() => {
                      toast.message("로그인 후 내 계정에 저장할 수 있습니다.");
                      setLocation("/login");
                    }}
                  >
                    로그인 후 저장
                  </Button>
                )}
              </div>
              {opened.subject.description && <CardDescription>{opened.subject.description}</CardDescription>}
              <CardDescription>
                동일한 과목 페이지 UI로 보려면 <span className="font-medium">저장 후 과목 페이지 열기</span>를 눌러주세요.
              </CardDescription>
            </CardHeader>
          </Card>

          {current && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{index + 1}. {current.question}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {current.imageUrl && (
                  <img src={resolveRenderableImageUrl(current.imageUrl)} alt="" className="max-h-72 w-full rounded-md border object-contain" />
                )}
                <div className="rounded-md border bg-muted/20 p-3">
                  {current.tableData ? (
                    <p className="text-sm">{currentTableSummary}</p>
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed">{current.answer}</pre>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    disabled={index <= 0}
                    onClick={() => {
                      setIndex((prev) => Math.max(0, prev - 1));
                    }}
                  >
                    이전
                  </Button>
                  <span className="text-xs text-muted-foreground">{index + 1} / {questions.length}</span>
                  <Button
                    variant="outline"
                    disabled={index >= questions.length - 1}
                    onClick={() => {
                      setIndex((prev) => Math.min(questions.length - 1, prev + 1));
                    }}
                  >
                    다음
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">문제 목록</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    i === index ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                  }`}
                  onClick={() => {
                    setIndex(i);
                  }}
                >
                  {i + 1}. {q.question}
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
