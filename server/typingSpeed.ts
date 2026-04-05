/**
 * Typing Speed Bonus System
 * - Relative speed vs user's personal baseline (not absolute speed)
 * - No penalty for slow input; only bonus for fast
 * - Adjusts for answer length via bucketing
 * - Uses p60 percentile of recent 50 attempts as baseline
 */

export type TypingMode = "practice" | "exam";
export type LengthBucket = 1 | 2 | 3 | 4;
export type SpeedLabel = "great" | "fast" | "normal" | "slow";

export interface TypingAttemptInput {
  answerLength: number;
  inputChars: number;
  timeToFirstKey: number; // ms (not used in speed calc, stored only)
  typingStartTime: number; // timestamp ms
  typingEndTime: number; // timestamp ms
  backspaceCount: number;
  pasteDetected: boolean;
  mode: TypingMode;
}

export interface EffectiveSpeedResult {
  typingDuration: number; // ms
  charsPerSec: number;
  efficiency: number;
  effectiveSpeed: number; // chars/sec
  lengthBucket: LengthBucket;
}

export interface SpeedBonusResult {
  bonus: number; // 0, 1, 2
  ratio: number;
  effectiveSpeed: number;
  expectedSpeed: number;
  label: SpeedLabel;
}

/** 답안 길이 → 버킷 (1~4) */
export function getLengthBucket(answerLength: number): LengthBucket {
  if (answerLength <= 3) return 1;
  if (answerLength <= 6) return 2;
  if (answerLength <= 10) return 3;
  return 4;
}

/** clamp helper */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 1. calculateEffectiveSpeed
 * typingDuration = typingEndTime - typingStartTime (thinking time 제외)
 * efficiency = clamp(1 - backspace/inputChars, 0.75, 1.0)
 * effectiveSpeed = charsPerSec * efficiency
 */
export function calculateEffectiveSpeed(attempt: TypingAttemptInput): EffectiveSpeedResult {
  const typingDuration = attempt.typingEndTime - attempt.typingStartTime;
  const durationSec = Math.max(typingDuration / 1000, 0.001); // 0으로 나누기 방지
  const charsPerSec = attempt.inputChars / durationSec;
  const efficiency = clamp(
    1 - attempt.backspaceCount / Math.max(attempt.inputChars, 1),
    0.75,
    1.0
  );
  const effectiveSpeed = charsPerSec * efficiency;
  const lengthBucket = getLengthBucket(attempt.answerLength);

  return {
    typingDuration,
    charsPerSec,
    efficiency,
    effectiveSpeed,
    lengthBucket,
  };
}

/**
 * 2. getBaseline
 * personalWeight = min(sampleCount / 30, 1)
 * finalBaseline = personalWeight * personalBaseline + (1 - personalWeight) * globalBaseline
 */
export function computeBlendedBaseline(
  personalBaselineSpeed: number | null,
  sampleCount: number,
  globalBaselineSpeed: number
): number {
  if (personalBaselineSpeed === null || sampleCount === 0) {
    return globalBaselineSpeed;
  }
  const personalWeight = Math.min(sampleCount / 30, 1);
  return personalWeight * personalBaselineSpeed + (1 - personalWeight) * globalBaselineSpeed;
}

/**
 * 시험 모드 expectedSpeed 계산
 * examBaseline이 있으면 그것을, 없으면 practiceBaseline * 0.8
 */
export function computeExpectedSpeed(
  examBaselineSpeed: number | null,
  practiceBaselineSpeed: number
): number {
  if (examBaselineSpeed !== null && examBaselineSpeed > 0) {
    return examBaselineSpeed;
  }
  return practiceBaselineSpeed * 0.8;
}

/**
 * 3. calculateSpeedBonus
 * ratio = effectiveSpeed / expectedSpeed
 * bonus: ratio >= 1.15 → 2, >= 0.95 → 1, else → 0
 */
export function calculateSpeedBonus(
  effectiveSpeed: number,
  expectedSpeed: number
): SpeedBonusResult {
  if (expectedSpeed <= 0) {
    return { bonus: 0, ratio: 1, effectiveSpeed, expectedSpeed, label: "normal" };
  }

  const ratio = effectiveSpeed / expectedSpeed;

  let bonus: number;
  let label: SpeedLabel;

  if (ratio >= 1.15) {
    bonus = 2;
    label = "great";
  } else if (ratio >= 0.95) {
    bonus = 1;
    label = "fast";
  } else if (ratio >= 0.80) {
    bonus = 0;
    label = "normal";
  } else {
    bonus = 0;
    label = "slow";
  }

  return { bonus, ratio, effectiveSpeed, expectedSpeed, label };
}

/**
 * p60 percentile 계산 (정렬된 배열 기준)
 */
export function computeP60(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.6);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/**
 * 베이스라인 업데이트 조건 검사
 * pasteDetected=false, inputChars>=2, typingDuration>=300ms
 */
export function shouldUpdateBaseline(attempt: TypingAttemptInput): boolean {
  if (attempt.pasteDetected) return false;
  if (attempt.inputChars < 2) return false;
  const duration = attempt.typingEndTime - attempt.typingStartTime;
  if (duration < 300) return false;
  return true;
}

/** effectiveSpeed를 DB 저장용 정수로 변환 (×1000) */
export function speedToInt(speed: number): number {
  return Math.round(speed * 1000);
}

/** DB 저장 정수를 float으로 복원 (÷1000) */
export function intToSpeed(value: number): number {
  return value / 1000;
}
