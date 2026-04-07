/**
 * 시험 안정도 (Exam Confidence) - 24h Crunch Mode Tuned
 *
 * 핵심 의도:
 * 1) 시험이 임박(특히 24h 이내)하면 연습의 즉시 효용을 더 크게 반영
 * 2) 시험 모드에서는 "정오답"을 중심으로, 유사도는 보조 신호로만 사용
 * 3) 짧은 시간 재시도 남발보다 간격을 둔 재확인을 더 높게 평가
 * 4) 임박 구간에서 최근 실패/장시간 공백은 더 강하게 패널티
 */

// ─── Thresholds ─────────────────────────────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  green: 80,
  yellow: 40,
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
  averageRecallTime?: number; // seconds
  testType?: "individual" | "exam";
  recentTestHistory?: Array<{
    completedAt: Date;
    isCorrect: boolean;
    similarityScore: number;
  }>;
}

export interface ConfidenceInput {
  practice: PracticeSignal;
  test: TestSignal;
  now?: Date;
  examDate?: Date | null;
  userProfile?: {
    practiceEffectiveness?: number; // 0.8~1.2
    testReliability?: number; // 0.85~1.15
    recoveryPower?: number; // 0.85~1.15
    pacingDiscipline?: number; // 0.85~1.15
  };
  initialEstimate?: {
    answerLength: number; // 공백 제거 기준 문자 수
    lineCount?: number;
    blankCount?: number; // 표/라벨 등 빈칸 개수
    difficulty?: "easy" | "medium" | "hard" | null;
    hasTable?: boolean;
  };
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
  recentSimilarityBoost: number;
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
  if (!date) return Number.POSITIVE_INFINITY;
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

function getHoursUntilExam(
  examDate: Date | null | undefined,
  now: Date
): number | null {
  if (!examDate) return null;
  return (examDate.getTime() - now.getTime()) / (1000 * 60 * 60);
}

function getUrgencyMultiplier(hoursUntilExam: number | null): number {
  if (hoursUntilExam === null) return 1.0;
  if (hoursUntilExam <= 0) return 0.9;
  if (hoursUntilExam <= 20) return 1.45;
  if (hoursUntilExam <= 36) return 1.32;
  if (hoursUntilExam <= 72) return 1.16;
  return 1.0;
}

function getPracticeOnlyCap(hoursUntilExam: number | null): number {
  if (hoursUntilExam === null) return 35;
  if (hoursUntilExam <= 12) return 68;
  if (hoursUntilExam <= 24) return 62;
  if (hoursUntilExam <= 72) return 50;
  return 35;
}

function estimateColdStartScore(
  hint: ConfidenceInput["initialEstimate"] | undefined,
  hoursUntilExam: number | null
): number {
  if (!hint) return 0;

  const answerLength = Math.max(1, Math.round(hint.answerLength));
  const lineCount = Math.max(1, Math.round(hint.lineCount ?? 1));
  const blankCount = Math.max(0, Math.round(hint.blankCount ?? 0));
  const normalizedLength = clamp(
    Math.log1p(answerLength) / Math.log1p(700),
    0,
    1
  );
  const normalizedLine = clamp((lineCount - 1) / 10, 0, 1);
  const normalizedBlank = clamp(blankCount / 22, 0, 1);
  const tableComplexity = hint.hasTable ? 1 : 0;

  // 문제 특성으로 "첫 회독 즉시 회상 가능성"을 추정한다.
  // 이전보다 분산을 넓혀 초기 안정도(콜드스타트)가 11~16에 뭉치지 않게 조정.
  let complexityIndex =
    normalizedLength * 0.48 +
    normalizedLine * 0.2 +
    normalizedBlank * 0.22 +
    tableComplexity * 0.1;

  if (hint.difficulty === "easy") complexityIndex -= 0.18;
  else if (hint.difficulty === "hard") complexityIndex += 0.2;

  complexityIndex = clamp(complexityIndex, 0.02, 1);

  const oneLookRecallProb = clamp(0.9 - complexityIndex * 0.95, 0.04, 0.88);
  let score = Math.round(
    3 + Math.pow(oneLookRecallProb, 1.1) * 42 - complexityIndex * 10
  );

  if (hoursUntilExam !== null && hoursUntilExam <= 24) score += 3;
  else if (hoursUntilExam !== null && hoursUntilExam <= 72) score += 2;

  return clamp(score, 0, 45);
}

function getPracticeRecencyBonus(
  hoursSincePractice: number,
  hoursUntilExam: number | null
): number {
  if (!Number.isFinite(hoursSincePractice)) return 0;

  let bonus = 0;
  if (hoursSincePractice <= 1) bonus = 6;
  else if (hoursSincePractice <= 3) bonus = 5;
  else if (hoursSincePractice <= 8) bonus = 3;
  else if (hoursSincePractice <= 18) bonus = 1;
  else if (hoursSincePractice <= 30) bonus = 0;
  else bonus = -1;

  if (hoursUntilExam !== null && hoursUntilExam <= 24) {
    if (hoursSincePractice <= 6) bonus += 2;
    else if (hoursSincePractice > 18) bonus -= 1;
  }

  return bonus;
}

function getPracticeDensityAdjustment(perPracticeSeconds: number): number {
  if (perPracticeSeconds <= 0) return 0;
  // 계단식 점프를 줄이기 위해 연속 곡선으로 계산한다.
  // 약 18초 이하는 페널티, 50초 이상은 최대 보너스.
  return clamp((perPracticeSeconds - 18) / 16, -1, 2);
}

function getPracticeProgressGainBounds(input: {
  previousScore: number;
  practiceCount: number;
  hoursUntilExam: number | null;
  previousWasColdStart: boolean;
}): { minGain: number; maxGain: number } {
  const { previousScore, practiceCount, hoursUntilExam, previousWasColdStart } =
    input;

  if (previousWasColdStart) {
    // 0점 콜드스타트는 본래 상승폭을 유지한다.
    return { minGain: 1, maxGain: 100 };
  }

  let minGain = 1;
  let maxGain = 4;

  if (previousScore < 60) {
    minGain = practiceCount <= 2 ? 3 : 2;
    maxGain = 4;
  } else if (previousScore < CONFIDENCE_THRESHOLDS.green) {
    minGain = 1;
    maxGain = 3;
  } else {
    minGain = 1;
    maxGain = 2;
  }

  if (hoursUntilExam !== null && hoursUntilExam <= 24 && previousScore < 45) {
    minGain += 1;
    maxGain += 1;
  }

  if (practiceCount >= 10) {
    const highVolumeMax = previousScore < 60 ? 3 : 2;
    maxGain = Math.max(minGain, Math.min(maxGain, highVolumeMax));
  }

  if (practiceCount >= 20) {
    minGain = Math.max(1, minGain - 1);
  }

  minGain = clamp(Math.round(minGain), 1, 6);
  maxGain = clamp(Math.round(Math.max(minGain, maxGain)), minGain, 8);
  return { minGain, maxGain };
}

function getSpacingWeight(
  gapHours: number,
  hoursUntilExam: number | null
): number {
  // 20h 내외 재확인을 가장 높게 평가 (현 요청 스케줄 최적화)
  if (gapHours < 0.25) return 0.2;
  if (gapHours < 1) return 0.45;
  if (gapHours < 3) return 0.75;
  if (gapHours < 8) return 1.0;
  if (gapHours < 20) return 1.25;
  if (gapHours < 36) return 1.1;

  // 시험이 많이 남지 않았다면 너무 긴 간격은 의미를 줄임
  if (hoursUntilExam !== null && hoursUntilExam <= 48) return 0.85;
  return 0.95;
}

function computeTimeWeightedStreakScore(
  history: Array<{
    completedAt: Date;
    isCorrect: boolean;
    similarityScore: number;
  }>,
  now: Date,
  hoursUntilExam: number | null
): number {
  if (history.length === 0) return 0;

  let total = 0;
  let previous = now;

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    const passed = item.isCorrect || item.similarityScore >= 88;
    if (!passed) break;

    const gap =
      i === 0
        ? hoursSince(item.completedAt, now)
        : (previous.getTime() - item.completedAt.getTime()) / (1000 * 60 * 60);
    const spacingWeight = getSpacingWeight(gap, hoursUntilExam);
    const base = i === 0 ? 14 : i === 1 ? 11 : i === 2 ? 8 : 6;

    total += base * spacingWeight;
    previous = item.completedAt;
  }

  return clamp(Math.round(total), 0, 38);
}

function computeWeightedMastery(
  history: Array<{
    completedAt: Date;
    isCorrect: boolean;
    similarityScore: number;
  }>,
  now: Date,
  fallback: Pick<
    TestSignal,
    "testCount" | "correctCount" | "averageSimilarityScore"
  >
): number {
  if (history.length === 0) {
    if (fallback.testCount <= 0) return 0;
    const baseAccuracy = fallback.correctCount / fallback.testCount;
    const similarityAnchor = clamp(
      (fallback.averageSimilarityScore - 60) / 40,
      0,
      1
    );
    // 시험 안정도는 정확도보다 유사도를 더 강하게 반영
    return clamp(baseAccuracy * 0.35 + similarityAnchor * 0.65, 0, 1);
  }

  let weightedScore = 0;
  let totalWeight = 0;

  for (const item of history.slice(0, 10)) {
    const ageHours = hoursSince(item.completedAt, now);
    const recencyWeight = 0.35 + Math.exp(-ageHours / 20);

    const s = clamp(Math.round(item.similarityScore), 0, 100);
    let similarityQuality = 0;
    if (s >= 99) similarityQuality = 1.0;
    else if (s >= 97) similarityQuality = 0.95;
    else if (s >= 95) similarityQuality = 0.9;
    else if (s >= 92) similarityQuality = 0.78;
    else if (s >= 90) similarityQuality = 0.72;
    else if (s >= 85) similarityQuality = 0.62;
    else if (s >= 75) similarityQuality = 0.48;
    else if (s >= 65) similarityQuality = 0.42;
    else if (s >= 50) similarityQuality = 0.28;
    else similarityQuality = 0.12;

    const correctnessBonus = item.isCorrect ? 0.12 : 0;
    const quality = clamp(similarityQuality + correctnessBonus, 0, 1);

    weightedScore += quality * recencyWeight;
    totalWeight += recencyWeight;
  }

  if (totalWeight === 0) return 0;
  return clamp(weightedScore / totalWeight, 0, 1);
}

function computeInactivityPenalty(
  inactivityHours: number,
  hasTests: boolean,
  hoursUntilExam: number | null
): number {
  if (!Number.isFinite(inactivityHours)) return 0;

  if (!hasTests) {
    if (inactivityHours < 24) return 0;
    if (inactivityHours < 72) return 2;
    if (inactivityHours < 168) return 5;
    return 9;
  }

  let penalty = 0;
  if (inactivityHours < 3) penalty = 0;
  else if (inactivityHours < 8) penalty = 2;
  else if (inactivityHours < 16) penalty = 6;
  else if (inactivityHours < 24) penalty = 10;
  else if (inactivityHours < 36) penalty = 14;
  else if (inactivityHours < 48) penalty = 19;
  else penalty = 26;

  if (hoursUntilExam !== null && hoursUntilExam <= 24) {
    if (inactivityHours > 6) penalty += 6;
    if (inactivityHours > 14) penalty += 4;
  } else if (hoursUntilExam !== null && hoursUntilExam <= 72) {
    if (inactivityHours > 20) penalty += 3;
  }

  return clamp(penalty, 0, 42);
}

function computeRecentPassStreak(
  history: Array<{
    completedAt: Date;
    isCorrect: boolean;
    similarityScore: number;
  }>
): number {
  let streak = 0;
  for (const item of history) {
    const passed = item.isCorrect || item.similarityScore >= 88;
    if (!passed) break;
    streak += 1;
  }
  return streak;
}

function getSingleTestDisplayCap(input: {
  latestSimilarity: number;
  latestIsCorrect: boolean;
  practiceCount: number;
  difficulty?: "easy" | "medium" | "hard" | null;
  hoursUntilExam: number | null;
}): number {
  const {
    latestSimilarity,
    latestIsCorrect,
    practiceCount,
    difficulty,
    hoursUntilExam,
  } = input;

  let cap = 78;

  if (latestIsCorrect) {
    if (latestSimilarity >= 100) cap += 10;
    else if (latestSimilarity >= 99) cap += 8;
    else if (latestSimilarity >= 97) cap += 6;
    else if (latestSimilarity >= 95) cap += 4;
    else if (latestSimilarity >= 92) cap += 3;
    else if (latestSimilarity >= 90) cap += 1;
  } else {
    if (latestSimilarity >= 95) cap += 2;
    else if (latestSimilarity >= 90) cap += 1;
    else cap -= 2;
  }

  if (practiceCount >= 3) cap += 2;
  if (practiceCount >= 8) cap += 1;

  if (difficulty === "hard") cap += 2;
  else if (difficulty === "easy") cap -= 1;

  if (hoursUntilExam !== null && hoursUntilExam <= 24) cap += 1;

  if (!latestIsCorrect) {
    return clamp(cap, 68, 88);
  }

  return clamp(cap, 80, 94);
}

// ─── Main Scoring ──────────────────────────────────────────────────

export function computeExamConfidence(
  input: ConfidenceInput
): ConfidenceResult {
  return computeExamConfidenceInternal(input, true);
}

function computeExamConfidenceInternal(
  input: ConfidenceInput,
  applyPracticeProgressGuard: boolean
): ConfidenceResult {
  const now = input.now ?? new Date();
  const { practice, test } = input;
  const hoursUntilExam = getHoursUntilExam(input.examDate, now);
  const questionDifficulty = input.initialEstimate?.difficulty ?? null;

  const hasAnyData = practice.practiceCount > 0 || test.testCount > 0;
  if (!hasAnyData) {
    const initialScore = estimateColdStartScore(
      input.initialEstimate,
      hoursUntilExam
    );
    const state =
      initialScore >= CONFIDENCE_THRESHOLDS.green
        ? "green"
        : initialScore >= CONFIDENCE_THRESHOLDS.yellow
          ? "yellow"
          : "red";

    return {
      rawScore: initialScore,
      displayScore: initialScore,
      state,
      label: TRAFFIC_LIGHT_LABELS[state],
      isColdStart: true,
      breakdown: {
        practiceVolumeScore: 0,
        practiceBonus: 0,
        testExposureScore: 0,
        testAccuracyScore: 0,
        recentSimilarityBoost: 0,
        timeWeightedStreakScore: 0,
        speedBonus: 0,
        forgettingPenalty: 0,
        wrongPenalty: 0,
        recentPoorPenalty: 0,
      },
    };
  }

  const urgencyMultiplier = getUrgencyMultiplier(hoursUntilExam);

  const sortedHistory = (test.recentTestHistory ?? [])
    .slice()
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

  // A. Practice contribution
  const practiceVolumeBase =
    22 * (1 - Math.exp(-practice.practiceCount * 0.32));
  const practiceVolumeScore = clamp(
    Math.round(practiceVolumeBase * urgencyMultiplier),
    0,
    38
  );

  const durationSignal =
    10 * (1 - Math.exp(-practice.totalPracticeDuration / 420));
  const perPracticeSeconds =
    practice.practiceCount > 0
      ? practice.totalPracticeDuration / practice.practiceCount
      : 0;
  const densityAdjustment = getPracticeDensityAdjustment(perPracticeSeconds);
  const recencyPracticeBonus =
    practice.practiceCount > 0
      ? getPracticeRecencyBonus(
          hoursSince(practice.mostRecentPracticeAt, now),
          hoursUntilExam
        )
      : 0;
  const practiceBonus = clamp(
    Math.round(durationSignal + densityAdjustment + recencyPracticeBonus),
    0,
    18
  );

  // B. Test contribution (유사도 중심, 정오답은 보정 신호)
  const masteryRate = computeWeightedMastery(sortedHistory, now, {
    testCount: test.testCount,
    correctCount: test.correctCount,
    averageSimilarityScore: test.averageSimilarityScore,
  });

  const testExposureScore =
    test.testCount > 0
      ? clamp(Math.round(14 * (1 - Math.exp(-test.testCount * 0.6))), 0, 14)
      : 0;
  const testAccuracyScore =
    test.testCount > 0 ? clamp(Math.round(masteryRate * 40), 0, 40) : 0;

  // 최신 시험의 고유사도를 강하게 반영 (특히 95~100)
  let recentSimilarityBoost = 0;
  const latestTest = sortedHistory[0];
  if (latestTest) {
    const sim = clamp(Math.round(latestTest.similarityScore), 0, 100);
    const ageHours = hoursSince(latestTest.completedAt, now);
    const freshness =
      ageHours <= 1
        ? 1
        : ageHours <= 3
          ? 0.95
          : ageHours <= 6
            ? 0.9
            : ageHours <= 12
              ? 0.85
              : ageHours <= 24
                ? 0.8
                : ageHours <= 48
                  ? 0.65
                  : 0.45;

    let baseBoost = 0;
    if (sim >= 99) baseBoost = 18;
    else if (sim >= 97) baseBoost = 14;
    else if (sim >= 95) baseBoost = 10;
    else if (sim >= 92) baseBoost = 6;
    else if (sim >= 90) baseBoost = 4;
    else if (sim >= 85) baseBoost = 2;
    else if (sim >= 75) baseBoost = 1;
    else if (sim < 60) baseBoost = -5;
    else if (sim < 70) baseBoost = -2;

    if (latestTest.isCorrect) baseBoost += 3;
    else if (sim < 95) baseBoost -= 2;
    if (hoursUntilExam !== null && hoursUntilExam <= 24 && sim >= 90)
      baseBoost += 2;

    recentSimilarityBoost = clamp(Math.round(baseBoost * freshness), -8, 20);
  }

  let timeWeightedStreakScore = 0;
  if (sortedHistory.length > 0) {
    timeWeightedStreakScore = computeTimeWeightedStreakScore(
      sortedHistory,
      now,
      hoursUntilExam
    );
  } else if (test.recentCorrectStreak > 0) {
    const s = Math.min(test.recentCorrectStreak, 4);
    const fallback = [0, 8, 14, 20, 25][s];
    timeWeightedStreakScore = Math.round(
      fallback * (hoursUntilExam !== null && hoursUntilExam <= 24 ? 1.1 : 1)
    );
  }

  // C. Recall speed bonus
  let speedBonus = 0;
  if (test.testCount > 0 && test.averageRecallTime !== undefined) {
    const t = test.averageRecallTime;
    let base = 0;
    if (t <= 8) base = 8;
    else if (t <= 15) base = 6;
    else if (t <= 25) base = 4;
    else if (t <= 40) base = 2;

    const modeMultiplier = test.testType === "exam" ? 0.75 : 1;
    speedBonus = Math.round(base * modeMultiplier);
  }

  // D. Penalties
  const recentCandidates = [
    practice.mostRecentPracticeAt,
    test.mostRecentTestAt,
  ].filter(Boolean) as Date[];
  const inactivityHours =
    recentCandidates.length > 0
      ? hoursSince(
          new Date(Math.max(...recentCandidates.map(d => d.getTime()))),
          now
        )
      : Number.POSITIVE_INFINITY;

  const difficultyForgettingMultiplier =
    questionDifficulty === "hard"
      ? 1.18
      : questionDifficulty === "easy"
        ? 0.86
        : 1.0;
  const forgettingPenaltyBase = computeInactivityPenalty(
    inactivityHours,
    test.testCount > 0,
    hoursUntilExam
  );
  const forgettingPenalty = clamp(
    Math.round(forgettingPenaltyBase * difficultyForgettingMultiplier),
    0,
    42
  );

  let wrongPenalty = 0;
  if (test.testCount > 0) {
    if (sortedHistory.length > 0) {
      let penaltyAccumulator = 0;
      for (const item of sortedHistory.slice(0, 6)) {
        if (item.isCorrect) continue;

        const age = hoursSince(item.completedAt, now);
        const ageWeight =
          age <= 6 ? 1.2 : age <= 20 ? 1.0 : age <= 48 ? 0.75 : 0.45;
        const severity =
          item.similarityScore >= 98
            ? 0.03
            : item.similarityScore >= 95
              ? 0.08
              : item.similarityScore >= 90
                ? 0.15
                : item.similarityScore >= 85
                  ? 0.25
                  : item.similarityScore >= 70
                    ? 0.55
                    : item.similarityScore >= 50
                      ? 0.9
                      : 1.15;
        penaltyAccumulator += 7 * ageWeight * severity;
      }

      if (masteryRate >= 0.8) penaltyAccumulator *= 0.65;
      else if (masteryRate >= 0.65) penaltyAccumulator *= 0.8;

      wrongPenalty = clamp(Math.round(penaltyAccumulator), 0, 32);
    } else {
      wrongPenalty = clamp(
        Math.round(test.wrongCount * 7 * (1 - masteryRate * 0.4)),
        0,
        32
      );
    }
  }

  let recentPoorPenalty = 0;
  const latest = sortedHistory[0];
  if (latest && !latest.isCorrect) {
    if (latest.similarityScore >= 97) {
      recentPoorPenalty = 0;
    } else if (latest.similarityScore >= 93) {
      recentPoorPenalty =
        hoursUntilExam !== null && hoursUntilExam <= 24 ? 1 : 0;
    } else if (latest.similarityScore >= 85) {
      recentPoorPenalty =
        hoursUntilExam !== null && hoursUntilExam <= 24 ? 2 : 1;
    } else if (latest.similarityScore >= 70) {
      recentPoorPenalty =
        hoursUntilExam !== null && hoursUntilExam <= 24 ? 4 : 2;
    } else if (latest.similarityScore < 50 || test.mostRecentTestWasPoor) {
      recentPoorPenalty =
        hoursUntilExam !== null && hoursUntilExam <= 24 ? 12 : 8;
    } else {
      recentPoorPenalty =
        hoursUntilExam !== null && hoursUntilExam <= 24 ? 7 : 4;
    }
  } else if (test.mostRecentTestWasPoor) {
    recentPoorPenalty =
      hoursUntilExam !== null && hoursUntilExam <= 24 ? 10 : 7;
  }

  let rawScore = clamp(
    practiceVolumeScore +
      practiceBonus +
      testExposureScore +
      testAccuracyScore +
      recentSimilarityBoost +
      timeWeightedStreakScore +
      speedBonus -
      forgettingPenalty -
      wrongPenalty -
      recentPoorPenalty,
    0,
    100
  );

  // E. Adaptive personalization (사용자별 신호 융합)
  // - practice/test/penalty의 기여도를 사용자 학습 패턴에 맞춰 미세 조정
  // - 데이터가 충분할 때만 점진적으로 적용
  const profile = input.userProfile;
  if (profile) {
    const evidence = clamp(
      (practice.practiceCount + test.testCount * 1.5) / 24,
      0,
      1
    );

    const practiceEffectiveness = clamp(
      profile.practiceEffectiveness ?? 1,
      0.8,
      1.2
    );
    const testReliability = clamp(profile.testReliability ?? 1, 0.85, 1.15);
    const recoveryPower = clamp(profile.recoveryPower ?? 1, 0.85, 1.15);
    const pacingDiscipline = clamp(profile.pacingDiscipline ?? 1, 0.85, 1.15);

    const appliedPracticeFactor = 1 + (practiceEffectiveness - 1) * evidence;
    const appliedTestFactor = 1 + (testReliability - 1) * evidence;
    const appliedRecoveryFactor = 1 + (recoveryPower - 1) * evidence;
    const appliedPacingFactor = 1 + (pacingDiscipline - 1) * evidence;

    const practiceTermBase = practiceVolumeScore + practiceBonus;
    const testTermBase =
      testExposureScore +
      testAccuracyScore +
      recentSimilarityBoost +
      timeWeightedStreakScore +
      speedBonus;
    const penaltyTermBase =
      forgettingPenalty + wrongPenalty + recentPoorPenalty;

    const practiceTerm = practiceTermBase * appliedPracticeFactor;
    const testTerm = testTermBase * appliedTestFactor;

    // recovery/pacing이 좋은 사용자는 동일 실수에서도 패널티를 조금 덜 받는다.
    const penaltyScaleRaw =
      1 - (appliedRecoveryFactor - 1) * 0.3 - (appliedPacingFactor - 1) * 0.22;
    const penaltyScale = clamp(penaltyScaleRaw, 0.82, 1.2);
    const penaltyTerm = penaltyTermBase * penaltyScale;

    rawScore = clamp(Math.round(practiceTerm + testTerm - penaltyTerm), 0, 100);
  }

  // F. Cold-start anchored practice floor
  // 테스트 기록이 없고 초기 추정치가 있는 문제는
  // 첫 연습에서 체감 가능한 상승이 보이도록 기준점을 유지한다.
  if (
    test.testCount === 0 &&
    practice.practiceCount > 0 &&
    input.initialEstimate
  ) {
    const coldStartBaseline = estimateColdStartScore(
      input.initialEstimate,
      hoursUntilExam
    );
    const progressiveGain = Math.max(
      2,
      Math.round(1 + Math.log2(practice.practiceCount + 1) * 2.2)
    );
    const urgencyLift = hoursUntilExam !== null && hoursUntilExam <= 24 ? 1 : 0;
    const coldStartFloor = clamp(
      coldStartBaseline + progressiveGain + urgencyLift,
      0,
      100
    );
    rawScore = Math.max(rawScore, coldStartFloor);
  }

  let displayCap = 100;
  if (test.testCount === 0) {
    displayCap = getPracticeOnlyCap(hoursUntilExam);
  } else {
    const hoursSinceLastTest = hoursSince(test.mostRecentTestAt, now);
    if (
      hoursUntilExam !== null &&
      hoursUntilExam <= 24 &&
      hoursSinceLastTest > 12
    ) {
      displayCap = Math.min(displayCap, 78);
    }
    if (test.testCount === 1 && sortedHistory.length > 0) {
      const firstTest = sortedHistory[0];
      const dynamicSingleTestCap = getSingleTestDisplayCap({
        latestSimilarity: clamp(Math.round(firstTest.similarityScore), 0, 100),
        latestIsCorrect: !!firstTest.isCorrect,
        practiceCount: practice.practiceCount,
        difficulty: questionDifficulty,
        hoursUntilExam,
      });
      displayCap = Math.min(displayCap, dynamicSingleTestCap);
    }
  }

  let displayScore = Math.min(Math.round(rawScore), displayCap);

  // 최신 시험이 완전 정답(100%)이 아니면 100점에 도달하지 않도록 제한한다.
  // 99%는 매우 높은 점수로 인정하되, "완전 암기" 100점은 더 엄격히 부여.
  if (displayScore >= 100 && sortedHistory.length > 0) {
    const latestTest = sortedHistory[0];
    const latestSimilarity = clamp(
      Math.round(latestTest.similarityScore),
      0,
      100
    );
    if (!latestTest.isCorrect || latestSimilarity < 100) {
      displayScore = 99;
    }
  }

  // 연습 완주 직후(최근 3시간) 80점 미만 구간에서는
  // 같은 신호에서 practice 1회 적은 상태와 비교해 증가폭을 안정화한다.
  if (
    applyPracticeProgressGuard &&
    practice.practiceCount > 0 &&
    displayScore < CONFIDENCE_THRESHOLDS.green &&
    hoursSince(practice.mostRecentPracticeAt, now) <= 3
  ) {
    const avgPracticeDuration =
      practice.totalPracticeDuration / practice.practiceCount;
    const prevPractice: PracticeSignal = {
      practiceCount: Math.max(0, practice.practiceCount - 1),
      totalPracticeDuration: Math.max(
        0,
        practice.totalPracticeDuration - avgPracticeDuration
      ),
      mostRecentPracticeAt: practice.mostRecentPracticeAt,
    };

    const prevResult = computeExamConfidenceInternal(
      { ...input, practice: prevPractice, now },
      true
    );

    const currentGain = displayScore - prevResult.displayScore;
    const { minGain, maxGain } = getPracticeProgressGainBounds({
      previousScore: prevResult.displayScore,
      practiceCount: practice.practiceCount,
      hoursUntilExam,
      previousWasColdStart: prevResult.isColdStart,
    });
    const boundedGain = clamp(currentGain, minGain, maxGain);
    const guardedScore = Math.min(
      displayCap,
      prevResult.displayScore + boundedGain
    );

    if (displayScore !== guardedScore) {
      displayScore = guardedScore;
      rawScore = Math.max(rawScore, guardedScore);
    }
  }

  // 시험 증가폭 가드:
  // - 시간 텀이 매우 짧은 반복 시험은 증가폭을 강하게 제한
  // - 충분한 간격 후에도 정답이면 더 큰 증가를 허용
  if (
    applyPracticeProgressGuard &&
    sortedHistory.length > 1 &&
    test.testCount > 1
  ) {
    const latestTest = sortedHistory[0];
    const previousTest = sortedHistory[1];
    const latestSimilarity = clamp(
      Math.round(latestTest.similarityScore),
      0,
      100
    );
    const latestPassed = !!latestTest.isCorrect || latestSimilarity >= 88;
    const gapHours = Math.max(
      0,
      (latestTest.completedAt.getTime() - previousTest.completedAt.getTime()) /
        (1000 * 60 * 60)
    );

    const remainingHistory = sortedHistory.slice(1);
    const prevTestCount = Math.max(0, test.testCount - 1);
    const prevCorrectCount = Math.max(
      0,
      test.correctCount - (latestTest.isCorrect ? 1 : 0)
    );
    const prevWrongCount = Math.max(
      0,
      test.wrongCount - (latestTest.isCorrect ? 0 : 1)
    );
    const prevAverageSimilarity =
      remainingHistory.length > 0
        ? remainingHistory.reduce(
            (sum, item) => sum + item.similarityScore,
            0
          ) / remainingHistory.length
        : 0;
    const prevMostRecent = remainingHistory[0]?.completedAt ?? null;

    const previousResult = computeExamConfidenceInternal(
      {
        ...input,
        test: {
          ...test,
          testCount: prevTestCount,
          correctCount: prevCorrectCount,
          wrongCount: prevWrongCount,
          averageSimilarityScore: prevAverageSimilarity,
          mostRecentTestAt: prevMostRecent,
          recentCorrectStreak: computeRecentPassStreak(remainingHistory),
          mostRecentTestWasPoor: remainingHistory[0]
            ? (remainingHistory[0].similarityScore ?? 0) < 50
            : false,
          recentTestHistory: remainingHistory,
        },
      },
      false
    );

    const currentGain = displayScore - previousResult.displayScore;
    if (currentGain > 0) {
      let maxGain = 12;
      if (gapHours < 0.1) maxGain = 1;
      else if (gapHours < 0.5) maxGain = 2;
      else if (gapHours < 2) maxGain = 3;
      else if (gapHours < 8) maxGain = 5;
      else if (gapHours < 20) maxGain = 8;

      if (questionDifficulty === "hard" && gapHours >= 12) maxGain += 1;
      if (questionDifficulty === "easy" && gapHours < 2) {
        maxGain = Math.min(maxGain, 2);
      }

      let minGain = 0;
      if (latestPassed && latestSimilarity >= 95 && gapHours >= 20) {
        minGain = questionDifficulty === "hard" ? 3 : 2;
      } else if (latestPassed && latestSimilarity >= 95 && gapHours >= 8) {
        minGain = 1;
      }

      maxGain = clamp(Math.round(maxGain), 1, 14);
      minGain = clamp(Math.round(minGain), 0, maxGain);
      const boundedGain = clamp(currentGain, minGain, maxGain);
      const guardedScore = Math.min(
        displayCap,
        previousResult.displayScore + boundedGain
      );

      if (guardedScore !== displayScore) {
        displayScore = guardedScore;
        rawScore = Math.max(rawScore, guardedScore);
      }
    }
  }

  let state: "green" | "yellow" | "red";
  if (displayScore >= CONFIDENCE_THRESHOLDS.green) state = "green";
  else if (displayScore >= CONFIDENCE_THRESHOLDS.yellow) state = "yellow";
  else state = "red";

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
      recentSimilarityBoost,
      timeWeightedStreakScore,
      speedBonus,
      forgettingPenalty,
      wrongPenalty,
      recentPoorPenalty,
    },
  };
}

// ─── Exam Date Prediction ──────────────────────────────────────────

export interface ExamDatePrediction {
  predictedScore: number;
  predictedState: "green" | "yellow" | "red";
  predictedLabel: string;
  daysUntilExam: number;
  hoursUntilExam: number;
  minutesUntilExam: number;
  examAtISO: string;
  currentScore: number;
  scoreDelta: number;
  canReachGreen: boolean;
}

export interface ExamPredictionLengthContext {
  questionLength?: number | null;
  minQuestionLength?: number | null;
  maxQuestionLength?: number | null;
  /**
   * 시험기간 판정 시간(기본 72시간)
   */
  examPeriodHours?: number;
}

function getExamPeriodLengthBasedDecay(
  hoursUntilExam: number,
  context?: ExamPredictionLengthContext
): number | null {
  if (!context) return null;
  if (hoursUntilExam < 0) return null;

  const examPeriodHours = context.examPeriodHours ?? 72;
  if (hoursUntilExam > examPeriodHours) return null;

  const questionLength = Math.max(1, Math.round(context.questionLength ?? 0));
  const minQuestionLength = Math.max(
    1,
    Math.round(context.minQuestionLength ?? questionLength)
  );
  const maxQuestionLength = Math.max(
    minQuestionLength,
    Math.round(context.maxQuestionLength ?? questionLength)
  );

  if (maxQuestionLength === minQuestionLength) {
    return 7;
  }

  const lengthRatio = clamp(
    (questionLength - minQuestionLength) /
      (maxQuestionLength - minQuestionLength),
    0,
    1
  );

  // 시험기간 하드코딩 감쇠:
  // 최단 문제 -5점, 최장 문제 -10점
  return Math.round(5 + lengthRatio * 5);
}

export function predictExamDayConfidence(
  currentResult: ConfidenceResult,
  examDate: Date,
  now?: Date,
  lengthContext?: ExamPredictionLengthContext
): ExamDatePrediction {
  const nowDate = now ?? new Date();
  const rawMinutesUntilExam = Math.max(
    0,
    Math.round((examDate.getTime() - nowDate.getTime()) / (1000 * 60))
  );
  const hoursUntilExam = Math.max(0, rawMinutesUntilExam / 60);
  const daysUntilExam = Math.max(0, Math.round(hoursUntilExam / 24));
  const currentScore = currentResult.displayScore;

  let projectedDecay = 0;
  if (currentResult.isColdStart) projectedDecay = 0;
  else if (hoursUntilExam < 6) projectedDecay = 0;
  else if (hoursUntilExam < 20) projectedDecay = 4;
  else if (hoursUntilExam < 36) projectedDecay = 8;
  else if (hoursUntilExam < 72) projectedDecay = 14;
  else if (hoursUntilExam < 168) projectedDecay = 22;
  else projectedDecay = 30;

  if (currentResult.breakdown.testAccuracyScore >= 24) {
    projectedDecay = Math.round(projectedDecay * 0.7);
  }
  if (currentResult.breakdown.timeWeightedStreakScore >= 20) {
    projectedDecay = Math.round(projectedDecay * 0.85);
  }
  if (currentResult.breakdown.forgettingPenalty >= 12) {
    projectedDecay = Math.max(
      projectedDecay,
      currentResult.breakdown.forgettingPenalty
    );
  }

  const lengthBasedDecay = getExamPeriodLengthBasedDecay(
    hoursUntilExam,
    lengthContext
  );
  if (lengthBasedDecay !== null) {
    projectedDecay = lengthBasedDecay;
  }

  const predictedScore = clamp(currentScore - projectedDecay, 0, 100);
  const scoreDelta = predictedScore - currentScore;

  let predictedState: "green" | "yellow" | "red";
  if (predictedScore >= CONFIDENCE_THRESHOLDS.green) predictedState = "green";
  else if (predictedScore >= CONFIDENCE_THRESHOLDS.yellow)
    predictedState = "yellow";
  else predictedState = "red";

  return {
    predictedScore,
    predictedState,
    predictedLabel: TRAFFIC_LIGHT_LABELS[predictedState],
    daysUntilExam,
    hoursUntilExam: Math.round(hoursUntilExam * 10) / 10,
    minutesUntilExam: rawMinutesUntilExam,
    examAtISO: examDate.toISOString(),
    currentScore,
    scoreDelta,
    canReachGreen: predictedScore >= CONFIDENCE_THRESHOLDS.green,
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

  const total = results.reduce((sum, r) => sum + r.displayScore, 0);
  const averageScore = Math.round(total / results.length);

  const greenCount = results.filter(r => r.state === "green").length;
  const yellowCount = results.filter(r => r.state === "yellow").length;
  const redCount = results.filter(r => r.state === "red").length;

  let state: "green" | "yellow" | "red";
  if (averageScore >= CONFIDENCE_THRESHOLDS.green) state = "green";
  else if (averageScore >= CONFIDENCE_THRESHOLDS.yellow) state = "yellow";
  else state = "red";

  return {
    averageScore,
    state,
    label: TRAFFIC_LIGHT_LABELS[state],
    totalQuestions: results.length,
    greenCount,
    yellowCount,
    redCount,
  };
}

// ─── Lightweight UI Estimates (fallback/animation) ────────────────

export interface PracticeDeltaEstimateInput {
  currentScore: number;
  sessionPracticeCount?: number;
  totalPracticeCount?: number;
  hoursUntilExam?: number | null;
}

export function estimatePracticeConfidenceDelta(
  input: PracticeDeltaEstimateInput
): number {
  const currentScore = clamp(Math.round(input.currentScore), 0, 100);
  const sessionPracticeCount = Math.max(0, input.sessionPracticeCount ?? 0);
  const totalPracticeCount = Math.max(
    0,
    input.totalPracticeCount ?? sessionPracticeCount
  );
  const hoursUntilExam = input.hoursUntilExam ?? null;

  let base = 0;
  if (currentScore < 20) base = 8;
  else if (currentScore < 40) base = 6;
  else if (currentScore < 60) base = 4;
  else if (currentScore < 80) base = 3;
  else base = 2;

  const urgencyBoost =
    hoursUntilExam !== null
      ? hoursUntilExam <= 24
        ? 2
        : hoursUntilExam <= 72
          ? 1
          : 0
      : 0;

  const sessionFatigue = Math.min(3, Math.floor(sessionPracticeCount / 4));
  const totalFatigue = Math.min(2, Math.floor(totalPracticeCount / 30));

  return clamp(base + urgencyBoost - sessionFatigue - totalFatigue, 1, 10);
}

export interface TestDeltaEstimateInput {
  currentScore: number;
  isCorrect: boolean;
  similarityScore: number;
  recallTime: number;
  hoursUntilExam?: number | null;
}

export function estimateTestConfidenceDelta(
  input: TestDeltaEstimateInput
): number {
  const currentScore = clamp(Math.round(input.currentScore), 0, 100);
  const similarityScore = clamp(Math.round(input.similarityScore), 0, 100);
  const recallTime = Math.max(0, input.recallTime);
  const hoursUntilExam = input.hoursUntilExam ?? null;

  if (input.isCorrect) {
    let gain =
      similarityScore >= 95
        ? 9
        : similarityScore >= 85
          ? 8
          : similarityScore >= 70
            ? 7
            : 6;

    if (recallTime > 0) {
      if (recallTime <= 10) gain += 2;
      else if (recallTime <= 25) gain += 1;
      else if (recallTime >= 60) gain -= 1;
    }

    if (hoursUntilExam !== null && hoursUntilExam <= 24) gain += 1;
    if (currentScore >= 75) gain -= 2;
    if (currentScore >= 88) gain -= 1;

    // 최신 시험이 100%가 아니면 fallback 추정치도 100점 도달을 만들지 않는다.
    if (similarityScore < 100) {
      gain = Math.min(gain, Math.max(0, 99 - currentScore));
    }

    return clamp(gain, 0, 12);
  }

  let loss =
    similarityScore >= 85
      ? 3
      : similarityScore >= 70
        ? 6
        : similarityScore >= 50
          ? 9
          : 12;

  if (hoursUntilExam !== null && hoursUntilExam <= 24) loss += 2;
  if (currentScore < 30 && similarityScore >= 70) loss -= 1;

  return -clamp(loss, 2, 14);
}
