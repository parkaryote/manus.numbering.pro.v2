import { useEffect, useState } from "react";

interface DamageNumberProps {
  value: number; // +5, -3 등
  show: boolean;
  onComplete?: () => void;
}

export function DamageNumber({ value, show, onComplete }: DamageNumberProps) {
  const [phase, setPhase] = useState<"hidden" | "visible" | "exiting">("hidden");
  const [displayValue, setDisplayValue] = useState(value);

  const isPositive = value >= 0;
  const absValue = Math.abs(value);

  useEffect(() => {
    if (!show) {
      setPhase("hidden");
      return;
    }

    setDisplayValue(value);
    setPhase("visible");

    // 1.2초 후 페이드아웃 시작
    const timer = setTimeout(() => {
      setPhase("exiting");
      // 0.5초 후 숨김
      const exitTimer = setTimeout(() => {
        setPhase("hidden");
        onComplete?.();
      }, 500);
      return () => clearTimeout(exitTimer);
    }, 1200);

    return () => clearTimeout(timer);
  }, [show, value, onComplete]);

  if (phase === "hidden") return null;

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
    zIndex: 50,
    opacity: phase === "exiting" ? 0 : 1,
    transition: phase === "exiting" ? "opacity 0.5s ease-in" : "none",
  };

  const numberStyle: React.CSSProperties = {
    fontSize: "4rem",
    fontWeight: "900",
    lineHeight: 1,
    color: isPositive ? "#10b981" : "#ef4444",
    textShadow: isPositive
      ? "0 0 20px rgba(16, 185, 129, 0.8), 2px 2px 4px rgba(0,0,0,0.5)"
      : "0 0 20px rgba(239, 68, 68, 0.8), 2px 2px 4px rgba(0,0,0,0.5)",
    animation: phase === "visible"
      ? isPositive
        ? "floatUp 1.2s ease-out forwards"
        : "floatDown 1.2s ease-out forwards"
      : "none",
  };

  return (
    <div style={containerStyle}>
      <div style={numberStyle}>
        {isPositive ? "+" : "-"}
        {absValue}%
      </div>

      <style>{`
        @keyframes floatUp {
          0% {
            transform: translateY(0);
            opacity: 1;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translateY(-80px);
            opacity: 0;
          }
        }

        @keyframes floatDown {
          0% {
            transform: translateY(0);
            opacity: 1;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translateY(80px);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
