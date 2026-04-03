/**
 * 시험 안정도 (Exam Confidence) - Realistic Learning Curve Module
 *
 * 설계 원칙:
 * - cold-start = 0% (아무것도 안 했으면 0%)
 * - 연습만으로는 최대 25% (연습은 보조 수단)
 * - 시험 통과가 핵심 점수 상승 요인
 * - 정답률 80% 이상이면 안정(초록) 도달 가능
 *   예: 5개 중 4개, 6개 중 5개 맞추면 초록
 * - 연속 정답 streak이 높을수록 급격히 상승
 * - 망각 패널티는 시간 경과에 따라 점진적 감소
 * - 오답은 패널티가 있지만, 정답률이 높으면 완화
 *
 * 현실적 기대값:
 *   cold-start          → 0%
 *   연습 1회             → ~6%
 *   연습 3회             → ~15%
 *   시험 1회 통과         → ~40%
 *   시험 2회 연속 통과    → ~65%
 *   시험 3회+ 연속 통과   → ~85~95%
 *   시험 5회 중 4회 정답  → ~80% (초록)
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
  mostRecentTestWasPoor: boolean; // similarityScore < 50
  averageRecallTime?: number; // 평균 회상 시간(초) - 빠른 입력 보너스용
  /** 시험 유형: 'individual' = 개별 문제 시험(max +12), 'exam' = 모의고사(max +6) */
  testType?: 'individual' | 'exam';
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

  // ── 정답률 계산 ──────────────────────────────────────────────────
  const correctRate = test.testCount > 0
    ? test.correctCount / test.testCount
    : 0;

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

  // 시험 정확도 (최대 25점) - 정답률 기반으로 변경
  // 정답률 100%: 25점, 80%: 20점, 60%: 15점
  const testAccuracyScore = test.testCount > 0
    ? Math.min(Math.round(correctRate * 25), 25)
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

  // 빠른 회상 보너스 (개별 시험: max +12, 모의고사: max +6)
  // 개별 문제 시험은 더 높은 보너스 (집중적 반복 학습 보상)
  // 모의고사는 전체 흐름 파악이 목적이므로 보너스 절반
  const isExamMode = test.testType === 'exam';
  let speedBonus = 0;
  if (test.testCount > 0 && test.averageRecallTime !== undefined) {
    const avgTime = test.averageRecallTime;
    if (isExamMode) {
      // 모의고사: max +6
      if (avgTime <= 10) speedBonus = 6;
      else if (avgTime <= 20) speedBonus = 4;
      else if (avgTime <= 30) speedBonus = 2;
      else if (avgTime <= 45) speedBonus = 1;
    } else {
      // 개별 시험: max +12
      if (avgTime <= 10) speedBonus = 12;
      else if (avgTime <= 20) speedBonus = 8;
      else if (avgTime <= 30) speedBonus = 5;
      else if (avgTime <= 45) speedBonus = 2;
    }
  }

  // ── C. 망각 패널티 ────────────────────────────────────────────────
  const forgettingPenalty = computeForgettingPenalty(
    practice.mostRecentPracticeAt,
    test.mostRecentTestAt,
    test.testCount,
    now
  );

  // ── D. 오답 패널티 ────────────────────────────────────────────────
  // 정답률에 따라 패널티 완화:
  // - 정답률 80% 이상: 패널티 대폭 감소 (소수 오답은 관대하게)
  // - 정답률 60~80%: 패널티 중간
  // - 정답률 60% 미만: 패널티 전액
  let wrongPenalty = 0;
  if (test.wrongCount > 0) {
    const basePenalty = Math.min(15 + (test.wrongCount - 1) * 13, 50);
    // 정답률에 따른 패널티 감면
    if (correctRate >= 0.8) {
      // 80% 이상 정답률: 패널티 20%만 적용
      wrongPenalty = Math.round(basePenalty * 0.2);
    } else if (correctRate >= 0.6) {
      // 60~80%: 패널티 60% 적용
      wrongPenalty = Math.round(basePenalty * 0.6);
    } else {
      // 60% 미만: 패널티 전액
      wrongPenalty = basePenalty;
    }
  }

  // 최근 시험이 나빴으면 추가 패널티 (유사도 50 미만)
  // 정답률 80% 이상이면 이 패널티도 완화
  let recentPoorPenalty = 0;
  if (test.mostRecentTestWasPoor) {
    recentPoorPenalty = correctRate >= 0.8 ? 5 : 15;
  }

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

// ─── Exam Date Prediction ─────────────────────────────────────────
// 시험일까지 남은 기간과 망각 곡선을 고려하여 시험 당일 예상 안정도를 계산
// 에빙하우스 망각 곡선 기반: 복습 없이 시간이 지나면 안정도가 감소

export interface ExamDatePrediction {
  /** 시험 당일 예상 안정도 (0~100) */
  predictedScore: number;
  /** 예상 상태 */
  predictedState: "green" | "yellow" | "red";
  /** 예상 상태 라벨 */
  predictedLabel: string;
  /** 시험까지 남은 일수 */
  daysUntilExam: number;
  /** 현재 안정도 */
  currentScore: number;
  /** 예상 변화량 (음수면 감소) */
  scoreDelta: number;
  /** 안정 도달 가능 여부 */
  canReachGreen: boolean;
}

export function predictExamDayConfidence(
  currentResult: ConfidenceResult,
  examDate: Date,
  now?: Date
): ExamDatePrediction {
  const nowDate = now ?? new Date();
  const daysUntilExam = Math.max(0, Math.round((examDate.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24)));
  const currentScore = currentResult.displayScore;

  // 시험일까지 복습 없이 망각만 적용했을 때의 패널티
  // 에빙하우스 망각 곡선 근사: 시험 경험이 있을 때만 적용
  const hoursUntilExam = daysUntilExam * 24;
  let forgettingAtExam = 0;

  if (currentResult.isColdStart) {
    // cold-start: 변화 없음
    forgettingAtExam = 0;
  } else if (hoursUntilExam < 12) {
    forgettingAtExam = 0;
  } else if (hoursUntilExam < 24) {
    forgettingAtExam = 5;
  } else if (hoursUntilExam < 72) {
    forgettingAtExam = 12;
  } else if (hoursUntilExam < 168) {
    forgettingAtExam = 22;
  } else if (hoursUntilExam < 336) {
    forgettingAtExam = 35;
  } else {
    forgettingAtExam = 50;
  }

  // 현재 망각 패널티와의 차이 (추가 감소분)
  const currentForgetting = currentResult.breakdown.forgettingPenalty;
  const additionalForgetting = Math.max(0, forgettingAtExam - currentForgetting);

  const predictedScore = Math.max(0, Math.min(100, currentScore - additionalForgetting));
  const scoreDelta = predictedScore - currentScore;

  let predictedState: "green" | "yellow" | "red";
  if (predictedScore >= CONFIDENCE_THRESHOLDS.green) {
    predictedState = "green";
  } else if (predictedScore >= CONFIDENCE_THRESHOLDS.yellow) {
    predictedState = "yellow";
  } else {
    predictedState = "red";
  }

  // 지금 안정도가 초록이면 시험일에도 초록 가능성 높음
  // 지금 노란색이면 복습 없이는 빨간색으로 떨어질 수 있음
  const canReachGreen = currentScore >= CONFIDENCE_THRESHOLDS.green;

  return {
    predictedScore,
    predictedState,
    predictedLabel: TRAFFIC_LIGHT_LABELS[predictedState],
    daysUntilExam,
    currentScore,
    scoreDelta,
    canReachGreen,
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
