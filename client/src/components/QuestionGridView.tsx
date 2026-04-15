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
  // 신호등 색 (전체 fill)
  const getFillColor = (questionId: number) => {
    const data = confidenceData[questionId];
    if (!data) return "bg-neutral-200 dark:bg-neutral-700";
    if (data.isColdStart) {
      switch (data.state) {
        case "green":
          return "bg-emerald-200/85 dark:bg-emerald-900/55";
        case "yellow":
          return "bg-amber-200/85 dark:bg-amber-900/55";
        case "red":
          return "bg-rose-200/85 dark:bg-rose-900/55";
        default:
          return "bg-neutral-200/70 dark:bg-neutral-700/65";
      }
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

  const sorted = [...questions].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="mb-4 p-4 bg-card rounded-xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-foreground">문제 순서별 안정도</h3>
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
            <span className="inline-block w-3.5 h-3.5 rounded bg-foreground/10 ring-1 ring-border" />
            연한 색: 미학습
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {sorted.map((q) => {
          const starred = q.isStarred === 1 || q.isStarred === true;
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
                w-[70px] h-[76px] rounded-lg
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
              <span className={`text-base font-bold leading-none ${textColor}`}>
                {q.displayOrder}
              </span>
              {/* 안정도 점수 */}
              {score !== undefined ? (
                <span className={`inline-block w-[50px] text-center text-sm font-semibold font-mono tabular-nums tracking-tight leading-none ${textColor}`}>
                  {Math.round(score)}점
                </span>
              ) : (
                <span className={`inline-block w-[50px] text-center text-sm leading-none ${textColor}/50`}>
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
