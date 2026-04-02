/**
 * 시험 안정도 (Exam Confidence) - MVP Heuristic Scoring Module
 *
 * 사용자가 "지금 시험 보면 기억할 가능성"을 직관적으로 파악할 수 있도록
 * 연습/시험 기록을 기반으로 0~100 점수를 산출합니다.
 *
 * 설계 원칙:
 * - 연습(answer-visible)보다 시험(recall) 성공이 더 큰 가중치
 * - 최근성(recency)이 중요 - 오래된 기록은 감점
 * - 오답/불안정 패턴은 감점
 * - 데이터 없는 문제는 중립-낮은 점수(35%)
 * - 연습만으로는 녹색(안전) 상태에 도달 불가
 */

// ─── Configurable Thresholds ───────────────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  green: 80,   // 80~100: 거의 기억
  yellow: 50,  // 50~79: 헷갈릴 수 있음
  // 0~49: 다시 볼 것 (red)
} as const;

export const TRAFFIC_LIGHT_LABELS = {
  green: "거의 기억",
  yellow: "헷갈릴 수 있음",
  red: "다시 볼 것",
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
  /** Display score 0~100 after transform (min floor 10) */
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

function computeForgettingPenalty(
  lastPracticeAt: Date | null,
  lastTestAt: Date | null,
  now: Date
): number {
  // Use the most recent meaningful interaction
  const candidates = [lastPracticeAt, lastTestAt].filter(Boolean) as Date[];
  if (candidates.length === 0) return 55; // no interaction at all

  const mostRecent = new Date(Math.max(...candidates.map(d => d.getTime())));
  const hours = hoursSince(mostRecent, now);

  if (hours < 6) return 0;
  if (hours < 24) return 8;
  if (hours < 72) return 15;   // 1~3 days
  if (hours < 168) return 25;  // 3~7 days
  if (hours < 336) return 40;  // 7~14 days
  return 55;                    // 14+ days
}

// ─── Main Scoring Function ─────────────────────────────────────────

export function computeExamConfidence(input: ConfidenceInput): ConfidenceResult {
  const now = input.now ?? new Date();
  const { practice, test } = input;

  // Cold-start detection
  const hasAnyData = practice.practiceCount > 0 || test.testCount > 0;
  if (!hasAnyData) {
    return {
      rawScore: 0,
      displayScore: 35,
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

  // A. Practice contribution (max ~40)
  // 1회: 12점, 2회: 20점, 3회: 26점, 5회+: 35점 수렴
  const practiceVolumeScore = Math.min(practice.practiceCount * 10, 35);
  // Small bonus for total duration (up to 5 points)
  const practiceBonus = practice.totalPracticeDuration > 0
    ? Math.min(Math.floor(practice.totalPracticeDuration / 60) * 1, 5) // 1 point per minute, max 5
    : 0;

  // B. Test contribution (max ~70)
  const testExposureScore = Math.min(test.testCount * 5, 20);
  const testAccuracyScore = test.testCount > 0
    ? Math.min((test.averageSimilarityScore / 100) * 30, 30)
    : 0;
  const testCorrectnessBonus = Math.min(test.correctCount * 4, 12);
  const recentStreakScore = Math.min(test.recentCorrectStreak * 4, 8);

  // Speed bonus: fast recall earns extra points (max 8)
  // Under 10s = 8pts, under 20s = 5pts, under 30s = 3pts, under 45s = 1pt
  let speedBonus = 0;
  if (test.testCount > 0 && test.averageRecallTime !== undefined) {
    const avgTime = test.averageRecallTime;
    if (avgTime <= 10) speedBonus = 8;
    else if (avgTime <= 20) speedBonus = 5;
    else if (avgTime <= 30) speedBonus = 3;
    else if (avgTime <= 45) speedBonus = 1;
  }

  // C. Forgetting penalty
  const forgettingPenalty = computeForgettingPenalty(
    practice.mostRecentPracticeAt,
    test.mostRecentTestAt,
    now
  );

  // D. Error / instability penalty
  // 오답 1회: -12점, 2회: -22점, 3회: -30점, 4회+: -36점 (max 36)
  // 이전: wrongCount * 6, max 18 → 3회 틀려도 18점밖에 감소 안 됨
  const wrongPenalty = test.wrongCount > 0
    ? Math.min(8 + (test.wrongCount - 1) * 10, 36)
    : 0;
  const recentPoorPenalty = test.mostRecentTestWasPoor ? 10 : 0;

  // E. Final formula
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

  // Display transform: floor at 10 to avoid brutally hopeless numbers
  // 정수 단위로 반올림
  const displayScore = clamp(Math.round(rawScore * 0.9 + 10), 0, 100);

  // Traffic light
  let state: "green" | "yellow" | "red";
  if (displayScore >= CONFIDENCE_THRESHOLDS.green) {
    state = "green";
  } else if (displayScore >= CONFIDENCE_THRESHOLDS.yellow) {
    state = "yellow";
  } else {
    state = "red";
  }

  // Practice-only cap: if no test data, cap at yellow (max 65 display)
  // This prevents pure practice from pushing into misleading green
  if (test.testCount === 0 && state === "green") {
    state = "yellow";
  }

  const label = TRAFFIC_LIGHT_LABELS[state];

  return {
    rawScore,
    displayScore: test.testCount === 0 ? Math.min(displayScore, 65) : displayScore,
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
