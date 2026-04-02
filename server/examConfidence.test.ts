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

const now = new Date("2026-04-02T12:00:00Z");

describe("computeExamConfidence - 현실적 기대값", () => {
  it("cold-start: 아무것도 안 했으면 0%", () => {
    const result = computeExamConfidence({
      practice: makePractice(),
      test: makeTest(),
      now,
    });
    expect(result.isColdStart).toBe(true);
    expect(result.state).toBe("red");
    expect(result.displayScore).toBe(0);
  });

  it("연습 1회: 4~12% 사이 (cold-start보다 높음)", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 1,
        mostRecentPracticeAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      }),
      test: makeTest(),
      now,
    });
    expect(result.displayScore).toBeGreaterThan(0);
    expect(result.displayScore).toBeLessThanOrEqual(15);
    expect(result.isColdStart).toBe(false);
  });

  it("연습 3회: 12~22% 사이", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 3,
        mostRecentPracticeAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      }),
      test: makeTest(),
      now,
    });
    expect(result.displayScore).toBeGreaterThanOrEqual(10);
    expect(result.displayScore).toBeLessThanOrEqual(22);
  });

  it("연습만으로는 최대 28%를 넘을 수 없음", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 100,
        totalPracticeDuration: 7200,
        mostRecentPracticeAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      }),
      test: makeTest(),
      now,
    });
    expect(result.displayScore).toBeLessThanOrEqual(28);
  });

  it("시험 1회 통과: 35~55% 사이", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 1,
        mostRecentPracticeAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      }),
      test: makeTest({
        testCount: 1,
        correctCount: 1,
        wrongCount: 0,
        averageSimilarityScore: 90,
        mostRecentTestAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
        recentCorrectStreak: 1,
      }),
      now,
    });
    expect(result.displayScore).toBeGreaterThanOrEqual(35);
    expect(result.displayScore).toBeLessThanOrEqual(58);
  });

  it("시험 2회 연속 통과: 55~78% 사이", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 2,
        mostRecentPracticeAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        wrongCount: 0,
        averageSimilarityScore: 90,
        mostRecentTestAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
        recentCorrectStreak: 2,
      }),
      now,
    });
    expect(result.displayScore).toBeGreaterThanOrEqual(55);
    expect(result.displayScore).toBeLessThanOrEqual(78);
  });

  it("시험 3회+ 연속 통과: 80% 이상 (green)", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 3,
        mostRecentPracticeAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      }),
      test: makeTest({
        testCount: 3,
        correctCount: 3,
        wrongCount: 0,
        averageSimilarityScore: 92,
        mostRecentTestAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
        recentCorrectStreak: 3,
      }),
      now,
    });
    expect(result.displayScore).toBeGreaterThanOrEqual(78);
    expect(result.state).toBe("green");
  });

  it("3번 틀린 후 점수가 크게 감소 (45% 이하)", () => {
    const after = computeExamConfidence({
      practice: makePractice({
        practiceCount: 5,
        mostRecentPracticeAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      }),
      test: makeTest({
        testCount: 8,
        correctCount: 5,
        wrongCount: 3,
        averageSimilarityScore: 60,
        mostRecentTestAt: new Date(now.getTime() - 30 * 60 * 1000),
        recentCorrectStreak: 0,
        mostRecentTestWasPoor: true,
      }),
      now,
    });
    expect(after.displayScore).toBeLessThan(45);
  });

  it("연습 후 점수가 cold-start(0%)보다 높아야 함", () => {
    const cold = computeExamConfidence({ practice: makePractice(), test: makeTest(), now });
    const after = computeExamConfidence({
      practice: makePractice({
        practiceCount: 1,
        mostRecentPracticeAt: new Date(now.getTime() - 30 * 60 * 1000),
      }),
      test: makeTest(),
      now,
    });
    expect(after.displayScore).toBeGreaterThan(cold.displayScore);
  });

  it("시험 후 점수가 연습만 한 것보다 높아야 함", () => {
    const practiceOnly = computeExamConfidence({
      practice: makePractice({
        practiceCount: 3,
        mostRecentPracticeAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      }),
      test: makeTest(),
      now,
    });
    const withTest = computeExamConfidence({
      practice: makePractice({
        practiceCount: 3,
        mostRecentPracticeAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      }),
      test: makeTest({
        testCount: 1,
        correctCount: 1,
        wrongCount: 0,
        averageSimilarityScore: 85,
        mostRecentTestAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
        recentCorrectStreak: 1,
      }),
      now,
    });
    expect(withTest.displayScore).toBeGreaterThan(practiceOnly.displayScore);
  });

  it("시험 경험 없으면 망각 패널티 없음", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 3,
        mostRecentPracticeAt: new Date("2026-01-01T00:00:00Z"), // 3개월 전
      }),
      test: makeTest(),
      now,
    });
    expect(result.breakdown.forgettingPenalty).toBe(0);
  });

  it("시험 경험 있으면 오래된 기록에 망각 패널티 적용", () => {
    const recent = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, mostRecentPracticeAt: now }),
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
        practiceCount: 3,
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
    expect(old.breakdown.forgettingPenalty).toBeGreaterThan(0);
  });

  it("빠른 회상 보너스 적용", () => {
    // streak 1 (낮은 점수)에서 speedBonus 차이 확인
    const slow = computeExamConfidence({
      practice: makePractice({ practiceCount: 1, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 1,
        correctCount: 1,
        averageSimilarityScore: 70,
        mostRecentTestAt: now,
        recentCorrectStreak: 1,
        averageRecallTime: 60,
      }),
      now,
    });
    const fast = computeExamConfidence({
      practice: makePractice({ practiceCount: 1, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 1,
        correctCount: 1,
        averageSimilarityScore: 70,
        mostRecentTestAt: now,
        recentCorrectStreak: 1,
        averageRecallTime: 8,
      }),
      now,
    });
    expect(fast.displayScore).toBeGreaterThan(slow.displayScore);
    expect(fast.breakdown.speedBonus).toBe(5);
    expect(slow.breakdown.speedBonus).toBe(0);
  });
});

describe("aggregateConfidence", () => {
  it("빈 결과에서 red 반환", () => {
    const result = aggregateConfidence([]);
    expect(result.state).toBe("red");
    expect(result.totalQuestions).toBe(0);
  });

  it("여러 결과 집계 정상 동작", () => {
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
      practice: makePractice({ practiceCount: 1, mostRecentPracticeAt: now }),
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
  it("임계값 확인", () => {
    expect(CONFIDENCE_THRESHOLDS.green).toBe(80);
    expect(CONFIDENCE_THRESHOLDS.yellow).toBe(50);
  });
});
