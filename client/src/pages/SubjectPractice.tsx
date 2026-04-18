import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ClipboardCheck, BookOpen } from "lucide-react";
import { isPartialMatch, splitGraphemes } from "@/lib/hangul";
import { getAnalyticsRequestMeta } from "@/lib/analyticsSession";
import { toast } from "sonner";
import { formatQuestionTextForDisplay } from "@/lib/questionDisplay";

interface SubjectPracticeProps {
  subjectId: number;
}

interface PracticeQuestion {
  id: number;
  subjectId: number;
  displayOrder: number;
  question: string;
  answer?: string | null;
  tableData?: string | null;
  imageUrl?: string | null;
  imageLabels?: string | null;
}

const LEADING_BULLET_PREFIX_REGEX = /^\s*(?:[-*•·●○◦▪▫▸▹►▶‣⁃※])\s*/;

function normalizeText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(LEADING_BULLET_PREFIX_REGEX, ""))
    .join("\n")
    .replace(/\s+/g, "");
}

function getQuestionType(q: Pick<PracticeQuestion, "imageUrl" | "tableData">) {
  if (q.imageUrl) return "image" as const;
  if (q.tableData) return "table" as const;
  return "text" as const;
}

function getStateBarColor(state?: string) {
  if (state === "green") return "bg-emerald-500";
  if (state === "yellow") return "bg-amber-400";
  return "bg-red-500";
}

function isCompleteCharMatch(match: ReturnType<typeof isPartialMatch>) {
  return match === "complete" || match === "partial_complete";
}

function computeTextCompletionRatio(targetText: string, userInput: string): number {
  const targetLinesRaw = targetText.split("\n");
  const userLinesRaw = userInput.split("\n");

  const meaningfulTargetLines = targetLinesRaw
    .map((line, idx) => ({ line, idx, normalized: normalizeText(line) }))
    .filter((item) => item.normalized.length > 0);

  if (meaningfulTargetLines.length === 0) return 0;

  // 한 줄 문제는 문자 진행률로도 부분점수 인정
  if (meaningfulTargetLines.length === 1) {
    const line = meaningfulTargetLines[0];
    const targetChars = splitGraphemes(line.normalized);
    const userChars = splitGraphemes(normalizeText(userLinesRaw[line.idx] || ""));
    if (targetChars.length === 0) return 0;

    let matched = 0;
    for (let i = 0; i < Math.min(targetChars.length, userChars.length); i++) {
      const result = isPartialMatch(userChars[i], targetChars[i], targetChars[i + 1]);
      if (isCompleteCharMatch(result)) matched++;
      else break;
    }
    return Math.max(0, Math.min(1, matched / targetChars.length));
  }

  // 여러 줄 문제는 "완성한 줄 비율" 기반
  let completedLines = 0;

  for (const item of meaningfulTargetLines) {
    const targetChars = splitGraphemes(item.normalized);
    const userChars = splitGraphemes(normalizeText(userLinesRaw[item.idx] || ""));
    if (targetChars.length === 0) continue;
    if (userChars.length < targetChars.length) continue;

    let lineComplete = true;
    for (let i = 0; i < targetChars.length; i++) {
      const result = isPartialMatch(userChars[i] || "", targetChars[i], targetChars[i + 1]);
      if (!isCompleteCharMatch(result)) {
        lineComplete = false;
        break;
      }
    }

    if (lineComplete) completedLines++;
  }

  return Math.max(0, Math.min(1, completedLines / meaningfulTargetLines.length));
}

function renderColoredText(targetText: string, userInput: string, isComposing: boolean) {
  const targetLines = targetText.split("\n");
  const userLines = userInput.split("\n");

  return targetLines.map((line, lineIdx) => {
    const targetChars = splitGraphemes(line);
    const userChars = splitGraphemes(userLines[lineIdx] || "");

    return (
      <div key={lineIdx} className="font-semibold text-base leading-relaxed">
        {targetChars.map((ch, i) => {
          const uch = userChars[i];
          let colorClass = "text-muted-foreground/40";

          if (uch !== undefined) {
            if (isComposing && i === userChars.length - 1) {
              colorClass = "text-muted-foreground";
            } else {
              const match = isPartialMatch(uch, ch, targetChars[i + 1]);
              colorClass = isCompleteCharMatch(match) ? "text-foreground" : "text-red-500";
            }
          }

          return (
            <span key={i} className={`transition-colors duration-150 ${colorClass}`}>
              {ch}
            </span>
          );
        })}
        {lineIdx < targetLines.length - 1 && <br />}
      </div>
    );
  });
}

function TablePreview({ tableData }: { tableData: string }) {
  try {
    const td = JSON.parse(tableData);
    const rows: string[][] = td.rows || [];
    const headers: string[] = td.headers || [];

    return (
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse w-full">
          {headers.length > 0 && (
            <thead>
              <tr>
                {headers.map((h: string, i: number) => (
                  <th key={i} className="border border-border px-3 py-1.5 bg-muted text-left font-medium text-xs">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row: string[], ri: number) => (
              <tr key={ri}>
                {row.map((cell: string, ci: number) => (
                  <td key={ci} className="border border-border px-3 py-1.5 text-sm">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } catch {
    return <div className="text-sm text-muted-foreground italic">표 데이터 파싱 오류</div>;
  }
}

function QuestionPracticeSection({
  question,
  confidenceInfo,
  practiceCount,
  isFocused,
  onFocus,
  sectionRef,
}: {
  question: PracticeQuestion;
  confidenceInfo?: { displayScore: number; state: string; isColdStart: boolean };
  practiceCount: number;
  isFocused: boolean;
  onFocus: () => void;
  sectionRef: (el: HTMLDivElement | null) => void;
}) {
  const qType = getQuestionType(question);
  const isText = qType === "text";
  const displayQuestionText = formatQuestionTextForDisplay(question.question, question.answer);

  return (
    <div
      ref={sectionRef}
      className={`border-b border-border transition-colors duration-200 ${isFocused ? "bg-background" : "bg-muted/20"}`}
      onClick={onFocus}
      data-question-id={question.id}
    >
      <div
        className={`sticky top-0 z-10 flex items-center gap-3 px-6 py-3 border-b border-border/50 backdrop-blur-sm ${isFocused ? "bg-background/95" : "bg-muted/80"}`}
      >
        <span
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${isFocused ? "bg-primary" : "bg-muted-foreground/40"}`}
        >
          {question.displayOrder}
        </span>
        <span className="text-sm font-medium text-foreground truncate flex-1">
          {displayQuestionText.length > 60 ? displayQuestionText.slice(0, 60) + "…" : displayQuestionText}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {confidenceInfo && !confidenceInfo.isColdStart && (
            <span className="text-xs text-muted-foreground font-mono">{confidenceInfo.displayScore}점</span>
          )}
          <div className={`w-3 h-[3px] rounded-full ${getStateBarColor(confidenceInfo?.state)}`} />
          {practiceCount > 0 && (
            <Badge variant="secondary" className="text-xs h-5 px-1.5">
              {practiceCount}회
            </Badge>
          )}
          {qType !== "text" && (
            <Badge variant="outline" className="text-xs h-5 px-1.5">
              {qType === "image" ? "이미지" : "표"}
            </Badge>
          )}
        </div>
      </div>

      <div className="px-6 py-5">
        {isText && question.answer ? (
          <div className="text-base font-semibold leading-relaxed text-foreground whitespace-pre-wrap">{question.answer}</div>
        ) : qType === "table" && question.tableData ? (
          <TablePreview tableData={question.tableData} />
        ) : qType === "image" ? (
          <div className="text-sm text-muted-foreground italic">이미지 문제 — 하단 패널에서 백지시험으로 이동하세요</div>
        ) : (
          <div className="text-sm text-muted-foreground italic">답안 없음</div>
        )}
      </div>
    </div>
  );
}

function StickyInputPanel({
  question,
  draftValue,
  onDraftChange,
  onCorrect,
  onGoToTest,
}: {
  question: PracticeQuestion | null;
  draftValue: string;
  onDraftChange: (questionId: number, value: string) => void;
  onCorrect: (questionId: number) => void;
  onGoToTest: (questionId: number) => void;
}) {
  const [userInput, setUserInput] = useState(draftValue);
  const [isComposing, setIsComposing] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [damageValue, setDamageValue] = useState(0);
  const [showDamage, setShowDamage] = useState(false);
  const [localCompleteCountByQuestion, setLocalCompleteCountByQuestion] = useState<Record<number, number>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isResettingRef = useRef(false);

  const qType = question ? getQuestionType(question) : "text";
  const isText = qType === "text";
  const targetText = useMemo(() => (question?.answer ? question.answer : ""), [question?.answer]);

  useEffect(() => {
    setUserInput(draftValue || "");
    setIsFadingOut(false);
    isResettingRef.current = false;
  }, [question?.id, draftValue]);

  const handleCorrectAnswer = useCallback(() => {
    if (!question || isResettingRef.current) return;

    isResettingRef.current = true;
    const qid = question.id;
    setLocalCompleteCountByQuestion((prev) => ({ ...prev, [qid]: (prev[qid] || 0) + 1 }));

    setTimeout(() => setIsFadingOut(true), 120);
    setTimeout(() => {
      setIsComposing(false);
      setUserInput("");
      onDraftChange(qid, "");

      setShowDamage(false);
      requestAnimationFrame(() => {
        setDamageValue(1);
        setShowDamage(true);
      });

      setTimeout(() => {
        setIsFadingOut(false);
        isResettingRef.current = false;
        textareaRef.current?.focus();
      }, 50);

      onCorrect(qid);
    }, 320);
  }, [question, onDraftChange, onCorrect]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!question || isResettingRef.current) return;

      const next = e.target.value;
      setUserInput(next);
      onDraftChange(question.id, next);

      if (!isText || !targetText || isComposing) return;

      const ratio = computeTextCompletionRatio(targetText, next);
      if (ratio >= 0.999) {
        handleCorrectAnswer();
      }
    },
    [question, onDraftChange, isText, targetText, isComposing, handleCorrectAnswer]
  );

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      if (!question || isResettingRef.current) return;

      setIsComposing(false);
      const next = (e.target as HTMLTextAreaElement).value;
      setUserInput(next);
      onDraftChange(question.id, next);

      if (!isText || !targetText) return;

      const ratio = computeTextCompletionRatio(targetText, next);
      if (ratio >= 0.999) {
        handleCorrectAnswer();
      }
    },
    [question, onDraftChange, isText, targetText, handleCorrectAnswer]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && e.shiftKey && question) {
        e.preventDefault();
        onGoToTest(question.id);
      }
    },
    [question, onGoToTest]
  );

  if (!question) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-border px-6 py-4">
        <p className="text-sm text-muted-foreground text-center">문제를 선택하세요</p>
      </div>
    );
  }

  const isImageOrTable = qType === "image" || qType === "table";
  const localCompleteCount = localCompleteCountByQuestion[question.id] || 0;
  const displayQuestionText = formatQuestionTextForDisplay(question.question, question.answer);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/98 backdrop-blur-md border-t border-border shadow-lg">
      {showDamage && (
        <div
          className="absolute -top-8 left-1/2 -translate-x-1/2 text-green-500 font-bold text-lg animate-in fade-in slide-in-from-bottom-2 duration-300 pointer-events-none"
          onAnimationEnd={() => setTimeout(() => setShowDamage(false), 600)}
        >
          +{damageValue}점
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-primary">#{question.displayOrder}</span>
          <span className="text-xs text-muted-foreground truncate flex-1">
            {displayQuestionText.length > 70 ? displayQuestionText.slice(0, 70) + "…" : displayQuestionText}
          </span>
          {localCompleteCount > 0 && (
            <Badge variant="secondary" className="text-xs h-5 px-1.5 flex-shrink-0">
              이번 {localCompleteCount}회
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs flex-shrink-0"
            onClick={() => onGoToTest(question.id)}
          >
            <ClipboardCheck className="h-3 w-3 mr-1" />
            백지시험
            <span className="ml-1 text-muted-foreground">(Shift+↵)</span>
          </Button>
        </div>

        {isImageOrTable ? (
          <div className="flex items-center gap-2 py-2">
            <span className="text-sm text-muted-foreground">
              {qType === "image" ? "이미지" : "표"} 문제는 개별 연습 페이지에서 진행하세요.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => window.open(`/practice/${question.id}`, "_self")}
            >
              개별 연습
            </Button>
          </div>
        ) : (
          <div className="relative">
            <div
              className={`absolute inset-0 pointer-events-none px-3 py-2 font-semibold text-base leading-relaxed whitespace-pre-wrap break-words overflow-hidden transition-opacity duration-300 ${isFadingOut ? "opacity-0" : "opacity-100"}`}
              aria-hidden
            >
              {renderColoredText(targetText, userInput, isComposing)}
            </div>
            <textarea
              ref={textareaRef}
              className="relative w-full bg-transparent text-transparent caret-foreground resize-none outline-none font-semibold text-base leading-relaxed px-3 py-2 min-h-[60px] max-h-[120px]"
              value={userInput}
              onChange={handleInputChange}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={handleCompositionEnd}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function SubjectPractice({ subjectId }: SubjectPracticeProps) {
  const [, setLocation] = useLocation();
  const [focusedQuestionId, setFocusedQuestionId] = useState<number | null>(null);
  const [practiceCounts, setPracticeCounts] = useState<Record<number, number>>({});
  const [draftsByQuestion, setDraftsByQuestion] = useState<Record<number, string>>({});

  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleQuestionsRef = useRef<Set<number>>(new Set());
  const prevFocusedQuestionRef = useRef<number | null>(null);
  const savedProgressRatioRef = useRef<Record<number, number>>({});
  const draftStartedAtRef = useRef<Record<number, number>>({});
  const appliedInitialFocusRef = useRef(false);

  const utils = trpc.useUtils();

  const { data: subject } = trpc.subjects.getById.useQuery({ id: subjectId });
  const { data: questions } = trpc.questions.listBySubject.useQuery({ subjectId });
  const { data: confidenceData } = trpc.confidence.getBySubject.useQuery({ subjectId });
  const { data: subjectPracticeSessions } = trpc.practice.getBySubject.useQuery({ subjectId });

  const createSession = trpc.practice.create.useMutation();

  const questionMap = useMemo(() => {
    const map: Record<number, PracticeQuestion> = {};
    (questions || []).forEach((q) => {
      map[q.id] = q as PracticeQuestion;
    });
    return map;
  }, [questions]);

  const confidenceMap = useMemo(() => {
    const map: Record<number, { displayScore: number; state: string; isColdStart: boolean }> = {};
    confidenceData?.questions.forEach((q) => {
      map[q.questionId] = { displayScore: q.displayScore, state: q.state, isColdStart: q.isColdStart };
    });
    return map;
  }, [confidenceData]);

  useEffect(() => {
    if (!subjectPracticeSessions) return;
    const byQuestion: Record<number, number> = {};
    for (const session of subjectPracticeSessions) {
      byQuestion[session.questionId] = (byQuestion[session.questionId] || 0) + 1;
    }

    setPracticeCounts((prev) => {
      const next = { ...prev };
      for (const [qid, cnt] of Object.entries(byQuestion)) {
        const numQid = Number(qid);
        next[numQid] = Math.max(next[numQid] || 0, cnt);
      }
      return next;
    });
  }, [subjectPracticeSessions]);

  useEffect(() => {
    if (!questions || questions.length === 0 || appliedInitialFocusRef.current) return;

    const queryId = Number(new URLSearchParams(window.location.search).get("q"));
    const hasQueryTarget = Number.isFinite(queryId) && questions.some((q) => q.id === queryId);
    const initialId = hasQueryTarget ? queryId : questions[0].id;

    setFocusedQuestionId(initialId);

    requestAnimationFrame(() => {
      sectionRefs.current[initialId]?.scrollIntoView({ behavior: "auto", block: "start" });
    });

    appliedInitialFocusRef.current = true;
  }, [questions]);

  const recordPracticeSession = useCallback(
    async (questionId: number, completionRatio: number): Promise<boolean> => {
      const question = questionMap[questionId];
      if (!question) return false;

      const ratio = Math.max(0, Math.min(1, completionRatio));
      const answerChars = splitGraphemes(normalizeText(question.answer || "")).length;
      const now = Date.now();
      const startedAt = draftStartedAtRef.current[questionId] || now;
      const elapsedSec = Math.max(1, Math.round((now - startedAt) / 1000));

      const duration = ratio >= 0.999
        ? elapsedSec
        : Math.max(1, Math.round(elapsedSec * Math.max(0.25, ratio)));
      const typedChars = Math.max(1, Math.round(Math.max(answerChars, 20) * Math.max(ratio, 0.1)));
      const typingSpeed = Math.max(1, Math.round(typedChars / (duration / 60)));
      const accuracy = Math.max(1, Math.min(100, Math.round(ratio * 100)));
      const errorCount = Math.max(0, Math.round((1 - ratio) * Math.max(1, answerChars)));

      try {
        await createSession.mutateAsync({
          questionId,
          duration,
          typingSpeed,
          accuracy,
          errorCount,
          analytics: {
            ...getAnalyticsRequestMeta(),
            source: "subject_practice",
            completionRatio: ratio,
            blindMode: false,
            typedLength: typedChars,
          },
        });

        setPracticeCounts((prev) => ({ ...prev, [questionId]: (prev[questionId] || 0) + 1 }));

        await Promise.all([
          utils.confidence.getBySubject.invalidate({ subjectId }),
          utils.confidence.getByQuestion.invalidate({ questionId }),
          utils.practice.countByQuestion.invalidate({ questionId }),
          utils.practice.getBySubject.invalidate({ subjectId }),
        ]);

        draftStartedAtRef.current[questionId] = Date.now();
        return true;
      } catch (error: any) {
        toast.error(error?.message || "연습 기록 저장 실패");
        return false;
      }
    },
    [questionMap, createSession, utils, subjectId]
  );

  const maybeSavePartialProgress = useCallback(
    (questionId: number | null) => {
      if (!questionId) return;
      const question = questionMap[questionId];
      if (!question || getQuestionType(question) !== "text" || !question.answer) return;

      const draft = draftsByQuestion[questionId] || "";
      if (!draft.trim()) return;

      const ratio = computeTextCompletionRatio(question.answer, draft);
      if (ratio >= 0.999) return;

      const persistedRatio = Math.max(0.1, Math.min(0.98, Math.round(ratio * 100) / 100));
      const prevRatio = savedProgressRatioRef.current[questionId] || 0;
      if (persistedRatio <= prevRatio + 0.04) return;

      savedProgressRatioRef.current[questionId] = persistedRatio;
      void recordPracticeSession(questionId, persistedRatio).then((ok) => {
        if (!ok) savedProgressRatioRef.current[questionId] = prevRatio;
      });
    },
    [questionMap, draftsByQuestion, recordPracticeSession]
  );

  useEffect(() => {
    const prev = prevFocusedQuestionRef.current;
    if (prev && prev !== focusedQuestionId) {
      maybeSavePartialProgress(prev);
    }
    prevFocusedQuestionRef.current = focusedQuestionId;
  }, [focusedQuestionId, maybeSavePartialProgress]);

  useEffect(() => {
    return () => {
      const currentFocused = prevFocusedQuestionRef.current;
      if (currentFocused) {
        maybeSavePartialProgress(currentFocused);
      }
    };
  }, [maybeSavePartialProgress]);

  useEffect(() => {
    if (!questions || questions.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const qId = parseInt((entry.target as HTMLElement).dataset.questionId || "0", 10);
          if (!qId) return;

          if (entry.isIntersecting) {
            visibleQuestionsRef.current.add(qId);
          } else {
            visibleQuestionsRef.current.delete(qId);
          }
        });

        if (visibleQuestionsRef.current.size > 0) {
          const orderedVisible = questions
            .filter((q) => visibleQuestionsRef.current.has(q.id))
            .map((q) => q.id);
          if (orderedVisible.length > 0) {
            setFocusedQuestionId(orderedVisible[0]);
          }
        }
      },
      { threshold: 0.3, rootMargin: "-80px 0px -60% 0px" }
    );

    Object.values(sectionRefs.current).forEach((el) => {
      if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [questions]);

  const handleCorrect = useCallback(
    (questionId: number) => {
      savedProgressRatioRef.current[questionId] = 1;
      void recordPracticeSession(questionId, 1).then((ok) => {
        if (ok) {
          savedProgressRatioRef.current[questionId] = 0;
          setDraftsByQuestion((prev) => ({ ...prev, [questionId]: "" }));
        }
      });
    },
    [recordPracticeSession]
  );

  const handleDraftChange = useCallback((questionId: number, value: string) => {
    setDraftsByQuestion((prev) => ({ ...prev, [questionId]: value }));

    if (value.trim().length > 0) {
      if (!draftStartedAtRef.current[questionId]) {
        draftStartedAtRef.current[questionId] = Date.now();
      }
    } else {
      savedProgressRatioRef.current[questionId] = 0;
      draftStartedAtRef.current[questionId] = Date.now();
    }
  }, []);

  const handleGoToTest = useCallback(
    (questionId: number) => {
      maybeSavePartialProgress(questionId);
      setLocation(`/test/${questionId}`);
    },
    [maybeSavePartialProgress, setLocation]
  );

  const focusedQuestion = useMemo(() => {
    return questions?.find((q) => q.id === focusedQuestionId) || null;
  }, [questions, focusedQuestionId]);

  const focusedDraft = focusedQuestion ? draftsByQuestion[focusedQuestion.id] || "" : "";

  if (!questions) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full relative min-h-0">
      <div className="flex-1 overflow-y-auto pb-40">
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => {
              if (focusedQuestionId) maybeSavePartialProgress(focusedQuestionId);
              setLocation(`/questions/${subjectId}`);
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{subject?.name || "연속 연습"}</h1>
            <p className="text-xs text-muted-foreground">{questions.length}개 문제 · 스크롤로 이동</p>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 flex-shrink-0"
            onClick={() => {
              if (focusedQuestionId) maybeSavePartialProgress(focusedQuestionId);
              setLocation(`/subject-exam/${subjectId}`);
            }}
          >
            <BookOpen className="h-3.5 w-3.5" />
            모의고사
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 flex-shrink-0"
            onClick={() => focusedQuestion && handleGoToTest(focusedQuestion.id)}
            disabled={!focusedQuestion}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            백지시험
          </Button>
        </div>

        {questions.map((q) => (
          <QuestionPracticeSection
            key={q.id}
            question={q as PracticeQuestion}
            confidenceInfo={confidenceMap[q.id]}
            practiceCount={practiceCounts[q.id] || 0}
            isFocused={focusedQuestionId === q.id}
            onFocus={() => setFocusedQuestionId(q.id)}
            sectionRef={(el) => {
              sectionRefs.current[q.id] = el;
              if (el && observerRef.current) {
                observerRef.current.observe(el);
              }
            }}
          />
        ))}

        <div className="h-4" />
      </div>

      <StickyInputPanel
        question={focusedQuestion as PracticeQuestion | null}
        draftValue={focusedDraft}
        onDraftChange={handleDraftChange}
        onCorrect={handleCorrect}
        onGoToTest={handleGoToTest}
      />
    </div>
  );
}
