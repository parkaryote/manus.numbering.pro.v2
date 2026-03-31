import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface ConfidencePopupProps {
  show: boolean;
  previousScore: number;
  currentScore: number;
  onComplete?: () => void;
}

export function ConfidencePopup({
  show,
  previousScore,
  currentScore,
  onComplete,
}: ConfidencePopupProps) {
  const [displayScore, setDisplayScore] = useState(previousScore);
  const [isAnimating, setIsAnimating] = useState(false);

  const scoreDiff = currentScore - previousScore;
  const isIncrease = scoreDiff >= 0;
  const absScoreDiff = Math.abs(scoreDiff);

  useEffect(() => {
    if (!show) {
      setDisplayScore(previousScore);
      setIsAnimating(false);
      return;
    }

    setIsAnimating(true);
    const startTime = Date.now();
    const duration = 1500; // 1.5초 동안 카운트업/다운
    const startValue = previousScore;
    const endValue = currentScore;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function for smooth animation
      const easeOutQuad = 1 - Math.pow(1 - progress, 2);
      const currentValue = Math.round(
        startValue + (endValue - startValue) * easeOutQuad
      );

      setDisplayScore(currentValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayScore(endValue);
        setIsAnimating(false);
        // Call onComplete after animation finishes
        setTimeout(() => {
          onComplete?.();
        }, 500);
      }
    };

    requestAnimationFrame(animate);
  }, [show, previousScore, currentScore, onComplete]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
      {/* 배경 페이드 */}
      <div
        className="absolute inset-0 bg-black/20 animate-in fade-in duration-300"
        style={{
          animation: "fadeIn 0.3s ease-out",
        }}
      />

      {/* 팝업 컨테이너 */}
      <div
        className="relative bg-gradient-to-b from-slate-900 to-slate-800 rounded-2xl border-2 px-8 py-6 shadow-2xl animate-in scale-in duration-300"
        style={{
          borderColor: isIncrease ? "#10b981" : "#ef4444",
          animation: "scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
          boxShadow: isIncrease
            ? "0 0 40px rgba(16, 185, 129, 0.4)"
            : "0 0 40px rgba(239, 68, 68, 0.4)",
        }}
      >
        {/* 상단: 증감 아이콘 */}
        <div className="flex justify-center mb-4">
          {isIncrease ? (
            <TrendingUp className="w-12 h-12 text-emerald-400 animate-bounce" />
          ) : (
            <TrendingDown className="w-12 h-12 text-red-400 animate-bounce" />
          )}
        </div>

        {/* 중앙: 점수 표시 */}
        <div className="text-center mb-6">
          <div className="text-5xl font-bold text-white mb-2">
            {displayScore}%
          </div>
          <div
            className={`text-2xl font-bold ${
              isIncrease ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {isIncrease ? "+" : "-"}
            {absScoreDiff}%
          </div>
        </div>

        {/* 하단: 상태 텍스트 */}
        <div className="text-center text-sm text-slate-300">
          {isIncrease ? (
            <p className="text-emerald-300 font-semibold">
              🎉 안정도 상승! 계속 화이팅!
            </p>
          ) : (
            <p className="text-red-300 font-semibold">
              📉 안정도 하락 - 다시 도전하세요!
            </p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.5);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
