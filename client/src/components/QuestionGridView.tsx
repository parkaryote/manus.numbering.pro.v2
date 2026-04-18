import { useMemo, useState } from "react";

interface Question {
  id: number;
  displayOrder: number;
  isStarred: number | boolean;
}

interface QuestionGridViewProps {
  questions: Question[];
  onSelectQuestion: (questionId: number) => void;
  confidenceData?: Record<number, { state: string; displayScore: number; label?: string; isColdStart?: boolean }>;
}

export function QuestionGridView({
  questions,
  onSelectQuestion,
  confidenceData = {},
}: QuestionGridViewProps) {
  type SortMode = "order" | "starFirst" | "scoreAsc" | "scoreDesc" | "coldStartFirst";
  const [sortMode, setSortMode] = useState<SortMode>("order");
  const [coldOnly, setColdOnly] = useState(false);

  const isStarredQuestion = (question: Question) => question.isStarred === 1 || question.isStarred === true;
  const getScore = (questionId: number) => {
    const score = confidenceData[questionId]?.displayScore;
    return Number.isFinite(score) ? Number(score) : null;
  };

  const sortByDisplayOrder = (a: Question, b: Question) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0);

  const sortOptions: Array<{ mode: SortMode; label: string }> = [
    { mode: "order", label: "문제순" },
    { mode: "starFirst", label: "중요도" },
    { mode: "scoreAsc", label: "안정도↑" },
    { mode: "scoreDesc", label: "안정도↓" },
    { mode: "coldStartFirst", label: "미학습 우선" },
  ];

  const sorted = useMemo(() => {
    const next = [...questions];
    next.sort((a, b) => {
      if (sortMode === "starFirst") {
        const aStar = isStarredQuestion(a);
        const bStar = isStarredQuestion(b);
        if (aStar !== bStar) return aStar ? -1 : 1;
        return sortByDisplayOrder(a, b);
      }

      if (sortMode === "scoreAsc" || sortMode === "scoreDesc") {
        const aScore = getScore(a.id);
        const bScore = getScore(b.id);
        if (aScore === null && bScore === null) return sortByDisplayOrder(a, b);
        if (aScore === null) return 1;
        if (bScore === null) return -1;
        if (aScore !== bScore) return sortMode === "scoreAsc" ? aScore - bScore : bScore - aScore;
        return sortByDisplayOrder(a, b);
      }

      if (sortMode === "coldStartFirst") {
        const aCold = Boolean(confidenceData[a.id]?.isColdStart);
        const bCold = Boolean(confidenceData[b.id]?.isColdStart);
        if (aCold !== bCold) return aCold ? -1 : 1;
        return sortByDisplayOrder(a, b);
      }

      return sortByDisplayOrder(a, b);
    });

    if (!coldOnly) return next;
    return next.filter((question) => Boolean(confidenceData[question.id]?.isColdStart));
  }, [coldOnly, confidenceData, questions, sortMode]);

  // 신호등 색 (전체 fill)
  const getFillColor = (questionId: number) => {
    const data = confidenceData[questionId];
    if (!data) return "bg-transparent";
    if (data.isColdStart) {
      return "bg-transparent";
    }
    switch (data.state) {
      case "green":
        return "bg-emerald-500";
      case "yellow":
        return "bg-amber-400";
      case "red":
        return "bg-rose-500 dark:bg-rose-400";
      default:
        return "bg-neutral-200 dark:bg-neutral-700";
    }
  };

  // 중요도 border 색상: 검정 + 굵은 테두리
  const getBorderColor = (isStarred: boolean) => {
    if (!isStarred) return "border-neutral-200 dark:border-neutral-700 border";
    return "border-black dark:border-black border-[3px]";
  };

  // 텍스트 색상 (흰색 또는 다크)
  const getTextColor = (questionId: number) => {
    const data = confidenceData[questionId];
    if (!data) return "text-foreground";
    if (data.isColdStart) {
      switch (data.state) {
        case "green":
          return "text-emerald-600 dark:text-emerald-200";
        case "yellow":
          return "text-amber-600 dark:text-amber-200";
        case "red":
          return "text-rose-600 dark:text-rose-200";
        default:
          return "text-muted-foreground";
      }
    }
    switch (data.state) {
      case "green":
      case "yellow":
      case "red":
        return "text-white";
      default:
        return "text-foreground";
    }
  };

  return (
    <div className="mb-4 p-4 bg-card rounded-xl border border-border shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-base font-semibold text-foreground">문제 순서별 안정도</h3>
          <div className="flex flex-wrap items-center gap-1">
            {sortOptions.map((option) => {
              const active = sortMode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => setSortMode(option.mode)}
                  aria-pressed={active}
                  className={`h-6 px-2 rounded-md text-[11px] border transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setColdOnly((prev) => !prev)}
              aria-pressed={coldOnly}
              className={`h-6 px-2 rounded-md text-[11px] border transition-colors ${
                coldOnly
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              미학습만
            </button>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5" title="80점 이상">
            <span className="inline-block w-3.5 h-3.5 rounded bg-emerald-500" />
            안정
          </span>
          <span className="inline-flex items-center gap-1.5" title="40~79점">
            <span className="inline-block w-3.5 h-3.5 rounded bg-amber-400" />
            위험
          </span>
          <span className="inline-flex items-center gap-1.5" title="39점 이하">
            <span className="inline-block w-3.5 h-3.5 rounded bg-rose-500 dark:bg-rose-400" />
            취약
          </span>
          <span className="inline-flex items-center gap-1.5" title="기록이 없어 난이도 기반 미학습 값을 표시">
            <span className="inline-block w-3.5 h-3.5 rounded border border-foreground/30 bg-transparent" />
            미학습: 글자색만
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {sorted.map((q) => {
          const starred = isStarredQuestion(q);
          const score = confidenceData[q.id]?.displayScore;
          const fillColor = getFillColor(q.id);
          const borderColor = getBorderColor(starred);
          const textColor = getTextColor(q.id);

          return (
            <button
              key={q.id}
              onClick={() => onSelectQuestion(q.id)}
              className={`
                flex flex-col items-center justify-center gap-0.5
                w-[62px] h-[68px] sm:w-[70px] sm:h-[76px] rounded-lg
                transition-all duration-150
                hover:shadow-md hover:-translate-y-0.5
                focus:outline-none focus:ring-2 focus:ring-primary/30
                ${fillColor}
                ${borderColor}
              `}
              title={
                score !== undefined
                  ? `문제 ${q.displayOrder} — 안정도 ${Math.round(score)}점${confidenceData[q.id]?.isColdStart ? " (미학습)" : ""}${starred ? " (중요)" : ""}`
                  : `문제 ${q.displayOrder}${starred ? " (중요)" : ""}`
              }
              >
              {/* 번호 */}
              <span className={`text-sm sm:text-base font-bold leading-none ${textColor}`}>
                {q.displayOrder}
              </span>
              {/* 안정도 점수 */}
              {score !== undefined ? (
                <span className={`inline-block w-[44px] sm:w-[50px] text-center text-xs sm:text-sm font-semibold font-mono tabular-nums tracking-tight leading-none ${textColor}`}>
                  {Math.round(score)}점
                </span>
              ) : (
                <span className={`inline-block w-[44px] sm:w-[50px] text-center text-xs sm:text-sm leading-none ${textColor}/50`}>
                  —
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
