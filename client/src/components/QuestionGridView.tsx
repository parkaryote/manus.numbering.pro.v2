import React from 'react';
import { Button } from '@/components/ui/button';
import { Star } from 'lucide-react';

interface Question {
  id: number;
  displayOrder: number;
  isStarred: number;
  confidenceState?: 'stable' | 'learning' | 'struggling';
}

interface QuestionGridViewProps {
  questions: Question[];
  onSelectQuestion: (questionId: number) => void;
  onToggleStar: (questionId: number) => void;
  confidenceData?: Record<number, { state: string; displayScore: number }>;
}

export function QuestionGridView({
  questions,
  onSelectQuestion,
  onToggleStar,
  confidenceData = {},
}: QuestionGridViewProps) {
  const getConfidenceColor = (questionId: number) => {
    const data = confidenceData[questionId];
    if (!data) return 'bg-gray-200';
    
    switch (data.state) {
      case 'stable':
        return 'bg-green-500';
      case 'learning':
        return 'bg-yellow-500';
      case 'struggling':
        return 'bg-red-500';
      default:
        return 'bg-gray-300';
    }
  };

  return (
    <div className="mb-6 p-4 bg-white rounded-lg border border-border">
      <h3 className="text-sm font-semibold mb-3">문제 순서별 안정도</h3>
      <div className="grid grid-cols-10 gap-2">
        {questions.map((q) => (
          <div key={q.id} className="relative">
            <button
              onClick={() => onSelectQuestion(q.id)}
              className={`
                w-full aspect-square rounded-md flex items-center justify-center
                text-xs font-semibold text-white transition-all hover:scale-110
                ${getConfidenceColor(q.id)}
              `}
              title={`문제 ${q.displayOrder}`}
            >
              {q.displayOrder}
            </button>
            {q.isStarred === 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(q.id);
                }}
                className="absolute -top-2 -right-2 p-0.5 bg-yellow-400 rounded-full hover:bg-yellow-500 transition-colors"
                title="별표 제거"
              >
                <Star size={12} className="fill-white text-white" />
              </button>
            )}
            {q.isStarred === 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(q.id);
                }}
                className="absolute -top-2 -right-2 p-0.5 bg-gray-300 rounded-full hover:bg-gray-400 transition-colors opacity-0 hover:opacity-100"
                title="별표 추가"
              >
                <Star size={12} className="text-gray-600" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-500 rounded"></div>
          <span>안정 (70% 이상)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-yellow-500 rounded"></div>
          <span>학습중 (40~70%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-500 rounded"></div>
          <span>취약 (40% 미만)</span>
        </div>
      </div>
    </div>
  );
}
