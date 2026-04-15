import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Clock, Trophy, RotateCcw, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { TableView, TableData, getBlankCells, gradeTable } from "@/components/TableEditor";
import { estimateTestConfidenceDelta } from "@shared/examConfidence";

interface SubjectExamProps {
  subjectId: number;
  isDemo?: boolean;
}

type ExamQuestion = {
  id: number;
  question: string;
  answer?: string | null;
  tableData?: string | null;
  imageUrl?: string | null;
  imageLabels?: string | null;
  autoNumbering?: number | null;
};

type EvalResult = {
  isCorrect: boolean;
  similarityScore: number;
  accuracyRate: number;
  correctLineCount?: number;
  totalLines?: number;
  mistakes?: Array<{
    lineIndex?: number;
    labelIndex?: number;
    cellKey?: string;
    correctAnswer?: string;
    userAnswer?: string;
    isCorrect?: boolean;
  }>;
  feedback?: string;
  llmFeedback?: string | null;
  userAnswer?: string;
  submitted: boolean;
  wasBlank?: boolean;
};

type QuestionOutcome = {
  eval: EvalResult;
  confidenceBefore: number;
  confidenceAfter: number;
  confidenceDelta: number;
  confidenceDeltaEstimated?: boolean;
  stateBefore?: string;
  stateAfter?: string;
};

type SubjectConfidenceSnapshot = {
  aggregateScore: number;
  questionScoreMap: Record<number, number>;
  questionStateMap: Record<number, string>;
};

type QuestionConfidencePoint = {
  score: number;
  state: string;
};

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

function getTableCorrectAnswerByCellKey(tableData: TableData, key: string): string {
  const [rStr, cStr] = key.split("-");
  const r = Number(rStr);
  const c = Number(cStr);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return "";
  return (tableData.cells?.[r]?.[c]?.content ?? "").toString();
}

function toSubjectConfidenceSnapshot(data: any): SubjectConfidenceSnapshot {
  const questionScoreMap: Record<number, number> = {};
  const questionStateMap: Record<number, string> = {};
  for (const q of data?.questions || []) {
    questionScoreMap[q.questionId] = Math.round(q.displayScore ?? 0);
    questionStateMap[q.questionId] = q.state ?? "red";
  }
  return {
    aggregateScore: Math.round(data?.aggregate?.averageScore ?? 0),
    questionScoreMap,
    questionStateMap,
  };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function stateFromScore(score: number): string {
  if (score >= 80) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

export default function SubjectExam({ subjectId, isDemo = false }: SubjectExamProps) {
  const [location, setLocation] = useLocation();
  const searchParams = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, [location]);
  const isDemoLinkedMode = !isDemo && searchParams.get("demo") === "1";
  const demoLinkedSubjectIdRaw = Number.parseInt(searchParams.get("demoSubjectId") || "", 10);
  const demoLinkedSubjectId =
    Number.isFinite(demoLinkedSubjectIdRaw) && demoLinkedSubjectIdRaw > 0
      ? demoLinkedSubjectIdRaw
      : null;
  const subjectQuestionsPath = isDemo
    ? `/demo/questions/${subjectId}`
    : isDemoLinkedMode && demoLinkedSubjectId
      ? `/questions/${subjectId}?demo=1&demoSubjectId=${demoLinkedSubjectId}`
      : `/questions/${subjectId}`;

  const [phase, setPhase] = useState<"intro" | "exam" | "result">("intro");
  const [textAnswers, setTextAnswers] = useState<Record<number, string>>({});
  const [tableAnswers, setTableAnswers] = useState<Record<number, Record<string, string>>>({});
  const [imageLabelAnswers, setImageLabelAnswers] = useState<Record<number, Record<number, string>>>({});
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<number, QuestionOutcome>>({});
  const [subjectScoreBefore, setSubjectScoreBefore] = useState<number | null>(null);
  const [subjectScoreAfter, setSubjectScoreAfter] = useState<number | null>(null);

  const [isRandom, setIsRandom] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([]);

  const { data: subject } = trpc.subjects.getById.useQuery({ id: subjectId });
  const userQuestionsQuery = trpc.questions.listBySubject.useQuery(
    { subjectId },
    { enabled: !isDemo }
  );
  const demoQuestionsQuery = trpc.demo.questions.useQuery(
    { subjectId },
    { enabled: isDemo }
  );
  const demoLinkedPreviewQuery = trpc.demo.questions.useQuery(
    { subjectId: demoLinkedSubjectId ?? 0 },
    { enabled: isDemoLinkedMode && !!demoLinkedSubjectId, refetchOnWindowFocus: false }
  );
  const questions = useMemo(() => {
    const baseQuestions = isDemo ? demoQuestionsQuery.data : userQuestionsQuery.data;
    if (!baseQuestions) return baseQuestions;
    if (!isDemoLinkedMode || !demoLinkedSubjectId) return baseQuestions;
    if (!demoLinkedPreviewQuery.data) return undefined;
    const allowedSourceQuestionIds = new Set(demoLinkedPreviewQuery.data.map((question) => question.id));
    return baseQuestions.filter((question: any) =>
      allowedSourceQuestionIds.has(question.demoSourceQuestionId ?? -1)
    );
  }, [
    demoLinkedPreviewQuery.data,
    demoLinkedSubjectId,
    demoQuestionsQuery.data,
    isDemo,
    isDemoLinkedMode,
    userQuestionsQuery.data,
  ]);
  const utils = trpc.useUtils();

  const evaluateMutation = trpc.test.evaluate.useMutation({
    onSuccess: () => {
      utils.confidence.getBySubject.invalidate({ subjectId });
    },
  });
  const demoEvaluateMutation = trpc.demo.evaluate.useMutation();
  const createTestMutation = trpc.test.create.useMutation();
  const updateReviewMutation = trpc.review.updateAfterReview.useMutation();

  useEffect(() => {
    if (!questions) return;
    if (questionCount <= 0) {
      setQuestionCount(questions.length);
    } else if (questionCount > questions.length) {
      setQuestionCount(questions.length);
    }
  }, [questions, questionCount]);

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

  const totalAvailable = questions?.length || 0;

  const hasAnswer = useCallback(
    (q: ExamQuestion) => {
      const tableData: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
      const imageLabels: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];

      if (tableData) {
        return Object.values(tableAnswers[q.id] || {}).some((v) => v.trim());
      }
      if (q.imageUrl && imageLabels.length > 0) {
        return Object.values(imageLabelAnswers[q.id] || {}).some((v: any) => v.trim());
      }
      return (textAnswers[q.id] || "").trim().length > 0;
    },
    [textAnswers, tableAnswers, imageLabelAnswers]
  );

  const answeredCount = useMemo(() => {
    if (examQuestions.length === 0) return 0;
    return examQuestions.filter((q) => hasAnswer(q)).length;
  }, [examQuestions, hasAnswer]);

  const handleStart = useCallback(() => {
    if (!questions || questions.length === 0) {
      toast.error("문제가 없습니다.");
      return;
    }

    const count = Math.min(questions.length, Math.max(1, Math.floor(questionCount || questions.length)));
    const ordered = isRandom ? [...questions].sort(() => Math.random() - 0.5) : [...questions];
    const selected = ordered.slice(0, count) as ExamQuestion[];

    setExamQuestions(selected);
    setPhase("exam");
    setTextAnswers({});
    setTableAnswers({});
    setImageLabelAnswers({});
    setOutcomes({});
    setSubjectScoreBefore(null);
    setSubjectScoreAfter(null);

    const now = Date.now();
    setStartTime(now);
    setElapsedTime(0);
  }, [questions, questionCount, isRandom]);

  const handleFinishExam = useCallback(async () => {
    if (isSubmitting) return;
    if (!confirm("시험을 종료하고 제출할까요?")) return;

    setIsSubmitting(true);
    try {
      const recallTimeForExam = startTime ? Math.floor((Date.now() - startTime) / 1000) : elapsedTime;
      const examEndDate = subject?.examEndDate ? new Date(subject.examEndDate) : null;
      const hoursUntilExam = examEndDate ? (examEndDate.getTime() - Date.now()) / (1000 * 60 * 60) : null;

      if (!isDemo) {
        await utils.confidence.getBySubject.invalidate({ subjectId });
      }
      const beforeConfidenceRaw = isDemo
        ? await utils.demo.confidenceBySubject.fetch({ subjectId })
        : await utils.confidence.getBySubject.fetch({ subjectId });
      const beforeSnapshot = toSubjectConfidenceSnapshot(beforeConfidenceRaw);
      const fetchQuestionConfidence = async (
        questionId: number,
        fallback?: QuestionConfidencePoint
      ): Promise<QuestionConfidencePoint> => {
        try {
          const raw = isDemo
            ? await utils.demo.confidenceByQuestion.fetch({ questionId })
            : await utils.confidence.getByQuestion.fetch({ questionId });
          return {
            score: clampScore(Number((raw as any)?.displayScore ?? fallback?.score ?? 0)),
            state: String((raw as any)?.state ?? fallback?.state ?? "red"),
          };
        } catch {
          return {
            score: clampScore(fallback?.score ?? 0),
            state: fallback?.state ?? "red",
          };
        }
      };

      const beforeQuestionEntries = await Promise.all(
        examQuestions.map(async (q) => {
          const fallback = {
            score: beforeSnapshot.questionScoreMap[q.id] ?? 0,
            state: beforeSnapshot.questionStateMap[q.id] ?? "red",
          };
          if (!isDemo) {
            await utils.confidence.getByQuestion.invalidate({ questionId: q.id });
          }
          const point = await fetchQuestionConfidence(q.id, fallback);
          return [q.id, point] as const;
        })
      );
      const beforeQuestionMap = Object.fromEntries(beforeQuestionEntries) as Record<number, QuestionConfidencePoint>;
      const nextOutcomes: Record<number, QuestionOutcome> = {};

      for (const q of examQuestions) {
        const tableData: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
        const imageLabels: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];

        let ans = "";
        if (tableData) {
          const blankCells = getBlankCells(tableData);
          const tAns = tableAnswers[q.id] || {};
          ans = blankCells.map((k) => tAns[k] || "").join("\n");
        } else if (q.imageUrl && imageLabels.length > 0) {
          const lAns = imageLabelAnswers[q.id] || {};
          ans = imageLabels.map((_: any, i: number) => `${i + 1}. ${lAns[i] || ""}`).join("\n");
        } else {
          ans = (textAnswers[q.id] || "").trim();
        }

        if (!ans.trim()) {
          if (!isDemo) {
            await createTestMutation.mutateAsync({
              questionId: q.id,
              userAnswer: "",
              isCorrect: 0,
              recallTime: recallTimeForExam,
              similarityScore: 0,
            });
            await updateReviewMutation.mutateAsync({
              questionId: q.id,
              quality: 0,
            });
          }

          const beforePoint = beforeQuestionMap[q.id];
          const baseScore = beforePoint?.score ?? 0;
          nextOutcomes[q.id] = {
            eval: {
              isCorrect: false,
              similarityScore: 0,
              accuracyRate: 0,
              feedback: "미작성 (오답 처리)",
              userAnswer: "",
              submitted: true,
              wasBlank: true,
            },
            confidenceBefore: baseScore,
            confidenceAfter: baseScore,
            confidenceDelta: 0,
            stateBefore: beforePoint?.state ?? "red",
            stateAfter: beforePoint?.state ?? "red",
          };
          continue;
        }

        if (tableData) {
          const blankCells = getBlankCells(tableData);
          const answerMap = tableAnswers[q.id] || {};
          const tableGrade = gradeTable(tableData, answerMap);
          const similarityScore = tableGrade.total > 0 ? Math.round((tableGrade.score / tableGrade.total) * 100) : 0;
          const tableMistakes = blankCells.map((key, idx) => ({
            lineIndex: idx + 1,
            cellKey: key,
            correctAnswer: getTableCorrectAnswerByCellKey(tableData, key),
            userAnswer: answerMap[key] || "",
            isCorrect: !!tableGrade.results[key],
          }));

          const quality = tableGrade.score === tableGrade.total
            ? (recallTimeForExam <= 15 ? 5 : 4)
            : (similarityScore >= 80 ? 2 : similarityScore >= 60 ? 1 : 0);
          if (!isDemo) {
            await createTestMutation.mutateAsync({
              questionId: q.id,
              userAnswer: ans,
              isCorrect: tableGrade.score === tableGrade.total ? 1 : 0,
              recallTime: recallTimeForExam,
              similarityScore,
              mistakeHighlights: JSON.stringify(tableMistakes),
            });
            await updateReviewMutation.mutateAsync({
              questionId: q.id,
              quality,
            });
          }

          nextOutcomes[q.id] = {
            eval: {
              isCorrect: tableGrade.score === tableGrade.total,
              similarityScore,
              accuracyRate: similarityScore,
              correctLineCount: tableGrade.score,
              totalLines: tableGrade.total,
              mistakes: tableMistakes,
              feedback: tableGrade.score === tableGrade.total
                ? "정확하게 작성하셨습니다!"
                : `${tableGrade.score}/${tableGrade.total} 정답`,
              userAnswer: ans,
              submitted: true,
            },
            confidenceBefore: beforeQuestionMap[q.id]?.score ?? 0,
            confidenceAfter: beforeQuestionMap[q.id]?.score ?? 0,
            confidenceDelta: 0,
            stateBefore: beforeQuestionMap[q.id]?.state ?? "red",
            stateAfter: beforeQuestionMap[q.id]?.state ?? "red",
          };
          continue;
        }

        const evalInput = {
          questionId: q.id,
          userAnswer: ans,
          recallTime: recallTimeForExam,
        };
        const evalRaw = isDemo
          ? await demoEvaluateMutation.mutateAsync(evalInput)
          : await evaluateMutation.mutateAsync(evalInput);

        const isCorrect = toBool((evalRaw as any)?.isCorrect);
        const similarityScore = Number((evalRaw as any)?.similarityScore ?? 0);
        const quality = isCorrect
          ? (recallTimeForExam <= 15 ? 5 : recallTimeForExam <= 35 ? 4 : 3)
          : (similarityScore >= 80 ? 2 : similarityScore >= 60 ? 1 : 0);
        if (!isDemo) {
          await updateReviewMutation.mutateAsync({
            questionId: q.id,
            quality,
          });
        }

        nextOutcomes[q.id] = {
          eval: {
            isCorrect,
            similarityScore,
            accuracyRate: Number((evalRaw as any)?.accuracyRate ?? similarityScore),
            correctLineCount: (evalRaw as any)?.correctLineCount,
            totalLines: (evalRaw as any)?.totalLines,
            mistakes: (evalRaw as any)?.mistakes,
            feedback: (evalRaw as any)?.feedback,
            llmFeedback: (evalRaw as any)?.llmFeedback ?? null,
            userAnswer: ans,
            submitted: true,
          },
          confidenceBefore: beforeQuestionMap[q.id]?.score ?? 0,
          confidenceAfter: beforeQuestionMap[q.id]?.score ?? 0,
          confidenceDelta: 0,
          stateBefore: beforeQuestionMap[q.id]?.state ?? "red",
          stateAfter: beforeQuestionMap[q.id]?.state ?? "red",
        };
      }

      let afterSnapshot = beforeSnapshot;
      let afterQuestionMap = beforeQuestionMap;
      if (!isDemo) {
        await Promise.all(
          examQuestions.map((q) => utils.confidence.getByQuestion.invalidate({ questionId: q.id }))
        );
        await utils.confidence.getBySubject.invalidate({ subjectId });
        const afterConfidenceRaw = await utils.confidence.getBySubject.fetch({ subjectId });
        afterSnapshot = toSubjectConfidenceSnapshot(afterConfidenceRaw);
        const afterQuestionEntries = await Promise.all(
          examQuestions.map(async (q) => {
            const fallback = {
              score: afterSnapshot.questionScoreMap[q.id] ?? beforeQuestionMap[q.id]?.score ?? 0,
              state: afterSnapshot.questionStateMap[q.id] ?? beforeQuestionMap[q.id]?.state ?? "red",
            };
            const point = await fetchQuestionConfidence(q.id, fallback);
            return [q.id, point] as const;
          })
        );
        afterQuestionMap = Object.fromEntries(afterQuestionEntries) as Record<number, QuestionConfidencePoint>;
      }

      for (const q of examQuestions) {
        const beforePoint = beforeQuestionMap[q.id];
        const afterPoint = afterQuestionMap[q.id];
        const before = beforePoint?.score ?? 0;
        const after = afterPoint?.score ?? before;
        const item = nextOutcomes[q.id];
        if (!item) continue;

        let displayedAfter = after;
        let deltaEstimated = false;

        // 개별 시험모드와 동일하게, 실측 변화가 0으로 보일 때는 추정 증감을 보강 표시
        if (item.eval.submitted && displayedAfter - before === 0) {
          const estimatedDelta = estimateTestConfidenceDelta({
            currentScore: before,
            isCorrect: item.eval.isCorrect,
            similarityScore: item.eval.similarityScore,
            recallTime: recallTimeForExam,
            hoursUntilExam,
          });
          if (estimatedDelta !== 0) {
            displayedAfter = clampScore(before + estimatedDelta);
            deltaEstimated = true;
          }
        }

        const displayedDelta = displayedAfter - before;
        item.confidenceBefore = before;
        item.confidenceAfter = displayedAfter;
        item.confidenceDelta = displayedDelta;
        item.confidenceDeltaEstimated = deltaEstimated;
        item.stateBefore = beforePoint?.state ?? "red";
        item.stateAfter = deltaEstimated
          ? stateFromScore(displayedAfter)
          : (afterPoint?.state ?? stateFromScore(displayedAfter));
      }

      setOutcomes(nextOutcomes);
      setSubjectScoreBefore(beforeSnapshot.aggregateScore);
      setSubjectScoreAfter(
        isDemo
          ? Math.round(
              examQuestions.reduce((sum, q) => sum + (nextOutcomes[q.id]?.confidenceAfter ?? beforeQuestionMap[q.id]?.score ?? 0), 0) /
                Math.max(1, examQuestions.length)
            )
          : afterSnapshot.aggregateScore
      );
      setPhase("result");
    } catch (error: any) {
      toast.error("채점 실패: " + (error?.message || "알 수 없는 오류"));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    startTime,
    elapsedTime,
    subjectId,
    examQuestions,
    tableAnswers,
    imageLabelAnswers,
    textAnswers,
    evaluateMutation,
    demoEvaluateMutation,
    createTestMutation,
    updateReviewMutation,
    utils.confidence.getBySubject,
    utils.confidence.getByQuestion,
    utils.demo.confidenceBySubject,
    utils.demo.confidenceByQuestion,
    subject,
    isDemo,
  ]);

  if (!questions) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (phase === "intro") {
    const presetCounts = [10, 20, 30].filter((n) => n <= totalAvailable);

    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 gap-1.5"
          onClick={() => setLocation(subjectQuestionsPath)}
        >
          <ArrowLeft className="h-4 w-4" />
          과목으로 돌아가기
        </Button>

        <div className="text-center py-8">
          <div className="text-5xl mb-4">📝</div>
          <h1 className="text-2xl font-bold mb-2">{subject?.name} 모의고사</h1>
          <p className="text-muted-foreground mb-6">시험지 형식으로 한 번에 풀고 마지막에 제출합니다.</p>

          <div className="grid grid-cols-3 gap-4 mb-8 max-w-sm mx-auto">
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{totalAvailable}</div>
              <div className="text-xs text-muted-foreground mt-1">전체 문제</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{Math.max(1, Math.min(questionCount || totalAvailable, totalAvailable))}</div>
              <div className="text-xs text-muted-foreground mt-1">출제 문제</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">∞</div>
              <div className="text-xs text-muted-foreground mt-1">시간 제한 없음</div>
            </div>
          </div>

          <div className="space-y-4 max-w-md mx-auto mb-8">
            <div className="text-left">
              <p className="text-sm font-medium mb-2">문항 수 설정</p>
              <div className="flex gap-2 mb-2 flex-wrap">
                <button
                  onClick={() => setQuestionCount(totalAvailable)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    questionCount === totalAvailable ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  전체 ({totalAvailable})
                </button>
                {presetCounts.map((n) => (
                  <button
                    key={n}
                    onClick={() => setQuestionCount(n)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      questionCount === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {n}문항
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min={1}
                max={totalAvailable}
                value={questionCount || totalAvailable}
                onChange={(e) => {
                  const num = Number(e.target.value);
                  if (Number.isNaN(num)) return;
                  setQuestionCount(Math.max(1, Math.min(totalAvailable, Math.floor(num))));
                }}
                className="h-8 text-sm"
              />
            </div>

            <div className="text-left">
              <p className="text-sm font-medium mb-2">출제 순서</p>
              <div className="flex items-center gap-3">
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
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-4 mb-8 text-sm text-muted-foreground text-left max-w-md mx-auto">
            <p className="font-medium text-foreground mb-2">안내</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>시험지처럼 아래로 스크롤하며 연속 풀이</li>
              <li>각 문제 답안은 자동 임시저장</li>
              <li>모든 작성 후 상단 "시험 종료"로 일괄 채점</li>
            </ul>
          </div>

          <Button
            size="lg"
            className="gap-2 px-8"
            onClick={handleStart}
            disabled={totalAvailable === 0}
          >
            <ChevronRight className="h-5 w-5" />
            시험 시작
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "exam") {
    return (
      <div className="max-w-4xl mx-auto px-4 pb-8 space-y-4">
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border -mx-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                if (confirm("시험을 중단하시겠습니까?")) {
                  setPhase("intro");
                  setTextAnswers({});
                  setTableAnswers({});
                  setImageLabelAnswers({});
                  setExamQuestions([]);
                  setOutcomes({});
                  setSubjectScoreBefore(null);
                  setSubjectScoreAfter(null);
                }
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">
                  {answeredCount} / {examQuestions.length}개 작성
                </span>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {formatTime(elapsedTime)}
                </div>
              </div>
              <Progress value={(answeredCount / Math.max(1, examQuestions.length)) * 100} className="h-1.5" />
            </div>

            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={handleFinishExam}
              disabled={isSubmitting}
            >
              {isSubmitting ? "채점 중..." : "시험 종료"}
            </Button>
          </div>
        </div>

        {examQuestions.map((q, idx) => {
          const tableData: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
          const imageLabels: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];
          const isTableQuestion = !!tableData;
          const isImageQuestion = !!q.imageUrl && imageLabels.length > 0;
          const answered = hasAnswer(q);

          return (
            <div key={q.id} className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">
                    Q{idx + 1}
                    {isTableQuestion && " 📊"}
                    {isImageQuestion && " 🖼"}
                  </Badge>
                  <p className="text-base font-medium leading-relaxed whitespace-pre-wrap">{q.question}</p>
                </div>
                <Badge variant={answered ? "default" : "secondary"} className="text-xs flex-shrink-0">
                  {answered ? "작성됨" : "미작성"}
                </Badge>
              </div>

              {isImageQuestion && (
                <div className="space-y-3">
                  <div className="relative">
                    <img src={q.imageUrl || ""} alt="문제 이미지" className="w-full rounded-lg border border-border" />
                    {imageLabels.map((_: any, labelIdx: number) => (
                      <div
                        key={labelIdx}
                        className="absolute w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold"
                        style={{
                          left: `${imageLabels[labelIdx]?.x ?? 0}%`,
                          top: `${imageLabels[labelIdx]?.y ?? 0}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      >
                        {labelIdx + 1}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    {imageLabels.map((_: any, labelIdx: number) => (
                      <div key={labelIdx} className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-primary min-w-[24px]">{labelIdx + 1}.</span>
                        <input
                          type="text"
                          value={(imageLabelAnswers[q.id] || {})[labelIdx] || ""}
                          onChange={(e) =>
                            setImageLabelAnswers((prev) => ({
                              ...prev,
                              [q.id]: { ...(prev[q.id] || {}), [labelIdx]: e.target.value },
                            }))
                          }
                          placeholder={`영역 ${labelIdx + 1} 답안`}
                          className="flex-1 h-8 px-3 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isTableQuestion && tableData && (
                <TableView
                  tableData={tableData}
                  answers={tableAnswers[q.id] || {}}
                  onAnswerChange={(key, value) =>
                    setTableAnswers((prev) => ({
                      ...prev,
                      [q.id]: { ...(prev[q.id] || {}), [key]: value },
                    }))
                  }
                />
              )}

              {!isTableQuestion && !isImageQuestion && (
                <Textarea
                  value={textAnswers[q.id] || ""}
                  onChange={(e) => setTextAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder="정답을 입력하세요..."
                  className="min-h-[160px] resize-y font-medium"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const subjectScoreDelta = (subjectScoreBefore !== null && subjectScoreAfter !== null)
    ? subjectScoreAfter - subjectScoreBefore
    : null;
  const gradedOutcomes = examQuestions
    .map((q) => outcomes[q.id])
    .filter((o): o is QuestionOutcome => !!o);
  const totalGradedCount = examQuestions.length;
  const correctCount = gradedOutcomes.filter((o) => o.eval.isCorrect).length;
  const avgSimilarity = totalGradedCount > 0
    ? Math.round(
        examQuestions.reduce((sum, q) => sum + (outcomes[q.id]?.eval.similarityScore ?? 0), 0) /
          totalGradedCount
      )
    : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="rounded-xl p-6 text-center bg-primary/5 border border-primary/20">
        <div className="text-4xl mb-3">📝</div>
        <h2 className="text-xl font-bold mb-1">시험 완료</h2>
        <p className="text-muted-foreground text-sm mb-4">
          {answeredCount}/{examQuestions.length}개 문제 답안 작성 · {formatTime(elapsedTime)} 소요
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg bg-background/60 border border-border p-2">
            <p className="text-muted-foreground">문항 정답</p>
            <p className="font-bold text-sm">{correctCount}/{totalGradedCount}</p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border p-2">
            <p className="text-muted-foreground">평균 유사도</p>
            <p className="font-bold text-sm">{avgSimilarity}%</p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border p-2">
            <p className="text-muted-foreground">과목 안정도</p>
            <p className="font-bold text-sm">
              {subjectScoreBefore ?? 0} → {subjectScoreAfter ?? 0}
            </p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border p-2">
            <p className="text-muted-foreground">과목 증감</p>
            <p className={`font-bold text-sm ${subjectScoreDelta === null ? "" : subjectScoreDelta > 0 ? "text-emerald-600" : subjectScoreDelta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
              {subjectScoreDelta === null ? "-" : `${subjectScoreDelta > 0 ? "+" : ""}${subjectScoreDelta}점`}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">문제별 채점 결과 · 안정도 반영</h3>
        {examQuestions.map((q, i) => {
          const tableData: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
          const imageLabels: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];
          const isImageQuestion = !!q.imageUrl && imageLabels.length > 0;
          const outcome = outcomes[q.id];

          let answerDisplay = "";
          if (tableData) {
            const blankCells = getBlankCells(tableData);
            answerDisplay = blankCells.map((k) => `${k}: ${(tableAnswers[q.id] || {})[k] || "(미작성)"}`).join("\n");
          } else if (isImageQuestion) {
            answerDisplay = imageLabels
              .map((_: any, idx: number) => `${idx + 1}. ${(imageLabelAnswers[q.id] || {})[idx] || "(미작성)"}`)
              .join("\n");
          } else {
            answerDisplay = (textAnswers[q.id] || "").trim();
          }

          const accuracySummary = outcome
            ? (typeof outcome.eval.totalLines === "number" && outcome.eval.totalLines > 0
              ? `${outcome.eval.correctLineCount ?? 0}/${outcome.eval.totalLines}`
              : `${Math.round(outcome.eval.accuracyRate)}%`)
            : "-";

          return (
            <div key={q.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">
                  Q{i + 1}
                  {tableData ? " 📊" : isImageQuestion ? " 🖼" : ""}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm font-medium leading-snug">{q.question}</p>
                    {outcome ? (
                      <Badge
                        variant={
                          outcome.eval.wasBlank
                            ? "secondary"
                            : outcome.eval.submitted
                              ? (outcome.eval.isCorrect ? "default" : "destructive")
                              : "secondary"
                        }
                        className="text-[11px]"
                      >
                        {outcome.eval.wasBlank ? "미작성" : outcome.eval.submitted ? (outcome.eval.isCorrect ? "정답" : "오답") : "미작성"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[11px]">미채점</Badge>
                    )}
                  </div>
                  {outcome && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                      <div className="text-center rounded-lg border border-border bg-muted/30 px-2 py-2">
                        <p className="text-2xl font-bold">{outcome.eval.isCorrect ? "✓" : "✗"}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">정답 여부</p>
                      </div>
                      <div className="text-center rounded-lg border border-border bg-muted/30 px-2 py-2">
                        <p className="text-2xl font-bold">{accuracySummary}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">정확도</p>
                      </div>
                      <div className="text-center rounded-lg border border-border bg-muted/30 px-2 py-2">
                        <p className="text-2xl font-bold">{Math.round(outcome.eval.similarityScore)}%</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">유사도</p>
                      </div>
                      <div className="text-center rounded-lg border border-border bg-muted/30 px-2 py-2">
                        <p className={`text-2xl font-bold ${outcome.confidenceDelta > 0 ? "text-emerald-600" : outcome.confidenceDelta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                          {outcome.confidenceDelta > 0 ? "+" : ""}{outcome.confidenceDelta}점
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          안정도 {outcome.confidenceBefore} → {outcome.confidenceAfter}
                        </p>
                        {outcome.confidenceDeltaEstimated && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">실측 0점으로 추정 반영</p>
                        )}
                      </div>
                    </div>
                  )}
                  {outcome?.eval.feedback && (
                    <p className="text-xs text-muted-foreground mt-2">{outcome.eval.feedback}</p>
                  )}
                  {outcome?.eval.llmFeedback && (
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{outcome.eval.llmFeedback}</p>
                  )}
                  {outcome?.eval.mistakes && outcome.eval.mistakes.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">정답 비교</p>
                      {outcome.eval.mistakes.slice(0, 6).map((m, idx) => (
                        <div
                          key={`${q.id}-${idx}`}
                          className={`p-3 rounded-lg border ${m.isCorrect ? "bg-green-50 border-green-300" : "bg-red-50 border-red-300"}`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold">
                              {m.lineIndex
                                ? `${m.lineIndex}줄`
                                : m.labelIndex
                                  ? `${m.labelIndex}번 라벨`
                                  : m.cellKey
                                    ? `셀 ${m.cellKey}`
                                    : `항목 ${idx + 1}`}
                            </span>
                            <span className={`text-base ${m.isCorrect ? "text-green-600" : "text-red-600"}`}>
                              {m.isCorrect ? "✓" : "✗"}
                            </span>
                          </div>
                          <div className="text-xs space-y-1">
                            <div><span className="font-semibold">정답:</span> {m.correctAnswer || "(없음)"}</div>
                            <div className={m.isCorrect ? "text-green-700" : "text-red-700"}>
                              <span className="font-semibold">내 답:</span> {m.userAnswer || "(미입력)"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!outcome?.eval.mistakes?.length && (
                    answerDisplay ? (
                      <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2 whitespace-pre-wrap font-mono mt-2">
                        {answerDisplay}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/50 italic mt-2">미작성</p>
                    )
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className="flex-1 gap-1.5"
          onClick={() => {
            setPhase("intro");
            setTextAnswers({});
            setTableAnswers({});
            setImageLabelAnswers({});
            setExamQuestions([]);
            setOutcomes({});
            setSubjectScoreBefore(null);
            setSubjectScoreAfter(null);
          }}
        >
          <RotateCcw className="h-4 w-4" />
          다시 시험
        </Button>
        <Button className="flex-1 gap-1.5" onClick={() => setLocation(subjectQuestionsPath)}>
          <Trophy className="h-4 w-4" />
          과목으로 돌아가기
        </Button>
      </div>
    </div>
  );
}
