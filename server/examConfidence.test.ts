import { describe, expect, it } from "vitest";
import {
  aggregateConfidence,
  computeExamConfidence,
  CONFIDENCE_THRESHOLDS,
  estimatePracticeConfidenceDelta,
  estimateTestConfidenceDelta,
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

const now = new Date("2026-04-07T00:00:00Z");
const examSoon = new Date(now.getTime() + 20 * 60 * 60 * 1000);
const examLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

describe("computeExamConfidence - 24h crunch mode", () => {
  it("cold-start는 0점(red)", () => {
    const result = computeExamConfidence({
      practice: makePractice(),
      test: makeTest(),
      now,
      examDate: examSoon,
    });

    expect(result.isColdStart).toBe(true);
    expect(result.displayScore).toBe(0);
    expect(result.state).toBe("red");
  });

  it("동일 연습량이면 시험 임박(20h) 점수가 더 높다", () => {
    const practice = makePractice({
      practiceCount: 4,
      totalPracticeDuration: 540,
      mostRecentPracticeAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    });

    const urgent = computeExamConfidence({
      practice,
      test: makeTest(),
      now,
      examDate: examSoon,
    });
    const relaxed = computeExamConfidence({
      practice,
      test: makeTest(),
      now,
      examDate: examLater,
    });

    expect(urgent.displayScore).toBeGreaterThan(relaxed.displayScore);
  });

  it("시험 없이 연습만으로는 상한이 적용된다", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 200,
        totalPracticeDuration: 60 * 60 * 3,
        mostRecentPracticeAt: new Date(now.getTime() - 20 * 60 * 1000),
      }),
      test: makeTest(),
      now,
      examDate: examSoon,
    });

    expect(result.displayScore).toBeLessThanOrEqual(68);
    expect(result.displayScore).toBeLessThan(CONFIDENCE_THRESHOLDS.green);
  });

  it("시험일이 없어도 반복 연습은 35점에 고정되지 않는다", () => {
    const result = computeExamConfidence({
      practice: makePractice({
        practiceCount: 24,
        totalPracticeDuration: 60 * 18,
        mostRecentPracticeAt: new Date(now.getTime() - 20 * 60 * 1000),
      }),
      test: makeTest(),
      now,
      examDate: null,
    });

    expect(result.displayScore).toBeGreaterThan(35);
    expect(result.displayScore).toBeLessThan(CONFIDENCE_THRESHOLDS.green);
  });

  it("40~50점대에서는 연습 1회 상승폭이 최소 2점, 최대 4점으로 안정화된다", () => {
    const previous = computeExamConfidence({
      practice: makePractice({
        practiceCount: 7,
        totalPracticeDuration: 140, // 평균 20초
        mostRecentPracticeAt: new Date(now.getTime() - 30 * 60 * 1000),
      }),
      test: makeTest(),
      now,
      examDate: examSoon,
    });
    const next = computeExamConfidence({
      practice: makePractice({
        practiceCount: 8,
        totalPracticeDuration: 160,
        mostRecentPracticeAt: new Date(now.getTime() - 30 * 60 * 1000),
      }),
      test: makeTest(),
      now,
      examDate: examSoon,
    });

    const diff = next.displayScore - previous.displayScore;
    expect(previous.displayScore).toBeGreaterThanOrEqual(40);
    expect(previous.displayScore).toBeLessThanOrEqual(50);
    expect(diff).toBeGreaterThanOrEqual(2);
    expect(diff).toBeLessThanOrEqual(4);
  });

  it("시험 신호가 있어도 단일 연습 급등은 4점 이내로 제한된다", () => {
    const testSignal = makeTest({
      testCount: 1,
      correctCount: 1,
      wrongCount: 0,
      averageSimilarityScore: 78,
      mostRecentTestAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      recentCorrectStreak: 1,
      recentTestHistory: [
        { completedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), isCorrect: true, similarityScore: 78 },
      ],
    });

    const previous = computeExamConfidence({
      practice: makePractice(),
      test: testSignal,
      now,
      examDate: examSoon,
    });
    const next = computeExamConfidence({
      practice: makePractice({
        practiceCount: 1,
        totalPracticeDuration: 5,
        mostRecentPracticeAt: new Date(now.getTime() - 30 * 60 * 1000),
      }),
      test: testSignal,
      now,
      examDate: examSoon,
    });

    const diff = next.displayScore - previous.displayScore;
    expect(previous.displayScore).toBeGreaterThanOrEqual(50);
    expect(previous.displayScore).toBeLessThanOrEqual(60);
    expect(diff).toBeGreaterThanOrEqual(2);
    expect(diff).toBeLessThanOrEqual(4);
  });

  it("첫 백지시험 100%는 현재 회상 안정도를 90점대로 앵커링한다", () => {
    const practice = makePractice({
      practiceCount: 3,
      totalPracticeDuration: 360,
      mostRecentPracticeAt: new Date(now.getTime() - 10 * 60 * 1000),
    });
    const before = computeExamConfidence({
      practice,
      test: makeTest(),
      now,
      examDate: examSoon,
      initialEstimate: { answerLength: 180, lineCount: 4, difficulty: "medium" },
    });
    const after = computeExamConfidence({
      practice,
      test: makeTest({
        testCount: 1,
        correctCount: 1,
        wrongCount: 0,
        averageSimilarityScore: 100,
        mostRecentTestAt: new Date(now.getTime() - 60 * 1000),
        recentCorrectStreak: 1,
        averageRecallTime: 12,
        recentTestHistory: [
          { completedAt: new Date(now.getTime() - 60 * 1000), isCorrect: true, similarityScore: 100 },
        ],
      }),
      now,
      examDate: examSoon,
      initialEstimate: { answerLength: 180, lineCount: 4, difficulty: "medium" },
    });

    expect(before.displayScore).toBeGreaterThanOrEqual(30);
    expect(before.displayScore).toBeLessThanOrEqual(39);
    expect(after.displayScore).toBeGreaterThanOrEqual(90);
    expect(after.displayScore).toBeGreaterThan(before.displayScore + 40);
    expect(after.state).toBe("green");
  });

  it("백지시험 100% 안정도는 시간이 지나면 망각곡선처럼 내려간다", () => {
    const practice = makePractice({
      practiceCount: 3,
      totalPracticeDuration: 360,
      mostRecentPracticeAt: new Date(now.getTime() - 10 * 60 * 1000),
    });
    const test = makeTest({
      testCount: 1,
      correctCount: 1,
      wrongCount: 0,
      averageSimilarityScore: 100,
      mostRecentTestAt: new Date(now.getTime() - 60 * 1000),
      recentCorrectStreak: 1,
      averageRecallTime: 12,
      recentTestHistory: [
        { completedAt: new Date(now.getTime() - 60 * 1000), isCorrect: true, similarityScore: 100 },
      ],
    });
    const immediate = computeExamConfidence({
      practice,
      test,
      now,
      examDate: examSoon,
      initialEstimate: { answerLength: 180, lineCount: 4, difficulty: "medium" },
    });
    const later = computeExamConfidence({
      practice,
      test,
      now: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      examDate: examSoon,
      initialEstimate: { answerLength: 180, lineCount: 4, difficulty: "medium" },
    });

    expect(immediate.displayScore).toBeGreaterThanOrEqual(90);
    expect(later.displayScore).toBeLessThan(immediate.displayScore);
    expect(later.displayScore).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLDS.yellow);
  });

  it("고유사도 오답도 강하게 반영된다 (유사도 중심)", () => {
    const correctOnce = computeExamConfidence({
      practice: makePractice({ practiceCount: 2, totalPracticeDuration: 240, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 1,
        correctCount: 1,
        wrongCount: 0,
        averageSimilarityScore: 78,
        mostRecentTestAt: new Date(now.getTime() - 60 * 60 * 1000),
        recentCorrectStreak: 1,
        recentTestHistory: [
          { completedAt: new Date(now.getTime() - 60 * 60 * 1000), isCorrect: true, similarityScore: 78 },
        ],
      }),
      now,
      examDate: examSoon,
    });

    const wrongButSimilar = computeExamConfidence({
      practice: makePractice({ practiceCount: 2, totalPracticeDuration: 240, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 1,
        correctCount: 0,
        wrongCount: 1,
        averageSimilarityScore: 92,
        mostRecentTestAt: new Date(now.getTime() - 60 * 60 * 1000),
        recentCorrectStreak: 0,
        recentTestHistory: [
          { completedAt: new Date(now.getTime() - 60 * 60 * 1000), isCorrect: false, similarityScore: 92 },
        ],
      }),
      now,
      examDate: examSoon,
    });

    expect(wrongButSimilar.displayScore).toBeGreaterThan(correctOnce.displayScore);
  });

  it("유사도 차이는 시험 안정도에 유의미하게 반영된다", () => {
    const lowSim = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, totalPracticeDuration: 360, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        wrongCount: 0,
        averageSimilarityScore: 82,
        mostRecentTestAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        recentCorrectStreak: 2,
        recentTestHistory: [
          { completedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), isCorrect: true, similarityScore: 82 },
          { completedAt: new Date(now.getTime() - 23 * 60 * 60 * 1000), isCorrect: true, similarityScore: 82 },
        ],
      }),
      now,
      examDate: examSoon,
    });

    const highSim = computeExamConfidence({
      practice: makePractice({ practiceCount: 3, totalPracticeDuration: 360, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        wrongCount: 0,
        averageSimilarityScore: 100,
        mostRecentTestAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        recentCorrectStreak: 2,
        recentTestHistory: [
          { completedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), isCorrect: true, similarityScore: 100 },
          { completedAt: new Date(now.getTime() - 23 * 60 * 60 * 1000), isCorrect: true, similarityScore: 100 },
        ],
      }),
      now,
      examDate: examSoon,
    });

    expect(highSim.rawScore - lowSim.rawScore).toBeGreaterThanOrEqual(3);
    expect(highSim.displayScore).toBeGreaterThanOrEqual(lowSim.displayScore);
  });

  it("20h 간격 재확인은 바로 재시도보다 streak 점수가 높다", () => {
    const spaced = computeExamConfidence({
      practice: makePractice({ practiceCount: 2, totalPracticeDuration: 240, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        wrongCount: 0,
        averageSimilarityScore: 90,
        mostRecentTestAt: new Date(now.getTime() - 20 * 60 * 60 * 1000),
        recentCorrectStreak: 2,
        recentTestHistory: [
          { completedAt: new Date(now.getTime() - 20 * 60 * 60 * 1000), isCorrect: true, similarityScore: 90 },
          { completedAt: new Date(now.getTime() - 40 * 60 * 60 * 1000), isCorrect: true, similarityScore: 90 },
        ],
      }),
      now,
      examDate: examSoon,
    });

    const crammed = computeExamConfidence({
      practice: makePractice({ practiceCount: 2, totalPracticeDuration: 240, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        wrongCount: 0,
        averageSimilarityScore: 90,
        mostRecentTestAt: new Date(now.getTime() - 10 * 60 * 1000),
        recentCorrectStreak: 2,
        recentTestHistory: [
          { completedAt: new Date(now.getTime() - 10 * 60 * 1000), isCorrect: true, similarityScore: 90 },
          { completedAt: new Date(now.getTime() - 20 * 60 * 1000), isCorrect: true, similarityScore: 90 },
        ],
      }),
      now,
      examDate: examSoon,
    });

    expect(spaced.breakdown.timeWeightedStreakScore).toBeGreaterThan(crammed.breakdown.timeWeightedStreakScore);
    expect(Math.abs(spaced.displayScore - crammed.displayScore)).toBeLessThanOrEqual(15);
  });

  it("시험 임박 + 장시간 공백이면 forgettingPenalty가 커진다", () => {
    const fresh = computeExamConfidence({
      practice: makePractice({
        practiceCount: 3,
        totalPracticeDuration: 360,
        mostRecentPracticeAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        wrongCount: 0,
        averageSimilarityScore: 88,
        mostRecentTestAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        recentCorrectStreak: 2,
      }),
      now,
      examDate: examSoon,
    });

    const stale = computeExamConfidence({
      practice: makePractice({
        practiceCount: 3,
        totalPracticeDuration: 360,
        mostRecentPracticeAt: new Date(now.getTime() - 18 * 60 * 60 * 1000),
      }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        wrongCount: 0,
        averageSimilarityScore: 88,
        mostRecentTestAt: new Date(now.getTime() - 18 * 60 * 60 * 1000),
        recentCorrectStreak: 2,
      }),
      now,
      examDate: examSoon,
    });

    expect(stale.breakdown.forgettingPenalty).toBeGreaterThan(fresh.breakdown.forgettingPenalty);
    expect(stale.displayScore).toBeLessThan(fresh.displayScore);
  });

  it("최근 저유사도 오답은 recentPoorPenalty를 만든다", () => {
    const stable = computeExamConfidence({
      practice: makePractice({ practiceCount: 4, totalPracticeDuration: 480, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        wrongCount: 0,
        averageSimilarityScore: 90,
        mostRecentTestAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        recentCorrectStreak: 2,
        recentTestHistory: [
          { completedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), isCorrect: true, similarityScore: 90 },
          { completedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), isCorrect: true, similarityScore: 90 },
        ],
      }),
      now,
      examDate: examSoon,
    });

    const poor = computeExamConfidence({
      practice: makePractice({ practiceCount: 4, totalPracticeDuration: 480, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 2,
        correctCount: 1,
        wrongCount: 1,
        averageSimilarityScore: 65,
        mostRecentTestAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        recentCorrectStreak: 0,
        mostRecentTestWasPoor: true,
        recentTestHistory: [
          { completedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), isCorrect: false, similarityScore: 42 },
          { completedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), isCorrect: true, similarityScore: 88 },
        ],
      }),
      now,
      examDate: examSoon,
    });

    expect(poor.breakdown.recentPoorPenalty).toBeGreaterThan(0);
    expect(poor.displayScore).toBeLessThan(stable.displayScore);
  });

  it("개별 시험 speedBonus가 모의고사보다 크다", () => {
    const individual = computeExamConfidence({
      practice: makePractice({ practiceCount: 2, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        averageSimilarityScore: 90,
        mostRecentTestAt: now,
        recentCorrectStreak: 2,
        averageRecallTime: 8,
        testType: "individual",
      }),
      now,
      examDate: examSoon,
    });

    const exam = computeExamConfidence({
      practice: makePractice({ practiceCount: 2, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 2,
        correctCount: 2,
        averageSimilarityScore: 90,
        mostRecentTestAt: now,
        recentCorrectStreak: 2,
        averageRecallTime: 8,
        testType: "exam",
      }),
      now,
      examDate: examSoon,
    });

    expect(individual.breakdown.speedBonus).toBeGreaterThan(exam.breakdown.speedBonus);
  });
});

describe("aggregateConfidence", () => {
  it("빈 결과면 red + 0개", () => {
    const agg = aggregateConfidence([]);
    expect(agg.state).toBe("red");
    expect(agg.totalQuestions).toBe(0);
  });

  it("집계 카운트/평균이 계산된다", () => {
    const good = computeExamConfidence({
      practice: makePractice({ practiceCount: 5, totalPracticeDuration: 600, mostRecentPracticeAt: now }),
      test: makeTest({
        testCount: 4,
        correctCount: 4,
        averageSimilarityScore: 92,
        mostRecentTestAt: now,
        recentCorrectStreak: 4,
      }),
      now,
      examDate: examSoon,
    });
    const weak = computeExamConfidence({
      practice: makePractice({ practiceCount: 1, mostRecentPracticeAt: now }),
      test: makeTest(),
      now,
      examDate: examLater,
    });

    const agg = aggregateConfidence([good, weak]);
    expect(agg.totalQuestions).toBe(2);
    expect(agg.averageScore).toBeGreaterThan(0);
    expect(agg.greenCount + agg.yellowCount + agg.redCount).toBe(2);
  });
});

describe("thresholds", () => {
  it("임계값은 유지된다", () => {
    expect(CONFIDENCE_THRESHOLDS.green).toBe(80);
    expect(CONFIDENCE_THRESHOLDS.yellow).toBe(40);
  });
});

describe("UI delta estimators", () => {
  it("연습 예상 증감: 저점+임박이 고점+여유보다 큼", () => {
    const urgent = estimatePracticeConfidenceDelta({
      currentScore: 22,
      sessionPracticeCount: 1,
      totalPracticeCount: 4,
      hoursUntilExam: 20,
    });
    const relaxed = estimatePracticeConfidenceDelta({
      currentScore: 84,
      sessionPracticeCount: 6,
      totalPracticeCount: 40,
      hoursUntilExam: 120,
    });

    expect(urgent).toBeGreaterThan(relaxed);
    expect(urgent).toBeGreaterThan(0);
  });

  it("시험 예상 증감: 정답은 +, 오답은 -", () => {
    const plus = estimateTestConfidenceDelta({
      currentScore: 45,
      isCorrect: true,
      similarityScore: 90,
      recallTime: 12,
      hoursUntilExam: 20,
    });
    const minus = estimateTestConfidenceDelta({
      currentScore: 45,
      isCorrect: false,
      similarityScore: 52,
      recallTime: 12,
      hoursUntilExam: 20,
    });

    expect(plus).toBeGreaterThan(0);
    expect(minus).toBeLessThan(0);
  });
});
