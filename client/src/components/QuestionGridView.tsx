import { Star } from 'lucide-react';

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
  const getColors = (questionId: number) => {
    const data = confidenceData[questionId];
    if (!data) {
      return {
        bg: 'bg-muted',
        text: 'text-muted-foreground',
        ring: '',
      };
    }
    switch (data.state) {
      case 'green':
        return { bg: 'bg-emerald-500', text: 'text-white', ring: 'ring-emerald-300' };
      case 'yellow':
        return { bg: 'bg-amber-400', text: 'text-white', ring: 'ring-amber-200' };
      case 'red':
        return { bg: 'bg-red-500', text: 'text-white', ring: 'ring-red-300' };
      default:
        return { bg: 'bg-muted', text: 'text-muted-foreground', ring: '' };
    }
  };

  // 정렬: displayOrder 기준
  const sorted = [...questions].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="mb-4 p-4 bg-card rounded-xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">문제 순서별 안정도</h3>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />
            안정
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" />
            학습중
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-500" />
            취약
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-muted border border-border" />
            미학습
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {sorted.map((q) => {
          const { bg, text, ring } = getColors(q.id);
          const starred = q.isStarred === 1 || q.isStarred === true;
          const score = confidenceData[q.id]?.displayScore;

          return (
            <div key={q.id} className="relative">
              <button
                onClick={() => onSelectQuestion(q.id)}
                className={`
                  relative w-9 h-9 rounded-lg flex flex-col items-center justify-center
                  font-bold transition-all duration-150
                  hover:scale-110 hover:shadow-md hover:ring-2
                  ${bg} ${text} ${ring ? `hover:${ring}` : ''}
                  text-[11px] leading-none
                `}
                title={score !== undefined ? `문제 ${q.displayOrder} — 안정도 ${Math.round(score)}%` : `문제 ${q.displayOrder}`}
              >
                <span>{q.displayOrder}</span>
                {score !== undefined && (
                  <span className="text-[9px] opacity-80 leading-none mt-0.5">{Math.round(score)}%</span>
                )}
              </button>

              {/* 별표 표시 (읽기 전용) */}
              {starred && (
                <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-yellow-400 flex items-center justify-center pointer-events-none">
                  <Star size={9} className="fill-white text-white" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
