import { useEffect, useRef, useState } from "react";

interface DamageNumberProps {
  value: number; // +5.2, -3.1 등
  show: boolean;
  onComplete?: () => void;
}

export function DamageNumber({ value, show, onComplete }: DamageNumberProps) {
  const [visible, setVisible] = useState(false);
  const [displayValue, setDisplayValue] = useState(value);
  const [animKey, setAnimKey] = useState(0); // 매번 새 애니메이션 트리거
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!show) return;

    // 이전 타이머 정리
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setDisplayValue(value);
    setVisible(true);
    setAnimKey(prev => prev + 1); // 새 key로 애니메이션 재시작

    // 1점 미만이면 더 짧게 표시
    const duration = Math.abs(value) < 1 ? 520 : 650;

    timerRef.current = setTimeout(() => {
      setVisible(false);
      onCompleteRef.current?.();
      timerRef.current = null;
    }, duration);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [show, value]);

  if (!visible) return null;

  const isPositive = displayValue >= 0;
  const absValue = Math.abs(displayValue);
  const isSmall = absValue < 1; // 1점 미만

  // 정수 반올림 표시 (소수점 제거)
  const displayStr = String(Math.round(absValue));

  if (isSmall) {
    // 1점 미만 전용 애니메이션: 작은 반짝임 + 물결 효과
    return (
      <div
        key={animKey}
        style={{
          position: "fixed",
          top: "22%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 50,
          animation: "dmgTinyPulse 0.7s ease-out forwards",
        }}
      >
        <div
          style={{
            fontSize: "1.35rem",
            fontWeight: "700",
            lineHeight: 1,
            color: isPositive ? "#10b981" : "#ef4444",
            textShadow: isPositive
              ? "0 0 8px rgba(16, 185, 129, 0.35)"
              : "0 0 8px rgba(239, 68, 68, 0.35)",
            opacity: 0.78,
          }}
        >
          {isPositive ? "▲" : "▼"}
          <span style={{ fontSize: "1.05rem", marginLeft: "4px" }}>
            {isPositive ? "+1" : "-1"}점
          </span>
          <span style={{ fontSize: "0.8rem", marginLeft: "6px", opacity: 0.65 }}>
            미만
          </span>
        </div>

        <style>{`
          @keyframes dmgTinyPulse {
            0% {
              transform: translate(-50%, -50%) scale(0.8);
              opacity: 0;
            }
            20% {
              transform: translate(-50%, -50%) scale(1.1);
              opacity: 1;
            }
            50% {
              transform: translate(-50%, -50%) scale(1);
              opacity: 1;
            }
            100% {
              transform: translate(-50%, -50%) scale(0.96) translateY(${isPositive ? '-12px' : '12px'});
              opacity: 0;
            }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      key={animKey}
      style={{
        position: "fixed",
        top: "22%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        zIndex: 50,
        animation: isPositive
          ? "dmgFloatUp 0.65s ease-out forwards"
          : "dmgFloatDown 0.65s ease-out forwards",
      }}
    >
      <div
        style={{
          fontSize: "2rem",
          fontWeight: "800",
          lineHeight: 1,
          color: isPositive ? "#10b981" : "#ef4444",
          textShadow: isPositive
            ? "0 0 10px rgba(16, 185, 129, 0.35), 1px 1px 2px rgba(0,0,0,0.18)"
            : "0 0 10px rgba(239, 68, 68, 0.35), 1px 1px 2px rgba(0,0,0,0.18)",
          opacity: 0.86,
        }}
      >
        {isPositive ? "+" : "-"}
        {displayStr}점
      </div>

      <style>{`
        @keyframes dmgFloatUp {
          0% {
            transform: translate(-50%, -50%) translateY(0);
            opacity: 1;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) translateY(-24px);
            opacity: 0;
          }
        }

        @keyframes dmgFloatDown {
          0% {
            transform: translate(-50%, -50%) translateY(0);
            opacity: 1;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) translateY(24px);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
