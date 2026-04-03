interface Question {
  id: number;
  displayOrder: number;
  isStarred: number | boolean;
}

interface QuestionGridViewProps {
  questions: Question[];
  onSelectQuestion: (questionId: number) => void;
  confidenceData?: Record<number, { state: string; displayScore: number }>;
}

export function QuestionGridView({
  questions,
  onSelectQuestion,
  confidenceData = {},
}: QuestionGridViewProps) {
  // 상단 색 바 색상 (accent)
  const getBarColor = (questionId: number) => {
    const data = confidenceData[questionId];
    if (!data) return "bg-neutral-200 dark:bg-neutral-700";
    switch (data.state) {
      case "green":
        return "bg-emerald-500";
      case "yellow":
        return "bg-amber-400";
      case "red":
        return "bg-red-500";
      default:
        return "bg-neutral-200 dark:bg-neutral-700";
    }
  };

  // 안정도 % 텍스트 색상
  const getScoreColor = (questionId: number) => {
    const data = confidenceData[questionId];
    if (!data) return "text-muted-foreground";
    switch (data.state) {
      case "green":
        return "text-emerald-600 dark:text-emerald-400";
      case "yellow":
        return "text-amber-600 dark:text-amber-400";
      case "red":
        return "text-red-600 dark:text-red-400";
      default:
        return "text-muted-foreground";
    }
  };

  const sorted = [...questions].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="mb-4 p-4 bg-card rounded-xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">문제 순서별 안정도</h3>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 cursor-help" title="초록(안정): 80% 이상">
            <span className="inline-block w-3 h-1 rounded-full bg-emerald-500" />
            안정
          </span>
          <span className="flex items-center gap-1 cursor-help" title="노랑(학습중): 40~80%">
            <span className="inline-block w-3 h-1 rounded-full bg-amber-400" />
            학습중
          </span>
          <span className="flex items-center gap-1 cursor-help" title="빨강(취약): 40% 미만">
            <span className="inline-block w-3 h-1 rounded-full bg-red-500" />
            취약
          </span>
          <span className="flex items-center gap-1 cursor-help" title="미학습">
            <span className="inline-block w-3 h-1 rounded-full bg-neutral-200 dark:bg-neutral-700" />
            미학습
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {sorted.map((q) => {
          const starred = q.isStarred === 1 || q.isStarred === true;
          const score = confidenceData[q.id]?.displayScore;
          const state = confidenceData[q.id]?.state;

          return (
            <button
              key={q.id}
              onClick={() => onSelectQuestion(q.id)}
              className={`
                relative overflow-hidden
                w-11 rounded-xl
                bg-white dark:bg-neutral-900
                border transition-all duration-150
                hover:shadow-md hover:-translate-y-0.5
                focus:outline-none focus:ring-2 focus:ring-primary/30
                ${starred
                  ? "border-2 border-neutral-400 dark:border-neutral-500"
                  : "border border-neutral-200 dark:border-neutral-700"
                }
              `}
              title={
                score !== undefined
                  ? `문제 ${q.displayOrder} — 안정도 ${Math.round(score)}% — ${
                      state === "green" ? "안정" :
                      state === "yellow" ? "학습중" :
                      state === "red" ? "취약" : "미학습"
                    }`
                  : `문제 ${q.displayOrder}`
              }
            >
              {/* 상단 색 바 (accent) — 3px */}
              <div className={`h-[3px] w-full ${getBarColor(q.id)}`} />

              {/* 내부 콘텐츠: 번호 + 안정도 */}
              <div className="flex flex-col items-center justify-center py-1.5 px-0.5">
                <span className="text-[11px] font-bold text-foreground leading-none">
                  {q.displayOrder}
                </span>
                {score !== undefined ? (
                  <span className={`text-[9px] font-medium leading-none mt-1 ${getScoreColor(q.id)}`}>
                    {Math.round(score)}%
                  </span>
                ) : (
                  <span className="text-[9px] text-muted-foreground/50 leading-none mt-1">
                    —
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
