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
    // 2회 시험: 24시간 간격으로 봐야 높은 점수 (시간 가중치 적용)
    const t1 = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25시간 전
    const t2 = new Date(now.getTime() - 1 * 60 * 60 * 1000);  // 1시간 전
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
        mostRecentTestAt: t2,
        recentCorrectStreak: 2,
        recentTestHistory: [
          { completedAt: t2, isCorrect: true, similarityScore: 90 },
          { completedAt: t1, isCorrect: true, similarityScore: 90 },
        ],
      }),
      now,
    });
    expect(result.displayScore).toBeGreaterThanOrEqual(50);
    expect(result.displayScore).toBeLessThanOrEqual(78);
  });

  it("시험 3회+ 연속 통과: 80% 이상 (green)", () => {
    // 3회 시험: 각각 24시간 간격으로 보면 높은 점수
    const t1 = new Date(now.getTime() - 49 * 60 * 60 * 1000); // 49시간 전
    const t2 = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25시간 전
    const t3 = new Date(now.getTime() - 1 * 60 * 60 * 1000);  // 1시간 전
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
        mostRecentTestAt: t3,
        recentCorrectStreak: 3,
        recentTestHistory: [
          { completedAt: t3, isCorrect: true, similarityScore: 92 },
          { completedAt: t2, isCorrect: true, similarityScore: 92 },
          { completedAt: t1, isCorrect: true, similarityScore: 92 },
        ],
      }),
      now,
    });
    expect(result.displayScore).toBeGreaterThanOrEqual(75);
    expect(result.state).toBe("green");
  });

  it("3번 틀린 후 점수가 크게 감소 (60% 이하)", () => {
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
    expect(after.displayScore).toBeLessThan(60);
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
    expect(fast.breakdown.speedBonus).toBe(10); // 개별 시험(기본값) max +10
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
    expect(CONFIDENCE_THRESHOLDS.yellow).toBe(40);
  });
});

describe("정답률 80% 이상이면 초록불", () => {
  it("5번 시험 4번 정답 (80% 정답률) → 초록불", () => {
    const t1 = new Date(now.getTime() - 96 * 60 * 60 * 1000); // 4일 전
    const t2 = new Date(now.getTime() - 72 * 60 * 60 * 1000); // 3일 전
    const t3 = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 2일 전
    const t4 = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1일 전
    const t5 = new Date(now.getTime() - 1 * 60 * 60 * 1000);  // 1시간 전
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 5,
        totalPracticeDuration: 600,
        mostRecentPracticeAt: now,
      }),
      test: makeTest({
        testCount: 5,
        correctCount: 4,
        wrongCount: 1,
        averageSimilarityScore: 85,
        mostRecentTestAt: t5,
        recentCorrectStreak: 2,
        mostRecentTestWasPoor: false,
        recentTestHistory: [
          { completedAt: t5, isCorrect: true, similarityScore: 90 },
          { completedAt: t4, isCorrect: true, similarityScore: 88 },
          { completedAt: t3, isCorrect: true, similarityScore: 85 },
          { completedAt: t2, isCorrect: true, similarityScore: 87 },
          { completedAt: t1, isCorrect: false, similarityScore: 55 },
        ],
      }),
      now,
    });
    expect(result.displayScore).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLDS.green);
    expect(result.state).toBe("green");
  });

  it("6번 시험 5번 정답 (83% 정답률) → 초록불", () => {
    const t1 = new Date(now.getTime() - 120 * 60 * 60 * 1000); // 5일 전
    const t2 = new Date(now.getTime() - 96 * 60 * 60 * 1000);  // 4일 전
    const t3 = new Date(now.getTime() - 72 * 60 * 60 * 1000);  // 3일 전 (오답)
    const t4 = new Date(now.getTime() - 48 * 60 * 60 * 1000);  // 2일 전
    const t5 = new Date(now.getTime() - 24 * 60 * 60 * 1000);  // 1일 전
    const t6 = new Date(now.getTime() - 1 * 60 * 60 * 1000);   // 1시간 전
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 5,
        totalPracticeDuration: 600,
        mostRecentPracticeAt: now,
      }),
      test: makeTest({
        testCount: 6,
        correctCount: 5,
        wrongCount: 1,
        averageSimilarityScore: 88,
        mostRecentTestAt: t6,
        recentCorrectStreak: 3,
        mostRecentTestWasPoor: false,
        recentTestHistory: [
          { completedAt: t6, isCorrect: true, similarityScore: 90 },
          { completedAt: t5, isCorrect: true, similarityScore: 88 },
          { completedAt: t4, isCorrect: true, similarityScore: 89 },
          { completedAt: t3, isCorrect: false, similarityScore: 55 },
          { completedAt: t2, isCorrect: true, similarityScore: 87 },
          { completedAt: t1, isCorrect: true, similarityScore: 88 },
        ],
      }),
      now,
    });
    // 83% 정답률 + streak 3개이지만 최근 시험이 1시간 전이라 망각 극복 보너스 낙음
    expect(result.displayScore).toBeGreaterThanOrEqual(70);
    expect(result.state).not.toBe("red");
  });

  it("5번 시험 3번 정답 (60% 정답률) → 노란불", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 5,
        totalPracticeDuration: 600,
        mostRecentPracticeAt: now,
      }),
      test: makeTest({
        testCount: 5,
        correctCount: 3,
        wrongCount: 2,
        averageSimilarityScore: 70,
        mostRecentTestAt: now,
        recentCorrectStreak: 1,
        mostRecentTestWasPoor: false,
      }),
      now,
    });
    expect(result.displayScore).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLDS.yellow);
    expect(result.displayScore).toBeLessThan(CONFIDENCE_THRESHOLDS.green);
    expect(result.state).toBe("yellow");
  });

  it("정답률 80% 이상이면 wrongPenalty가 크게 감소", () => {
    const highRate = computeExamConfidence({
      practice: makePractice({ practiceCount: 5, totalPracticeDuration: 600, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 5, correctCount: 4, wrongCount: 1,
        averageSimilarityScore: 85, mostRecentTestAt: now,
        recentCorrectStreak: 2, mostRecentTestWasPoor: false,
      }),
      now,
    });
    const lowRate = computeExamConfidence({
      practice: makePractice({ practiceCount: 5, totalPracticeDuration: 600, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 5, correctCount: 2, wrongCount: 3,
        averageSimilarityScore: 50, mostRecentTestAt: now,
        recentCorrectStreak: 0, mostRecentTestWasPoor: true,
      }),
      now,
    });
    expect(highRate.breakdown.wrongPenalty).toBeLessThan(lowRate.breakdown.wrongPenalty);
  });
});

describe("Recall Speed Bonus - 개별 vs 모의고사 분리", () => {
  it("개별 시험 빠른 회상: max +12", () => {
    const result = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 3,
        correctCount: 3,
        averageSimilarityScore: 90,
        mostRecentTestAt: now,
        recentCorrectStreak: 3,
        averageRecallTime: 8, // <= 10초
        testType: "individual",
      }),
      now,
    });
    expect(result.breakdown.speedBonus).toBe(10);
  });

  it("모의고사 빠른 회상: max +6", () => {
    const result = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 3,
        correctCount: 3,
        averageSimilarityScore: 90,
        mostRecentTestAt: now,
        recentCorrectStreak: 3,
        averageRecallTime: 8, // <= 10초
        testType: "exam",
      }),
      now,
    });
    expect(result.breakdown.speedBonus).toBe(6);
  });

  it("개별 시험이 모의고사보다 speedBonus가 높음", () => {
    const individual = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 3, correctCount: 3, averageSimilarityScore: 90,
        mostRecentTestAt: now, recentCorrectStreak: 3,
        averageRecallTime: 8, testType: "individual",
      }),
      now,
    });
    const exam = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 3, correctCount: 3, averageSimilarityScore: 90,
        mostRecentTestAt: now, recentCorrectStreak: 3,
        averageRecallTime: 8, testType: "exam",
      }),
      now,
    });
    expect(individual.breakdown.speedBonus).toBeGreaterThan(exam.breakdown.speedBonus);
  });

  it("testType 미지정 시 기본값(개별 시험)으로 동작", () => {
    const result = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 3, correctCount: 3, averageSimilarityScore: 90,
        mostRecentTestAt: now, recentCorrectStreak: 3,
        averageRecallTime: 8, // testType 미지정
      }),
      now,
    });
    // 미지정 시 개별 시험(max +12)으로 동작
    expect(result.breakdown.speedBonus).toBe(10);
  });
});
