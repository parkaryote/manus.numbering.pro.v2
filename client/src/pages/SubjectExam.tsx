import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Trophy, RotateCcw, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { splitGraphemes, isPartialMatch } from "@/lib/hangul";
import { Textarea } from "@/components/ui/textarea";

interface SubjectExamProps {
  subjectId: number;
}

interface QuestionResult {
  questionId: number;
  question: string;
  correctAnswer: string;
  userAnswer: string;
  isCorrect: boolean;
  accuracyRate: number;
  correctLineCount: number;
  totalLines: number;
  recallTime: number;
}

// 글자별 채점 렌더링
function renderColoredAnswer(correctAnswer: string, userAnswer: string) {
  const correctLines = correctAnswer.split("\n");
  const userLines = userAnswer.split("\n");

  return correctLines.map((line, lineIdx) => {
    const tChars = splitGraphemes(line);
    const uChars = splitGraphemes(userLines[lineIdx] || "");
    const isLineCorrect = (userLines[lineIdx] || "").trim().toLowerCase().replace(/\s+/g, "") === line.trim().toLowerCase().replace(/\s+/g, "");

    return (
      <div key={lineIdx} className={`font-medium text-sm leading-relaxed px-2 py-0.5 rounded ${isLineCorrect ? "bg-green-500/10" : "bg-red-500/10"}`}>
        {tChars.map((ch, i) => {
          const uch = uChars[i];
          let colorClass = "text-muted-foreground/40";
          if (uch !== undefined) {
            if (isPartialMatch(ch, uch)) {
              colorClass = "text-foreground";
            } else {
              colorClass = "text-red-500";
            }
          }
          return (
            <span key={i} className={colorClass}>{ch}</span>
          );
        })}
        {/* 사용자가 입력한 내용이 더 길면 빨간색으로 표시 */}
        {uChars.length > tChars.length && (
          <span className="text-red-400 text-xs ml-1">
            +{splitGraphemes(userLines[lineIdx] || "").slice(tChars.length).join("")}
          </span>
        )}
        {lineIdx < correctLines.length - 1 && <br />}
      </div>
    );
  });
}

export default function SubjectExam({ subjectId }: SubjectExamProps) {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<"intro" | "exam" | "result">("intro");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState("");
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [questionStartTime, setQuestionStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isRandom, setIsRandom] = useState(false);
  const [examQuestions, setExamQuestions] = useState<typeof textQuestions>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: subject } = trpc.subjects.getById.useQuery({ id: subjectId });
  const { data: questions } = trpc.questions.listBySubject.useQuery({ subjectId });
  const utils = trpc.useUtils();
  // 결과 화면에서 안정도 확인용 - phase가 result일 때만 페치
  const { data: confidenceData } = trpc.confidence.getBySubject.useQuery(
    { subjectId },
    { enabled: phase === "result" }
  );

  // 텍스트 문제만 필터링 (이미지/표 제외)
  const textQuestions = questions?.filter(q => !q.imageUrl && !q.tableData) || [];

  const evaluateMutation = trpc.test.evaluate.useMutation({
    onSuccess: () => {
      // 채점 후 안정도 캐시 무효화
      utils.confidence.getBySubject.invalidate({ subjectId });
    },
  });

  // 타이머
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (phase === "exam" && startTime) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [phase, startTime]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleStart = useCallback(() => {
    if (textQuestions.length === 0) {
      toast.error("연습할 텍스트 문제가 없습니다.");
      return;
    }
    const ordered = isRandom
      ? [...textQuestions].sort(() => Math.random() - 0.5)
      : [...textQuestions];
    setExamQuestions(ordered);
    setPhase("exam");
    setCurrentIndex(0);
    setResults([]);
    setUserAnswer("");
    const now = Date.now();
    setStartTime(now);
    setQuestionStartTime(now);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [textQuestions, isRandom]);

  const handleSubmitAnswer = useCallback(async () => {
    if (isSubmitting) return;
    const question = examQuestions[currentIndex];
    if (!question) return;

    setIsSubmitting(true);
    const recallTime = questionStartTime ? Math.floor((Date.now() - questionStartTime) / 1000) : 0;

    try {
      const evalResult = await evaluateMutation.mutateAsync({
        questionId: question.id,
        userAnswer: userAnswer.trim(),
        recallTime,
      });

      const result: QuestionResult = {
        questionId: question.id,
        question: question.question,
        correctAnswer: question.answer || "",
        userAnswer: userAnswer.trim(),
        isCorrect: evalResult.isCorrect === true,
        accuracyRate: (evalResult as any).accuracyRate ?? (evalResult.isCorrect ? 100 : 0),
        correctLineCount: (evalResult as any).correctLineCount ?? (evalResult.isCorrect ? 1 : 0),
        totalLines: (evalResult as any).totalLines ?? 1,
        recallTime,
      };

      const newResults = [...results, result];
      setResults(newResults);

      if (currentIndex + 1 < examQuestions.length) {
        setCurrentIndex(currentIndex + 1);
        setUserAnswer("");
        setQuestionStartTime(Date.now());
        setTimeout(() => textareaRef.current?.focus(), 100);
      } else {
        setPhase("result");
      }
    } catch (error: any) {
      toast.error("채점 실패: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, textQuestions, currentIndex, userAnswer, results, questionStartTime, evaluateMutation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handleSubmitAnswer();
    }
  }, [handleSubmitAnswer]);

  // 결과 요약
  const totalCorrect = results.filter(r => r.isCorrect).length;
  const totalQuestions = results.length;
  const overallAccuracy = totalQuestions > 0
    ? Math.round(results.reduce((sum, r) => sum + r.accuracyRate, 0) / totalQuestions)
    : 0;
  const isExamSuccess = totalQuestions > 0 && (totalCorrect / totalQuestions) >= 0.8;

  if (!questions) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">불러오는 중...</div>
      </div>
    );
  }

  // ── 인트로 화면 ──────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 gap-1.5"
          onClick={() => setLocation(`/subject-practice/${subjectId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
          연습으로 돌아가기
        </Button>

        <div className="text-center py-8">
          <div className="text-5xl mb-4">📝</div>
          <h1 className="text-2xl font-bold mb-2">{subject?.name} 모의고사</h1>
          <p className="text-muted-foreground mb-6">
            과목 내 텍스트 문제를 풀어봅니다.
          </p>

          {/* 랜덤 순서 토글 */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <button
              onClick={() => setIsRandom(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                !isRandom ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              순서대로
            </button>
            <button
              onClick={() => setIsRandom(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isRandom ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              랜덤 순서
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-8 max-w-sm mx-auto">
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{textQuestions.length}</div>
              <div className="text-xs text-muted-foreground mt-1">문제 수</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-500">80%</div>
              <div className="text-xs text-muted-foreground mt-1">성공 기준</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">∞</div>
              <div className="text-xs text-muted-foreground mt-1">제한 없음</div>
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-4 mb-8 text-sm text-muted-foreground text-left max-w-sm mx-auto">
            <p className="font-medium text-foreground mb-2">안내</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>각 문제에 정답을 입력하고 <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Shift+Enter</kbd>로 제출</li>
              <li>이미지/표 문제는 제외됩니다</li>
              <li>80% 이상 정답 시 안정도 초록불 달성</li>
            </ul>
          </div>

          <Button
            size="lg"
            className="gap-2 px-8"
            onClick={handleStart}
            disabled={textQuestions.length === 0}
          >
            <ChevronRight className="h-5 w-5" />
            시험 시작
          </Button>
        </div>
      </div>
    );
  }

  // ── 시험 화면 ──────────────────────────────────────────────────
  if (phase === "exam") {
    const question = examQuestions[currentIndex];
    const progress = ((currentIndex) / examQuestions.length) * 100;

    return (
      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              if (confirm("시험을 중단하시겠습니까?")) {
                setPhase("intro");
                setResults([]);
                setCurrentIndex(0);
              }
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">
                {currentIndex + 1} / {examQuestions.length}
              </span>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {formatTime(elapsedTime)}
              </div>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        </div>

        {/* 문제 */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start gap-3 mb-4">
            <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">
              Q{currentIndex + 1}
            </Badge>
            <p className="text-base font-medium leading-relaxed whitespace-pre-wrap">
              {question?.question}
            </p>
          </div>

          <Textarea
            ref={textareaRef}
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={handleKeyDown}
            placeholder="정답을 입력하세요..."
            className="min-h-[200px] resize-none font-medium"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />

          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-muted-foreground">
              <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Shift+Enter</kbd> 제출
            </span>
            <Button
              onClick={handleSubmitAnswer}
              disabled={isSubmitting || !userAnswer.trim()}
              className="gap-1.5"
            >
              {isSubmitting ? "채점 중..." : currentIndex + 1 < textQuestions.length ? "다음 문제" : "제출 완료"}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 이전 결과 미리보기 */}
        {results.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {results.map((r, i) => (
              <div
                key={i}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${r.isCorrect ? "bg-green-500" : "bg-red-500"}`}
                title={`Q${i + 1}: ${r.isCorrect ? "정답" : "오답"} (${r.accuracyRate}%)`}
              >
                {i + 1}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── 결과 화면 ──────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
      {/* 결과 요약 */}
      <div className={`rounded-xl p-6 text-center ${isExamSuccess ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
        <div className="text-4xl mb-3">
          {isExamSuccess ? "🎉" : "📚"}
        </div>
        <h2 className="text-xl font-bold mb-1">
          {isExamSuccess ? "시험 성공!" : "아직 더 공부가 필요해요"}
        </h2>
        <p className="text-muted-foreground text-sm mb-4">
          {totalCorrect}/{totalQuestions} 정답 ({Math.round((totalCorrect / totalQuestions) * 100)}%)
        </p>

        <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${isExamSuccess ? "text-green-500" : "text-red-500"}`}>
              {totalCorrect}/{totalQuestions}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">정답 수</div>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-500">{overallAccuracy}%</div>
            <div className="text-xs text-muted-foreground mt-0.5">평균 정확도</div>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{formatTime(elapsedTime)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">소요 시간</div>
          </div>
        </div>
      </div>

      {/* 문제별 결과 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">문제별 결과</h3>
        {results.map((r, i) => (
          <div
            key={i}
            className={`rounded-lg border p-4 ${r.isCorrect ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"}`}
          >
            <div className="flex items-start gap-3 mb-2">
              {r.isCorrect ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug">{r.question}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    variant="outline"
                    className={`text-xs ${r.isCorrect ? "text-green-600 border-green-500/30" : "text-red-600 border-red-500/30"}`}
                  >
                    {r.correctLineCount}/{r.totalLines}줄 · {r.accuracyRate}%
                  </Badge>
                  <span className="text-xs text-muted-foreground">{r.recallTime}초</span>
                </div>
              </div>
            </div>

            {/* 안정도 표시 */}
            {(() => {
              const conf = confidenceData?.questions?.find(q => q.questionId === r.questionId);
              if (!conf) return null;
              const stateColor = conf.state === 'green' ? 'text-emerald-600' : conf.state === 'yellow' ? 'text-amber-600' : 'text-red-600';
              const stateBg = conf.state === 'green' ? 'bg-emerald-500/10' : conf.state === 'yellow' ? 'bg-amber-500/10' : 'bg-red-500/10';
              return (
                <div className={`mt-1.5 pl-7 flex items-center gap-1.5`}>
                  <span className="text-xs text-muted-foreground">안정도:</span>
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${stateBg} ${stateColor}`}>
                    {conf.displayScore}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({conf.state === 'green' ? '안정' : conf.state === 'yellow' ? '주의' : '위험'})
                  </span>
                </div>
              );
            })()}
            {!r.isCorrect && (
              <div className="mt-2 space-y-1.5 pl-7">
                <div className="text-xs text-muted-foreground font-medium">정답:</div>
                <div className="text-xs bg-background/60 rounded p-2">
                  {renderColoredAnswer(r.correctAnswer, r.userAnswer)}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 액션 버튼 */}
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className="flex-1 gap-1.5"
          onClick={() => {
            setPhase("intro");
            setResults([]);
            setCurrentIndex(0);
            setUserAnswer("");
          }}
        >
          <RotateCcw className="h-4 w-4" />
          다시 시험
        </Button>
        <Button
          className="flex-1 gap-1.5"
          onClick={() => setLocation(`/subject-practice/${subjectId}`)}
        >
          <Trophy className="h-4 w-4" />
          연습으로 돌아가기
        </Button>
      </div>
    </div>
  );
}
