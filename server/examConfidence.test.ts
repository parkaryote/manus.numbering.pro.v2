import { describe, expect, it } from "vitest";
import {
  computeExamConfidence,
  aggregateConfidence,
  CONFIDENCE_THRESHOLDS,
  type PracticeSignal,
  type TestSignal,
} from "../shared/examConfidence";

function makePractice(overrides: Partial<PracticeSignal> = {}): PracticeSignal {
  return {
    practiceCount: 0,
    totalPracticeDuration: 0,
    mostRecentPracticeAt: null,
    ...overrides,
  };
}

function makeTest(overrides: Partial<TestSignal> = {}): TestSignal {
  return {
    testCount: 0,
    correctCount: 0,
    wrongCount: 0,
    averageSimilarityScore: 0,
    mostRecentTestAt: null,
    recentCorrectStreak: 0,
    mostRecentTestWasPoor: false,
    ...overrides,
  };
}

const now = new Date("2026-04-01T00:00:00Z");

describe("computeExamConfidence", () => {
  it("returns cold-start result when no data", () => {
    const result = computeExamConfidence({
      practice: makePractice(),
      test: makeTest(),
      now,
    });
    expect(result.isColdStart).toBe(true);
    expect(result.state).toBe("red");
    expect(result.displayScore).toBe(35);
  });

  it("returns red state for low scores", () => {
    const result = computeExamConfidence({
      practice: makePractice({ practiceCount: 1, totalPracticeDuration: 30, mostRecentPracticeAt: now }),
      test: makeTest(),
      now,
    });
    expect(result.state).toBe("red");
    expect(result.displayScore).toBeLessThan(CONFIDENCE_THRESHOLDS.yellow);
  });

  it("returns yellow state for medium scores (practice only caps at yellow)", () => {
    const result = computeExamConfidence({
      practice: makePractice({ practiceCount: 5, totalPracticeDuration: 600, mostRecentPracticeAt: now }),
      test: makeTest(),
      now,
    });
    // Practice only should cap at yellow
    expect(result.state).not.toBe("green");
    expect(result.displayScore).toBeLessThanOrEqual(65);
  });

  it("returns green state for high scores with test data", () => {
    const result = computeExamConfidence({
      practice: makePractice({ practiceCount: 5, totalPracticeDuration: 600, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 5,
        correctCount: 5,
        averageSimilarityScore: 95,
        mostRecentTestAt: now,
        recentCorrectStreak: 5,
        averageRecallTime: 8,
      }),
      now,
    });
    expect(result.state).toBe("green");
    expect(result.displayScore).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLDS.green);
  });

  it("applies speed bonus for fast recall", () => {
    const slow = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, totalPracticeDuration: 300, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 3,
        correctCount: 3,
        averageSimilarityScore: 90,
        mostRecentTestAt: now,
        recentCorrectStreak: 3,
        averageRecallTime: 60, // slow - no bonus
      }),
      now,
    });
    const fast = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, totalPracticeDuration: 300, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 3,
        correctCount: 3,
        averageSimilarityScore: 90,
        mostRecentTestAt: now,
        recentCorrectStreak: 3,
        averageRecallTime: 8, // fast - max bonus
      }),
      now,
    });
    expect(fast.displayScore).toBeGreaterThan(slow.displayScore);
    expect(fast.breakdown.speedBonus).toBe(8);
    expect(slow.breakdown.speedBonus).toBe(0);
  });

  it("applies speed bonus tiers correctly", () => {
    const makeWithSpeed = (avgTime: number) =>
      computeExamConfidence({
        practice: makePractice({ practiceCount: 3, totalPracticeDuration: 300, mostRecentPracticeAt: now }),
        test: makeTest({
          testCount: 3,
          correctCount: 3,
          averageSimilarityScore: 90,
          mostRecentTestAt: now,
          recentCorrectStreak: 3,
          averageRecallTime: avgTime,
        }),
        now,
      });

    expect(makeWithSpeed(5).breakdown.speedBonus).toBe(8);   // <= 10s
    expect(makeWithSpeed(15).breakdown.speedBonus).toBe(5);  // <= 20s
    expect(makeWithSpeed(25).breakdown.speedBonus).toBe(3);  // <= 30s
    expect(makeWithSpeed(40).breakdown.speedBonus).toBe(1);  // <= 45s
    expect(makeWithSpeed(60).breakdown.speedBonus).toBe(0);  // > 45s
  });

  it("applies forgetting penalty for old data", () => {
    const recent = computeExamConfidence({
      practice: makePractice({ practiceCount: 5, totalPracticeDuration: 600, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 3,
        correctCount: 3,
        averageSimilarityScore: 90,
        mostRecentTestAt: now,
        recentCorrectStreak: 3,
      }),
      now,
    });
    const old = computeExamConfidence({
      practice: makePractice({
        practiceCount: 5,
        totalPracticeDuration: 600,
        mostRecentPracticeAt: new Date("2026-03-01T00:00:00Z"),
      }),
      test: makeTest({
        testCount: 3,
        correctCount: 3,
        averageSimilarityScore: 90,
        mostRecentTestAt: new Date("2026-03-01T00:00:00Z"),
        recentCorrectStreak: 3,
      }),
      now,
    });
    expect(recent.displayScore).toBeGreaterThan(old.displayScore);
    expect(old.breakdown.forgettingPenalty).toBeGreaterThan(recent.breakdown.forgettingPenalty);
  });

  it("applies wrong answer penalty", () => {
    const noWrong = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, totalPracticeDuration: 300, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 3,
        correctCount: 3,
        wrongCount: 0,
        averageSimilarityScore: 90,
        mostRecentTestAt: now,
        recentCorrectStreak: 3,
      }),
      now,
    });
    const withWrong = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, totalPracticeDuration: 300, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 5,
        correctCount: 3,
        wrongCount: 2,
        averageSimilarityScore: 70,
        mostRecentTestAt: now,
        recentCorrectStreak: 0,
        mostRecentTestWasPoor: true,
      }),
      now,
    });
    expect(noWrong.displayScore).toBeGreaterThan(withWrong.displayScore);
  });
});

describe("aggregateConfidence", () => {
  it("returns red for empty results", () => {
    const result = aggregateConfidence([]);
    expect(result.state).toBe("red");
    expect(result.totalQuestions).toBe(0);
  });

  it("aggregates multiple results correctly", () => {
    const green = computeExamConfidence({
      practice: makePractice({ practiceCount: 5, totalPracticeDuration: 600, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 5,
        correctCount: 5,
        averageSimilarityScore: 95,
        mostRecentTestAt: now,
        recentCorrectStreak: 5,
        averageRecallTime: 8,
      }),
      now,
    });
    const red = computeExamConfidence({
      practice: makePractice({ practiceCount: 1, totalPracticeDuration: 30, mostRecentPracticeAt: now }),
      test: makeTest(),
      now,
    });

    const agg = aggregateConfidence([green, red]);
    expect(agg.totalQuestions).toBe(2);
    expect(agg.greenCount).toBe(1);
    expect(agg.redCount).toBe(1);
    expect(agg.averageScore).toBeGreaterThan(0);
  });
});

describe("CONFIDENCE_THRESHOLDS", () => {
  it("has correct threshold values", () => {
    expect(CONFIDENCE_THRESHOLDS.green).toBe(80);
    expect(CONFIDENCE_THRESHOLDS.yellow).toBe(50);
  });
});
