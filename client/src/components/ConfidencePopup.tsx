import { useEffect, useState, useRef } from "react";
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
  // 애니메이션 단계: hidden → entering → visible → exiting → hidden
  const [phase, setPhase] = useState<
    "hidden" | "entering" | "visible" | "exiting"
  >("hidden");
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scoreDiff = currentScore - previousScore;
  const isIncrease = scoreDiff >= 0;
  const absScoreDiff = Math.abs(scoreDiff);

  // 클린업
  const cleanup = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  useEffect(() => {
    if (!show) {
      cleanup();
      setPhase("hidden");
      setDisplayScore(previousScore);
      return;
    }

    // 1) 진입 애니메이션 시작
    setDisplayScore(previousScore);
    setPhase("entering");

    // 2) 300ms 후 숫자 카운트업/다운 시작
    timerRef.current = setTimeout(() => {
      setPhase("visible");
      const startTime = Date.now();
      const duration = 1200;
      const startValue = previousScore;
      const endValue = currentScore;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        setDisplayScore(
          Math.round(startValue + (endValue - startValue) * easeOut)
        );

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        } else {
          setDisplayScore(endValue);
          // 3) 숫자 완료 후 0.8초 유지 → 페이드아웃
          timerRef.current = setTimeout(() => {
            setPhase("exiting");
            // 4) 페이드아웃 완료(600ms) 후 숨김
            timerRef.current = setTimeout(() => {
              setPhase("hidden");
              onComplete?.();
            }, 600);
          }, 800);
        }
      };
      rafRef.current = requestAnimationFrame(animate);
    }, 300);

    return cleanup;
  }, [show]);

  if (phase === "hidden") return null;

  // 방향: 증가 → 위로 올라가며 등장, 감소 → 아래로 내려가며 등장
  const enterTranslate = isIncrease ? "translateY(40px)" : "translateY(-40px)";
  const exitTranslate = isIncrease ? "translateY(-60px)" : "translateY(60px)";

  const isEntering = phase === "entering";
  const isExiting = phase === "exiting";

  const containerStyle: React.CSSProperties = {
    opacity: isEntering ? 0 : isExiting ? 0 : 1,
    transform: isEntering
      ? enterTranslate
      : isExiting
        ? exitTranslate
        : "translateY(0)",
    transition: isEntering
      ? "opacity 0.3s ease-out, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)"
      : isExiting
        ? "opacity 0.5s ease-in, transform 0.5s ease-in"
        : "none",
  };

  const overlayStyle: React.CSSProperties = {
    opacity: isEntering ? 0 : isExiting ? 0 : 0.35,
    transition: isEntering
      ? "opacity 0.3s ease-out"
      : isExiting
        ? "opacity 0.5s ease-in"
        : "none",
  };

  const glowColor = isIncrease
    ? "rgba(16, 185, 129, 0.5)"
    : "rgba(239, 68, 68, 0.5)";
  const borderColor = isIncrease ? "#10b981" : "#ef4444";

  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[100]">
      {/* 배경 오버레이 */}
      <div className="absolute inset-0 bg-black" style={overlayStyle} />

      {/* 팝업 카드 */}
      <div
        className="relative rounded-2xl border-2 px-10 py-8 shadow-2xl min-w-[220px] text-center"
        style={{
          ...containerStyle,
          borderColor,
          background: "linear-gradient(160deg, #1e293b 0%, #0f172a 100%)",
          boxShadow: `0 0 60px ${glowColor}, 0 20px 60px rgba(0,0,0,0.6)`,
        }}
      >
        {/* 아이콘 - 증가면 위로, 감소면 아래로 바운스 */}
        <div className="flex justify-center mb-5">
          {isIncrease ? (
            <TrendingUp
              className="text-emerald-400"
              style={{
                width: 52,
                height: 52,
                animation: "bounceUp 0.6s ease-out 0.3s both",
              }}
            />
          ) : (
            <TrendingDown
              className="text-red-400"
              style={{
                width: 52,
                height: 52,
                animation: "bounceDown 0.6s ease-out 0.3s both",
              }}
            />
          )}
        </div>

        {/* 점수 */}
        <div className="mb-3">
          <div className="text-6xl font-black text-white tracking-tight">
            {displayScore}
            <span className="text-3xl font-bold text-slate-300">점</span>
          </div>
          <div
            className="text-2xl font-bold mt-1"
            style={{ color: isIncrease ? "#34d399" : "#f87171" }}
          >
            {isIncrease ? "▲" : "▼"}&nbsp;{absScoreDiff}점
          </div>
        </div>

        {/* 상태 텍스트 */}
        <div className="text-sm font-semibold mt-4">
          {isIncrease ? (
            <span className="text-emerald-300">
              🎉 안정도 상승! 계속 화이팅!
            </span>
          ) : (
            <span className="text-red-300">
              📉 안정도 하락 — 다시 도전하세요!
            </span>
          )}
        </div>
      </div>

      <style>{`
        @keyframes bounceUp {
          0%   { transform: translateY(12px); opacity: 0; }
          60%  { transform: translateY(-8px); opacity: 1; }
          80%  { transform: translateY(4px); }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes bounceDown {
          0%   { transform: translateY(-12px); opacity: 0; }
          60%  { transform: translateY(8px); opacity: 1; }
          80%  { transform: translateY(-4px); }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
