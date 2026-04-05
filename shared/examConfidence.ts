/**
 * 시험 안정도 (Exam Confidence) - Forgetting-Curve Weighted Module
 *
 * 설계 원칙:
 * ─────────────────────────────────────────────────────────────────
 * 1. cold-start = 0%
 * 2. 연습만으로는 최대 25% (연습은 보조 수단)
 * 3. 시험 통과가 핵심 점수 상승 요인
 * 4. "시간이 지난 뒤 회상 성공"이 더 큰 점수 상승을 줌 (망각곡선 보상)
 *    - 직전 시험 후 6시간 이내 재시험: streak 가중치 0.2 (거의 증가 없음)
 *    - 6~24시간 후: 가중치 0.5
 *    - 24~72시간 후: 가중치 1.0 (기본)
 *    - 72시간+ 후: 가중치 1.3 (망각 극복 보상)
 * 5. 유사도 80% 이상이면 "사실상 정답"으로 처리
 *    - isCorrect=false여도 유사도 80%+ → 오답 패널티 대폭 완화
 * 6. 망각 패널티는 마지막 상호작용 이후 시간 경과에 따라 점진적 감소
 *
 * 현실적 기대값 (3일 뒤 시험 기준):
 *   cold-start                → 0%
 *   연습 3회                   → ~15%
 *   시험 1회 통과 (당일)        → ~35%
 *   시험 1회 통과 (24h 후 재확인) → ~50%
 *   시험 2회 통과 (간격 있음)   → ~70%
 *   시험 3회+ 통과 (간격 있음)  → ~85~95%
 *   바로 연속 2회 통과          → ~40% (간격 없으면 증가 억제)
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
  averageRecallTime?: number; // 평균 회상 시간(초)
  /** 시험 유형: 'individual' = 개별 문제 시험, 'exam' = 모의고사 */
  testType?: 'individual' | 'exam';
  /**
   * 최근 시험 이력 (시간 가중 streak 계산용)
   * 최신순 정렬, 각 항목에 completedAt과 isCorrect, similarityScore 포함
   */
  recentTestHistory?: Array<{
    completedAt: Date;
    isCorrect: boolean;
    similarityScore: number;
  }>;
}

export interface ConfidenceInput {
  practice: PracticeSignal;
  test: TestSignal;
  now?: Date; // for testing, defaults to new Date()
}

export interface ConfidenceResult {
  rawScore: number;
  displayScore: number;
  state: "green" | "yellow" | "red";
  label: string;
  isColdStart: boolean;
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  practiceVolumeScore: number;
  practiceBonus: number;
  testExposureScore: number;
  testAccuracyScore: number;
  timeWeightedStreakScore: number;
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

// ─── Time-gap Weight for Streak ────────────────────────────────────
/**
 * 직전 시험과의 시간 간격에 따른 streak 가중치
 * 짧은 간격 = 낮은 가중치 (바로 다시 보면 의미 없음)
 * 긴 간격 = 높은 가중치 (망각 후 회상 성공 = 진짜 학습)
 */
function getTimeGapWeight(hoursSincePrev: number): number {
  if (hoursSincePrev < 1) return 0.1;   // 1시간 이내: 거의 무의미
  if (hoursSincePrev < 6) return 0.2;   // 6시간 이내: 매우 낮음
  if (hoursSincePrev < 24) return 0.5;  // 6~24시간: 절반
  if (hoursSincePrev < 72) return 1.0;  // 1~3일: 기본값
  return 1.3;                            // 3일+: 망각 극복 보상
}

// ─── Time-weighted Streak Score ────────────────────────────────────
/**
 * 시간 가중 streak 점수 계산
 * 각 연속 정답에 시간 간격 가중치를 곱해서 누적
 * 최대 55점
 */
function computeTimeWeightedStreakScore(
  history: Array<{ completedAt: Date; isCorrect: boolean; similarityScore: number }>,
  now: Date
): number {
  if (history.length === 0) return 0;

  // 최신순 정렬 확인 (이미 정렬되어 있어야 함)
  let score = 0;
  let prevTime: Date = now;

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    // 유사도 80% 이상이면 사실상 정답으로 처리
    const isEffectivelyCorrect = item.isCorrect || item.similarityScore >= 80;

    if (!isEffectivelyCorrect) break; // streak 끊김

    const hoursSincePrev = i === 0
      ? hoursSince(item.completedAt, now)  // 가장 최근 시험 ~ 현재
      : (prevTime.getTime() - item.completedAt.getTime()) / (1000 * 60 * 60); // 연속 시험 간격

    const weight = i === 0
      ? 1.0  // 첫 번째 streak은 시간 가중치 없이 기본 점수
      : getTimeGapWeight(hoursSincePrev); // 이후 streak은 간격 가중치 적용

    // streak 순서별 기본 점수: 1st=10, 2nd=15, 3rd=18, 4th+=12
    const basePoints = i === 0 ? 10 : i === 1 ? 15 : i === 2 ? 18 : 12;
    score += basePoints * weight;

    prevTime = item.completedAt;
  }

  return Math.min(Math.round(score), 55);
}

// ─── Forgetting Penalty ────────────────────────────────────────────
function computeForgettingPenalty(
  lastPracticeAt: Date | null,
  lastTestAt: Date | null,
  testCount: number,
  now: Date
): number {
  if (testCount === 0) return 0;

  const candidates = [lastPracticeAt, lastTestAt].filter(Boolean) as Date[];
  if (candidates.length === 0) return 0;

  const mostRecent = new Date(Math.max(...candidates.map(d => d.getTime())));
  const hours = hoursSince(mostRecent, now);

  if (hours < 12) return 0;
  if (hours < 24) return 5;
  if (hours < 72) return 12;
  if (hours < 168) return 22;
  if (hours < 336) return 35;
  return 50;
}

// ─── Main Scoring Function ─────────────────────────────────────────

export function computeExamConfidence(input: ConfidenceInput): ConfidenceResult {
  const now = input.now ?? new Date();
  const { practice, test } = input;

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
        timeWeightedStreakScore: 0,
        speedBonus: 0,
        forgettingPenalty: 0,
        wrongPenalty: 0,
        recentPoorPenalty: 0,
      },
    };
  }

  // ── 정답률 계산 (유사도 80% 이상 = 사실상 정답) ──────────────────
  const effectiveCorrectCount = test.recentTestHistory
    ? test.recentTestHistory.filter(t => t.isCorrect || t.similarityScore >= 80).length
    : test.correctCount;
  const effectiveCorrectRate = test.testCount > 0
    ? effectiveCorrectCount / test.testCount
    : 0;

  // ── A. 연습 기여 (최대 25점) ──────────────────────────────────────
  const practiceVolumeScore = Math.min(
    Math.round(25 * (1 - Math.exp(-practice.practiceCount * 0.25))),
    25
  );
  const practiceBonus = practice.totalPracticeDuration > 0
    ? Math.min(Math.floor(practice.totalPracticeDuration / 120), 3)
    : 0;

  // ── B. 시험 기여 ──────────────────────────────────────────────────
  // 시험 노출 횟수 (최대 8점)
  const testExposureScore = Math.min(test.testCount * 2, 8);

  // 시험 정확도 (최대 20점) - 유사도 보정 정답률 기반
  const testAccuracyScore = test.testCount > 0
    ? Math.min(Math.round(effectiveCorrectRate * 20), 20)
    : 0;

  // ── C. 시간 가중 streak 점수 (최대 55점) ─────────────────────────
  // recentTestHistory가 있으면 정밀 계산, 없으면 기존 streak 기반 근사
  let timeWeightedStreakScore = 0;
  if (test.recentTestHistory && test.recentTestHistory.length > 0) {
    timeWeightedStreakScore = computeTimeWeightedStreakScore(test.recentTestHistory, now);
  } else {
    // fallback: 기존 streak 기반 (시간 정보 없음 → 보수적으로 계산)
    const s = test.recentCorrectStreak;
    if (s >= 4) timeWeightedStreakScore = 40;
    else if (s === 3) timeWeightedStreakScore = 30;
    else if (s === 2) timeWeightedStreakScore = 20;
    else if (s === 1) timeWeightedStreakScore = 10;
  }

  // ── D. 빠른 회상 보너스 (최대 10점) ─────────────────────────────
  const isExamMode = test.testType === 'exam';
  let speedBonus = 0;
  if (test.testCount > 0 && test.averageRecallTime !== undefined) {
    const avgTime = test.averageRecallTime;
    if (isExamMode) {
      if (avgTime <= 10) speedBonus = 6;
      else if (avgTime <= 20) speedBonus = 4;
      else if (avgTime <= 30) speedBonus = 2;
    } else {
      if (avgTime <= 10) speedBonus = 10;
      else if (avgTime <= 20) speedBonus = 6;
      else if (avgTime <= 30) speedBonus = 3;
      else if (avgTime <= 45) speedBonus = 1;
    }
  }

  // ── E. 망각 패널티 ────────────────────────────────────────────────
  const forgettingPenalty = computeForgettingPenalty(
    practice.mostRecentPracticeAt,
    test.mostRecentTestAt,
    test.testCount,
    now
  );

  // ── F. 오답 패널티 (유사도 80% 이상이면 대폭 완화) ───────────────
  // 유사도 80%+ 오답은 "거의 맞음" → 패널티 10%만 적용
  // 유사도 60~80%: 패널티 40%
  // 유사도 60% 미만 + 정답률 낮음: 패널티 전액
  let wrongPenalty = 0;
  const effectiveWrongCount = test.recentTestHistory
    ? test.recentTestHistory.filter(t => !t.isCorrect && t.similarityScore < 80).length
    : test.wrongCount;
  if (effectiveWrongCount > 0) {
    const basePenalty = Math.min(12 + (effectiveWrongCount - 1) * 10, 40);
    if (effectiveCorrectRate >= 0.8) {
      wrongPenalty = Math.round(basePenalty * 0.15);
    } else if (effectiveCorrectRate >= 0.6) {
      wrongPenalty = Math.round(basePenalty * 0.5);
    } else {
      wrongPenalty = basePenalty;
    }
  }

  // 최근 시험이 유사도 50 미만이면 추가 패널티
  let recentPoorPenalty = 0;
  if (test.mostRecentTestWasPoor) {
    recentPoorPenalty = effectiveCorrectRate >= 0.8 ? 3 : 12;
  }

  // ── G. 최종 점수 ──────────────────────────────────────────────────
  const rawScore = clamp(
    practiceVolumeScore +
    practiceBonus +
    testExposureScore +
    testAccuracyScore +
    timeWeightedStreakScore +
    speedBonus -
    forgettingPenalty -
    wrongPenalty -
    recentPoorPenalty,
    0,
    100
  );

  const practiceOnlyCap = test.testCount === 0 ? 28 : 100;
  const displayScore = Math.min(Math.round(rawScore), practiceOnlyCap);

  let state: "green" | "yellow" | "red";
  if (displayScore >= CONFIDENCE_THRESHOLDS.green) {
    state = "green";
  } else if (displayScore >= CONFIDENCE_THRESHOLDS.yellow) {
    state = "yellow";
  } else {
    state = "red";
  }

  return {
    rawScore,
    displayScore,
    state,
    label: TRAFFIC_LIGHT_LABELS[state],
    isColdStart: false,
    breakdown: {
      practiceVolumeScore,
      practiceBonus,
      testExposureScore,
      testAccuracyScore,
      timeWeightedStreakScore,
      speedBonus,
      forgettingPenalty,
      wrongPenalty,
      recentPoorPenalty,
    },
  };
}

// ─── Exam Date Prediction ─────────────────────────────────────────

export interface ExamDatePrediction {
  predictedScore: number;
  predictedState: "green" | "yellow" | "red";
  predictedLabel: string;
  daysUntilExam: number;
  currentScore: number;
  scoreDelta: number;
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

  const hoursUntilExam = daysUntilExam * 24;
  let forgettingAtExam = 0;

  if (currentResult.isColdStart) {
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
