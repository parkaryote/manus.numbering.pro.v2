import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ClipboardCheck, BookOpen, RotateCcw } from "lucide-react";
import { isPartialMatch, splitGraphemes } from "@/lib/hangul";
import { toast } from "sonner";

interface SubjectPracticeProps {
  subjectId: number;
}

// 텍스트 정규화 (공백 무시)
function normalizeText(text: string): string {
  return text.replace(/\s+/g, "");
}

// 문제 타입 판별
function getQuestionType(q: { imageUrl?: string | null; imageLabels?: string | null; tableData?: string | null; answer?: string | null }) {
  if (q.imageUrl) return "image";
  if (q.tableData) return "table";
  return "text";
}

// 안정도 색상 (accent 바 스타일)
function getStateBarColor(state?: string) {
  if (state === "green") return "bg-emerald-500";
  if (state === "yellow") return "bg-amber-400";
  return "bg-red-500";
}

// 글자별 채점 렌더링 (텍스트 모드)
function renderColoredText(
  targetText: string,
  userInput: string,
  isComposing: boolean
) {
  const targetLines = targetText.split("\n");
  const userLines = userInput.split("\n");

  return targetLines.map((line, lineIdx) => {
    const tChars = splitGraphemes(line);
    const uChars = splitGraphemes(userLines[lineIdx] || "");

    return (
      <div key={lineIdx} className="font-semibold text-base leading-relaxed">
        {tChars.map((ch, i) => {
          const uch = uChars[i];
          let colorClass = "text-muted-foreground/40";
          if (uch !== undefined) {
            if (isComposing && i === uChars.length - 1) {
              colorClass = "text-muted-foreground";
            } else if (isPartialMatch(ch, uch)) {
              colorClass = "text-foreground";
            } else {
              colorClass = "text-red-500";
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

// 개별 문제 연습 섹션
function QuestionPracticeSection({
  question,
  confidenceInfo,
  practiceCount: savedPracticeCount,
  isFocused,
  onFocus,
  sectionRef,
}: {
  question: {
    id: number;
    displayOrder: number;
    question: string;
    answer?: string | null;
    tableData?: string | null;
    imageUrl?: string | null;
    imageLabels?: string | null;
  };
  confidenceInfo?: { displayScore: number; state: string; isColdStart: boolean };
  practiceCount: number;
  isFocused: boolean;
  onFocus: () => void;
  sectionRef: (el: HTMLDivElement | null) => void;
}) {
  const qType = getQuestionType(question);
  const isText = qType === "text";

  return (
    <div
      ref={sectionRef}
      className={`border-b border-border transition-colors duration-200 ${isFocused ? "bg-background" : "bg-muted/20"}`}
      onClick={onFocus}
      data-question-id={question.id}
    >
      {/* 문제 헤더 */}
      <div className={`sticky top-0 z-10 flex items-center gap-3 px-6 py-3 border-b border-border/50 backdrop-blur-sm ${isFocused ? "bg-background/95" : "bg-muted/80"}`}>
        <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${isFocused ? "bg-primary" : "bg-muted-foreground/40"}`}>
          {question.displayOrder}
        </span>
        <span className="text-sm font-medium text-foreground truncate flex-1">
          {question.question.length > 60 ? question.question.slice(0, 60) + "…" : question.question}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {confidenceInfo && !confidenceInfo.isColdStart && (
            <span className="text-xs text-muted-foreground font-mono">
              {confidenceInfo.displayScore}%
            </span>
          )}
          <div className={`w-3 h-[3px] rounded-full ${getStateBarColor(confidenceInfo?.state)}`} />
          {savedPracticeCount > 0 && (
            <Badge variant="secondary" className="text-xs h-5 px-1.5">
              {savedPracticeCount}회
            </Badge>
          )}
          {qType !== "text" && (
            <Badge variant="outline" className="text-xs h-5 px-1.5">
              {qType === "image" ? "이미지" : "표"}
            </Badge>
          )}
        </div>
      </div>

      {/* 문제 본문 */}
      <div className="px-6 py-5">
        {isText && question.answer ? (
          <div className="text-base font-semibold leading-relaxed text-foreground whitespace-pre-wrap">
            {question.answer}
          </div>
        ) : qType === "table" && question.tableData ? (
          <TablePreview tableData={question.tableData} />
        ) : qType === "image" ? (
          <div className="text-sm text-muted-foreground italic">이미지 문제 — 개별 연습 페이지에서 진행하세요</div>
        ) : (
          <div className="text-sm text-muted-foreground italic">답안 없음</div>
        )}
      </div>
    </div>
  );
}

// 표 미리보기
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
                  <th key={i} className="border border-border px-3 py-1.5 bg-muted text-left font-medium text-xs">{h}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row: string[], ri: number) => (
              <tr key={ri}>
                {row.map((cell: string, ci: number) => (
                  <td key={ci} className="border border-border px-3 py-1.5 text-sm">{cell}</td>
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

// 하단 sticky 입력 패널
function StickyInputPanel({
  question,
  onCorrect,
  onGoToTest,
}: {
  question: {
    id: number;
    displayOrder: number;
    question: string;
    answer?: string | null;
    tableData?: string | null;
    imageUrl?: string | null;
  } | null;
  onCorrect: (questionId: number) => void;
  onGoToTest: (questionId: number) => void;
}) {
  const [userInput, setUserInput] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [damageValue, setDamageValue] = useState(0);
  const [showDamage, setShowDamage] = useState(false);
  const [localPracticeCount, setLocalPracticeCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevQuestionIdRef = useRef<number | null>(null);
  const isResettingRef = useRef(false);

  const utils = trpc.useUtils();
  const createSession = trpc.practice.create.useMutation();

  // 문제 바뀌면 입력창 초기화
  useEffect(() => {
    if (question && question.id !== prevQuestionIdRef.current) {
      prevQuestionIdRef.current = question.id;
      setUserInput("");
      setLocalPracticeCount(0);
      setIsFadingOut(false);
      setShowDamage(false);
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.focus();
      }
    }
  }, [question?.id]);

  const targetText = useMemo(() => {
    if (!question?.answer) return "";
    return question.answer;
  }, [question?.answer]);

  const qType = question ? getQuestionType(question) : "text";
  const isText = qType === "text";

  const handleCorrectAnswer = useCallback(() => {
    if (!question) return;
    const newCount = localPracticeCount + 1;
    setLocalPracticeCount(newCount);

    setTimeout(() => setIsFadingOut(true), 150);
    setTimeout(() => {
      isResettingRef.current = true;
      setIsComposing(false);
      setUserInput("");
      if (textareaRef.current) {
        textareaRef.current.blur();
        textareaRef.current.value = "";
      }
      // 증감 애니메이션
      setShowDamage(false);
      requestAnimationFrame(() => {
        const prevScore = Math.round(25 * (1 - Math.exp(-(newCount - 1) * 0.25)));
        const nextScore = Math.round(25 * (1 - Math.exp(-newCount * 0.25)));
        setDamageValue(Math.max(1, nextScore - prevScore));
        setShowDamage(true);
      });
      setTimeout(() => {
        setIsFadingOut(false);
        isResettingRef.current = false;
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 50);
    }, 400);

    // DB 저장
    createSession.mutate(
      { questionId: question.id, duration: 1, typingSpeed: 0, accuracy: 100, errorCount: 0 },
      {
        onSuccess: () => {
          utils.confidence.getBySubject.invalidate({ subjectId: question ? (question as any).subjectId : 0 });
          utils.practice.countByQuestion.invalidate({ questionId: question.id });
        },
      }
    );
    onCorrect(question.id);
  }, [question, localPracticeCount, createSession, utils, onCorrect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isResettingRef.current) return;
    const newValue = e.target.value;
    setUserInput(newValue);

    if (!isText || !targetText || isComposing) return;

    // 자동 완료 감지
    const targetLines = targetText.split("\n");
    const userLines = newValue.split("\n");
    let allComplete = true;
    for (let li = 0; li < targetLines.length; li++) {
      const tChars = splitGraphemes(targetLines[li].replace(/\s+/g, ""));
      const uChars = splitGraphemes((userLines[li] || "").replace(/\s+/g, ""));
      if (tChars.length === 0) continue;
      if (uChars.length < tChars.length) { allComplete = false; break; }
      for (let i = 0; i < tChars.length; i++) {
        if (!isPartialMatch(tChars[i], uChars[i] || "")) { allComplete = false; break; }
      }
      if (!allComplete) break;
    }
    if (allComplete && normalizeText(targetText).length > 0) {
      handleCorrectAnswer();
    }
  }, [isText, targetText, isComposing, handleCorrectAnswer]);

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false);
    const newValue = (e.target as HTMLTextAreaElement).value;
    if (!isText || !targetText) return;

    const targetLines = targetText.split("\n");
    const userLines = newValue.split("\n");
    let allComplete = true;
    for (let li = 0; li < targetLines.length; li++) {
      const tChars = splitGraphemes(targetLines[li].replace(/\s+/g, ""));
      const uChars = splitGraphemes((userLines[li] || "").replace(/\s+/g, ""));
      if (tChars.length === 0) continue;
      if (uChars.length < tChars.length) { allComplete = false; break; }
      for (let i = 0; i < tChars.length; i++) {
        if (!isPartialMatch(tChars[i], uChars[i] || "")) { allComplete = false; break; }
      }
      if (!allComplete) break;
    }
    if (allComplete && normalizeText(targetText).length > 0) {
      handleCorrectAnswer();
    }
  }, [isText, targetText, handleCorrectAnswer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.shiftKey && question) {
      e.preventDefault();
      onGoToTest(question.id);
    }
  }, [question, onGoToTest]);

  if (!question) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-border px-6 py-4">
        <p className="text-sm text-muted-foreground text-center">문제를 선택하세요</p>
      </div>
    );
  }

  const isImageOrTable = qType === "image" || qType === "table";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/98 backdrop-blur-md border-t border-border shadow-lg">
      {/* 데미지 숫자 애니메이션 */}
      {showDamage && (
        <div
          className="absolute -top-8 left-1/2 -translate-x-1/2 text-green-500 font-bold text-lg animate-in fade-in slide-in-from-bottom-2 duration-300 pointer-events-none"
          onAnimationEnd={() => setTimeout(() => setShowDamage(false), 800)}
        >
          +{damageValue}
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-3">
        {/* 현재 문제 표시 */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-primary">#{question.displayOrder}</span>
          <span className="text-xs text-muted-foreground truncate flex-1">
            {question.question.length > 50 ? question.question.slice(0, 50) + "…" : question.question}
          </span>
          {localPracticeCount > 0 && (
            <Badge variant="secondary" className="text-xs h-5 px-1.5 flex-shrink-0">
              이번 {localPracticeCount}회
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs flex-shrink-0"
            onClick={() => question && onGoToTest(question.id)}
          >
            <ClipboardCheck className="h-3 w-3 mr-1" />
            시험
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
            {/* 채점 오버레이 */}
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
              placeholder=""
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
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleQuestionsRef = useRef<Set<number>>(new Set());

  // 데이터 로드
  const { data: subject } = trpc.subjects.getById.useQuery({ id: subjectId });
  const { data: questions } = trpc.questions.listBySubject.useQuery({ subjectId });
  const { data: confidenceData } = trpc.confidence.getBySubject.useQuery({ subjectId });

  // 안정도 맵
  const confidenceMap = useMemo(() => {
    const map: Record<number, { displayScore: number; state: string; isColdStart: boolean }> = {};
    confidenceData?.questions.forEach((q) => {
      map[q.questionId] = { displayScore: q.displayScore, state: q.state, isColdStart: q.isColdStart };
    });
    return map;
  }, [confidenceData]);

  // 연습 횟수 맵 (DB에서)
  const practiceCountQueries = useMemo(() => {
    return questions?.map((q) => q.id) || [];
  }, [questions]);

  // 첫 번째 문제로 포커스 초기화
  useEffect(() => {
    if (questions && questions.length > 0 && focusedQuestionId === null) {
      setFocusedQuestionId(questions[0].id);
    }
  }, [questions, focusedQuestionId]);

  // IntersectionObserver로 화면에 보이는 문제 추적
  useEffect(() => {
    if (!questions || questions.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const qId = parseInt((entry.target as HTMLElement).dataset.questionId || "0");
          if (!qId) return;
          if (entry.isIntersecting) {
            visibleQuestionsRef.current.add(qId);
          } else {
            visibleQuestionsRef.current.delete(qId);
          }
        });
        // 가장 위에 있는 visible 문제를 focused로 설정
        if (visibleQuestionsRef.current.size > 0 && questions) {
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

  const scrollToQuestion = useCallback((questionId: number) => {
    const el = sectionRefs.current[questionId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setFocusedQuestionId(questionId);
    }
  }, []);

  const handleCorrect = useCallback((questionId: number) => {
    setPracticeCounts((prev) => ({ ...prev, [questionId]: (prev[questionId] || 0) + 1 }));
  }, []);

  const handleGoToTest = useCallback((questionId: number) => {
    setLocation(`/test/${questionId}`);
  }, [setLocation]);

  const focusedQuestion = useMemo(() => {
    return questions?.find((q) => q.id === focusedQuestionId) || null;
  }, [questions, focusedQuestionId]);

  if (!questions) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full relative">
      {/* 메인 스크롤 영역 */}
      <div className="flex-1 overflow-y-auto pb-40">
        {/* 상단 헤더 */}
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => setLocation(`/questions/${subjectId}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{subject?.name || "과목 연습"}</h1>
            <p className="text-xs text-muted-foreground">{questions.length}개 문제</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 flex-shrink-0"
            onClick={() => setLocation(`/subject-exam/${subjectId}`)}
          >
            <BookOpen className="h-3.5 w-3.5" />
            모의고사
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 flex-shrink-0"
            onClick={() => focusedQuestion && handleGoToTest(focusedQuestion.id)}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            백지시험
          </Button>
        </div>

        {/* 문제 목록 */}
        {questions.map((q) => (
          <QuestionPracticeSection
            key={q.id}
            question={q}
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

        {/* 하단 여백 */}
        <div className="h-4" />
      </div>

      {/* 우측 북마크 패널 */}
      <div className="hidden lg:flex flex-col w-12 border-l border-border bg-muted/30 overflow-y-auto py-3 gap-1 items-center flex-shrink-0">
        {questions.map((q) => {
          const conf = confidenceMap[q.id];
          const isFocused = focusedQuestionId === q.id;
          return (
            <button
              key={q.id}
              onClick={() => scrollToQuestion(q.id)}
              className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold transition-all duration-150 ${
                isFocused
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
              title={`문제 ${q.displayOrder}`}
            >
              <span className="text-xs">{q.displayOrder}</span>
              {conf && !conf.isColdStart && (
                <div className={`absolute w-full h-[2px] rounded-full ${getStateBarColor(conf.state)} bottom-0 left-0`} />
              )}
            </button>
          );
        })}
      </div>

      {/* 하단 sticky 입력 패널 */}
      <StickyInputPanel
        question={focusedQuestion}
        onCorrect={handleCorrect}
        onGoToTest={handleGoToTest}
      />
    </div>
  );
}
