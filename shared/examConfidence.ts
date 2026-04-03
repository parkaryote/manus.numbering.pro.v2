/**
 * 시험 안정도 (Exam Confidence) - Realistic Learning Curve Module
 *
 * 설계 원칙:
 * - cold-start = 0% (아무것도 안 했으면 0%)
 * - 연습만으로는 최대 25% (연습은 보조 수단)
 * - 시험 통과가 핵심 점수 상승 요인
 * - 연속 정답 streak이 높을수록 급격히 상승
 * - 망각 패널티는 시간 경과에 따라 점진적 감소
 * - 오답은 강한 패널티 (특히 최근 오답)
 *
 * 현실적 기대값:
 *   cold-start          → 0%
 *   연습 1회             → ~6%
 *   연습 3회             → ~15%
 *   시험 1회 통과         → ~40%
 *   시험 2회 연속 통과    → ~65%
 *   시험 3회+ 연속 통과   → ~85~95%
 */

// ─── Configurable Thresholds ───────────────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  green: 80,   // 80~100: 안정
  yellow: 40,  // 40~79: 학습중
  // 0~39: 취약 (red)
} as const;

export const TRAFFIC_LIGHT_LABELS = {
  green: "안정",
  yellow: "학습중",
  red: "취약",
} as const;

// ─── Input Types ───────────────────────────────────────────────────

export interface PracticeSignal {
  practiceCount: number;
  totalPracticeDuration: number; // seconds
  mostRecentPracticeAt: Date | null;
}

export interface TestSignal {
  testCount: number;
  correctCount: number;
  wrongCount: number;
  averageSimilarityScore: number; // 0~100
  mostRecentTestAt: Date | null;
  recentCorrectStreak: number;
  mostRecentTestWasPoor: boolean; // similarityScore < 50 or isCorrect === 0
  averageRecallTime?: number; // 평균 회상 시간(초) - 빠른 입력 보너스용
}

export interface ConfidenceInput {
  practice: PracticeSignal;
  test: TestSignal;
  now?: Date; // for testing, defaults to new Date()
}

export interface ConfidenceResult {
  /** Raw score 0~100 before display transform */
  rawScore: number;
  /** Display score 0~100 (정수) */
  displayScore: number;
  /** Traffic light state */
  state: "green" | "yellow" | "red";
  /** Korean label */
  label: string;
  /** Whether this is a cold-start (no data) result */
  isColdStart: boolean;
  /** Score breakdown for debugging / future tooltip */
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  practiceVolumeScore: number;
  practiceBonus: number;
  testExposureScore: number;
  testAccuracyScore: number;
  testCorrectnessBonus: number;
  recentStreakScore: number;
  speedBonus: number;
  forgettingPenalty: number;
  wrongPenalty: number;
  recentPoorPenalty: number;
}

// ─── Helpers ───────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hoursSince(date: Date | null, now: Date): number {
  if (!date) return Infinity;
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

// ─── Forgetting Penalty ────────────────────────────────────────────
// 시험 경험이 없으면 망각 패널티 없음 (연습만 한 경우 패널티 적용 안 함)
// 시험 경험이 있을 때만 망각 패널티 적용

function computeForgettingPenalty(
  lastPracticeAt: Date | null,
  lastTestAt: Date | null,
  testCount: number,
  now: Date
): number {
  // 시험 경험이 없으면 망각 패널티 없음
  if (testCount === 0) return 0;

  // Use the most recent meaningful interaction
  const candidates = [lastPracticeAt, lastTestAt].filter(Boolean) as Date[];
  if (candidates.length === 0) return 0;

  const mostRecent = new Date(Math.max(...candidates.map(d => d.getTime())));
  const hours = hoursSince(mostRecent, now);

  if (hours < 12) return 0;
  if (hours < 24) return 5;
  if (hours < 72) return 12;   // 1~3 days
  if (hours < 168) return 22;  // 3~7 days
  if (hours < 336) return 35;  // 7~14 days
  return 50;                    // 14+ days
}

// ─── Main Scoring Function ─────────────────────────────────────────

export function computeExamConfidence(input: ConfidenceInput): ConfidenceResult {
  const now = input.now ?? new Date();
  const { practice, test } = input;

  // Cold-start: 아무것도 안 했으면 0%
  const hasAnyData = practice.practiceCount > 0 || test.testCount > 0;
  if (!hasAnyData) {
    return {
      rawScore: 0,
      displayScore: 0,
      state: "red",
      label: TRAFFIC_LIGHT_LABELS.red,
      isColdStart: true,
      breakdown: {
        practiceVolumeScore: 0,
        practiceBonus: 0,
        testExposureScore: 0,
        testAccuracyScore: 0,
        testCorrectnessBonus: 0,
        recentStreakScore: 0,
        speedBonus: 0,
        forgettingPenalty: 0,
        wrongPenalty: 0,
        recentPoorPenalty: 0,
      },
    };
  }

  // ── A. 연습 기여 (최대 25점) ──────────────────────────────────────
  // 연습은 보조 수단 - 많이 해도 25%를 넘을 수 없음
  // 1회: 6점, 2회: 11점, 3회: 15점, 5회: 20점, 10회+: 25점
  const practiceVolumeScore = Math.min(
    Math.round(25 * (1 - Math.exp(-practice.practiceCount * 0.25))),
    25
  );

  // 연습 시간 보너스 (최대 3점)
  const practiceBonus = practice.totalPracticeDuration > 0
    ? Math.min(Math.floor(practice.totalPracticeDuration / 120), 3) // 2분당 1점, 최대 3점
    : 0;

  // ── B. 시험 기여 (최대 80점) ──────────────────────────────────────
  // 시험 노출 횟수 (최대 10점)
  const testExposureScore = Math.min(test.testCount * 3, 10);

  // 시험 정확도 (최대 25점)
  const testAccuracyScore = test.testCount > 0
    ? Math.min((test.averageSimilarityScore / 100) * 25, 25)
    : 0;

  // 정답 횟수 보너스 (최대 15점)
  const testCorrectnessBonus = Math.min(test.correctCount * 5, 15);

  // ── 연속 정답 streak - 핵심 점수 ──────────────────────────────────
  // streak 1: +10, streak 2: +25, streak 3: +40, streak 4+: +55
  // 연속 정답이 쌓일수록 급격히 상승 (시험을 반복해서 통과해야 안정)
  let recentStreakScore = 0;
  if (test.recentCorrectStreak >= 4) recentStreakScore = 55;
  else if (test.recentCorrectStreak === 3) recentStreakScore = 40;
  else if (test.recentCorrectStreak === 2) recentStreakScore = 25;
  else if (test.recentCorrectStreak === 1) recentStreakScore = 10;

  // 빠른 회상 보너스 (최대 5점)
  let speedBonus = 0;
  if (test.testCount > 0 && test.averageRecallTime !== undefined) {
    const avgTime = test.averageRecallTime;
    if (avgTime <= 10) speedBonus = 5;
    else if (avgTime <= 20) speedBonus = 3;
    else if (avgTime <= 30) speedBonus = 1;
  }

  // ── C. 망각 패널티 ────────────────────────────────────────────────
  const forgettingPenalty = computeForgettingPenalty(
    practice.mostRecentPracticeAt,
    test.mostRecentTestAt,
    test.testCount,
    now
  );

  // ── D. 오답 패널티 ────────────────────────────────────────────────
  // 오답 1회: -15, 2회: -28, 3회: -40, 4회+: -50
  // 연속 오답은 streak을 0으로 만들어 recentStreakScore도 0이 되므로 이중 패널티
  const wrongPenalty = test.wrongCount > 0
    ? Math.min(15 + (test.wrongCount - 1) * 13, 50)
    : 0;

  // 최근 시험이 나빴으면 추가 패널티
  const recentPoorPenalty = test.mostRecentTestWasPoor ? 15 : 0;

  // ── E. 최종 점수 ──────────────────────────────────────────────────
  const rawScore = clamp(
    practiceVolumeScore +
    practiceBonus +
    testExposureScore +
    testAccuracyScore +
    testCorrectnessBonus +
    recentStreakScore +
    speedBonus -
    forgettingPenalty -
    wrongPenalty -
    recentPoorPenalty,
    0,
    100
  );

  // 정수 반올림, 연습만 한 경우 최대 28점으로 캡
  const practiceOnlyCap = test.testCount === 0 ? 28 : 100;
  const displayScore = Math.min(Math.round(rawScore), practiceOnlyCap);

  // Traffic light
  let state: "green" | "yellow" | "red";
  if (displayScore >= CONFIDENCE_THRESHOLDS.green) {
    state = "green";
  } else if (displayScore >= CONFIDENCE_THRESHOLDS.yellow) {
    state = "yellow";
  } else {
    state = "red";
  }

  const label = TRAFFIC_LIGHT_LABELS[state];

  return {
    rawScore,
    displayScore,
    state,
    label,
    isColdStart: false,
    breakdown: {
      practiceVolumeScore,
      practiceBonus,
      testExposureScore,
      testAccuracyScore,
      testCorrectnessBonus,
      recentStreakScore,
      speedBonus,
      forgettingPenalty,
      wrongPenalty,
      recentPoorPenalty,
    },
  };
}

// ─── Aggregation ───────────────────────────────────────────────────

export function aggregateConfidence(results: ConfidenceResult[]): {
  averageScore: number;
  state: "green" | "yellow" | "red";
  label: string;
  totalQuestions: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
} {
  if (results.length === 0) {
    return {
      averageScore: 0,
      state: "red",
      label: TRAFFIC_LIGHT_LABELS.red,
      totalQuestions: 0,
      greenCount: 0,
      yellowCount: 0,
      redCount: 0,
    };
  }

  const averageScore = Math.round(
    results.reduce((sum, r) => sum + r.displayScore, 0) / results.length
  );

  let state: "green" | "yellow" | "red";
  if (averageScore >= CONFIDENCE_THRESHOLDS.green) {
    state = "green";
  } else if (averageScore >= CONFIDENCE_THRESHOLDS.yellow) {
    state = "yellow";
  } else {
    state = "red";
  }

  return {
    averageScore,
    state,
    label: TRAFFIC_LIGHT_LABELS[state],
    totalQuestions: results.length,
    greenCount: results.filter(r => r.state === "green").length,
    yellowCount: results.filter(r => r.state === "yellow").length,
    redCount: results.filter(r => r.state === "red").length,
  };
}
