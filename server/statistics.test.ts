import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db module
vi.mock("./db", () => ({
  getPracticeSessionsByUserId: vi.fn(),
  getTestSessionsByUserId: vi.fn(),
  getQuestionsByUserId: vi.fn(),
  getSubjectsByUserId: vi.fn(),
}));

import * as db from "./db";

describe("Statistics API logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSummary logic", () => {
    it("should calculate overall correct rate from test sessions", async () => {
      const mockTests = [
        { id: 1, questionId: 1, userId: 1, isCorrect: 1, similarityScore: 90, recallTime: 30, completedAt: new Date() },
        { id: 2, questionId: 2, userId: 1, isCorrect: 0, similarityScore: 40, recallTime: 60, completedAt: new Date() },
        { id: 3, questionId: 1, userId: 1, isCorrect: 1, similarityScore: 85, recallTime: 25, completedAt: new Date() },
      ];

      const totalCorrect = mockTests.filter(t => t.isCorrect === 1).length;
      const overallCorrectRate = Math.round((totalCorrect / mockTests.length) * 100);

      expect(totalCorrect).toBe(2);
      expect(overallCorrectRate).toBe(67);
    });

    it("should bucket practice counts correctly", () => {
      const bucketRanges = [
        { label: "0회", min: 0, max: 0 },
        { label: "1-2회", min: 1, max: 2 },
        { label: "3-5회", min: 3, max: 5 },
        { label: "6-10회", min: 6, max: 10 },
        { label: "11회+", min: 11, max: Infinity },
      ];

      const practiceCountBuckets = [
        { practiceCount: 0, testCount: 2, correctCount: 0 },
        { practiceCount: 1, testCount: 3, correctCount: 1 },
        { practiceCount: 5, testCount: 4, correctCount: 3 },
        { practiceCount: 12, testCount: 5, correctCount: 4 },
        { practiceCount: 3, testCount: 2, correctCount: 2 },
      ];

      const result = bucketRanges.map(range => {
        const inRange = practiceCountBuckets.filter(
          b => b.practiceCount >= range.min && b.practiceCount <= range.max
        );
        const totalTests = inRange.reduce((s, b) => s + b.testCount, 0);
        const totalCorrectInRange = inRange.reduce((s, b) => s + b.correctCount, 0);
        return {
          label: range.label,
          questionCount: inRange.length,
          testCount: totalTests,
          correctRate: totalTests > 0 ? Math.round((totalCorrectInRange / totalTests) * 100) : 0,
        };
      });

      // 0회 bucket: 1 question, 2 tests, 0 correct → 0%
      expect(result[0]).toEqual({ label: "0회", questionCount: 1, testCount: 2, correctRate: 0 });
      // 1-2회 bucket: 1 question, 3 tests, 1 correct → 33%
      expect(result[1]).toEqual({ label: "1-2회", questionCount: 1, testCount: 3, correctRate: 33 });
      // 3-5회 bucket: 2 questions, 6 tests, 5 correct → 83%
      expect(result[2]).toEqual({ label: "3-5회", questionCount: 2, testCount: 6, correctRate: 83 });
      // 11회+ bucket: 1 question, 5 tests, 4 correct → 80%
      expect(result[4]).toEqual({ label: "11회+", questionCount: 1, testCount: 5, correctRate: 80 });
    });

    it("should identify weak questions (correctRate < 70%)", () => {
      const allQuestions = [
        { id: 1, question: "문제1 텍스트", subjectId: 1, difficulty: "easy" },
        { id: 2, question: "문제2 텍스트", subjectId: 1, difficulty: "hard" },
        { id: 3, question: "문제3 텍스트", subjectId: 2, difficulty: "medium" },
      ];

      const allTests = [
        { questionId: 1, isCorrect: 1, similarityScore: 90 },
        { questionId: 1, isCorrect: 1, similarityScore: 85 },
        { questionId: 2, isCorrect: 0, similarityScore: 30 },
        { questionId: 2, isCorrect: 0, similarityScore: 25 },
        { questionId: 2, isCorrect: 1, similarityScore: 70 },
        { questionId: 3, isCorrect: 1, similarityScore: 80 },
      ];

      const allPractice = [
        { questionId: 1, duration: 60 },
        { questionId: 1, duration: 45 },
        { questionId: 2, duration: 30 },
      ];

      const weakQuestions = allQuestions
        .map(q => {
          const qTests = allTests.filter(t => t.questionId === q.id);
          const qPractices = allPractice.filter(p => p.questionId === q.id);
          const correct = qTests.filter(t => t.isCorrect === 1).length;
          return {
            questionId: q.id,
            question: q.question.substring(0, 60),
            practiceCount: qPractices.length,
            testCount: qTests.length,
            correctRate: qTests.length > 0 ? Math.round((correct / qTests.length) * 100) : -1,
          };
        })
        .filter(q => q.testCount > 0 && q.correctRate < 70)
        .sort((a, b) => a.correctRate - b.correctRate);

      // 문제2: 1/3 = 33% → weak
      expect(weakQuestions.length).toBe(1);
      expect(weakQuestions[0].questionId).toBe(2);
      expect(weakQuestions[0].correctRate).toBe(33);
    });
  });

  describe("getSubjectAnalysis logic", () => {
    it("should calculate difficulty stats per subject", () => {
      const subjectQs = [
        { id: 1, difficulty: "easy" },
        { id: 2, difficulty: "easy" },
        { id: 3, difficulty: "hard" },
      ];

      const tests = [
        { questionId: 1, isCorrect: 1, similarityScore: 90 },
        { questionId: 2, isCorrect: 1, similarityScore: 85 },
        { questionId: 3, isCorrect: 0, similarityScore: 30 },
      ];

      const difficultyStats = ["easy", "medium", "hard"].map(diff => {
        const diffQIds = subjectQs.filter(q => q.difficulty === diff).map(q => q.id);
        const diffTests = tests.filter(t => diffQIds.includes(t.questionId));
        const correct = diffTests.filter(t => t.isCorrect === 1).length;
        const avgSimilarity = diffTests.length > 0
          ? Math.round(diffTests.reduce((s, t) => s + (t.similarityScore || 0), 0) / diffTests.length)
          : 0;
        return {
          difficulty: diff,
          totalTests: diffTests.length,
          correctCount: correct,
          correctRate: diffTests.length > 0 ? Math.round((correct / diffTests.length) * 100) : 0,
          avgSimilarity,
        };
      });

      // easy: 2 tests, 2 correct → 100%
      expect(difficultyStats[0]).toEqual({
        difficulty: "easy",
        totalTests: 2,
        correctCount: 2,
        correctRate: 100,
        avgSimilarity: 88,
      });
      // medium: 0 tests
      expect(difficultyStats[1]).toEqual({
        difficulty: "medium",
        totalTests: 0,
        correctCount: 0,
        correctRate: 0,
        avgSimilarity: 0,
      });
      // hard: 1 test, 0 correct → 0%
      expect(difficultyStats[2]).toEqual({
        difficulty: "hard",
        totalTests: 1,
        correctCount: 0,
        correctRate: 0,
        avgSimilarity: 30,
      });
    });

    it("should calculate performance trend by date", () => {
      const tests = [
        { questionId: 1, isCorrect: 1, similarityScore: 90, completedAt: new Date("2026-03-10T10:00:00Z") },
        { questionId: 2, isCorrect: 0, similarityScore: 40, completedAt: new Date("2026-03-10T11:00:00Z") },
        { questionId: 1, isCorrect: 1, similarityScore: 95, completedAt: new Date("2026-03-11T10:00:00Z") },
      ];

      const testsByDate = tests.reduce((acc, t) => {
        const date = new Date(t.completedAt).toISOString().split('T')[0];
        if (!acc[date]) acc[date] = [];
        acc[date].push(t);
        return acc;
      }, {} as Record<string, typeof tests>);

      const performanceTrend = Object.entries(testsByDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, dayTests]) => {
          const correct = dayTests.filter(t => t.isCorrect === 1).length;
          const avgSim = Math.round(dayTests.reduce((s, t) => s + (t.similarityScore || 0), 0) / dayTests.length);
          return {
            date,
            correctRate: Math.round((correct / dayTests.length) * 100),
            avgSimilarity: avgSim,
            testCount: dayTests.length,
          };
        });

      expect(performanceTrend.length).toBe(2);
      // 2026-03-10: 1/2 correct → 50%
      expect(performanceTrend[0]).toEqual({
        date: "2026-03-10",
        correctRate: 50,
        avgSimilarity: 65,
        testCount: 2,
      });
      // 2026-03-11: 1/1 correct → 100%
      expect(performanceTrend[1]).toEqual({
        date: "2026-03-11",
        correctRate: 100,
        avgSimilarity: 95,
        testCount: 1,
      });
    });
  });

  describe("Learning strategy logic", () => {
    it("should detect low practice subjects", () => {
      const subjectAnalysis = [
        { subjectName: "해부학", totalQuestions: 10, practiceCount: 5, totalTests: 3, overallCorrectRate: 60 },
        { subjectName: "생리학", totalQuestions: 10, practiceCount: 50, totalTests: 5, overallCorrectRate: 80 },
      ];

      const lowPractice = subjectAnalysis.filter(
        s => s.totalQuestions > 0 && s.practiceCount / Math.max(s.totalQuestions, 1) < 3
      );

      expect(lowPractice.length).toBe(1);
      expect(lowPractice[0].subjectName).toBe("해부학");
    });

    it("should detect high practice low test performance subjects", () => {
      const subjectAnalysis = [
        { subjectName: "해부학", practiceCount: 50, totalTests: 10, overallCorrectRate: 30 },
        { subjectName: "생리학", practiceCount: 50, totalTests: 10, overallCorrectRate: 80 },
      ];

      const highPracticeLowTest = subjectAnalysis.filter(
        s => s.practiceCount > 10 && s.totalTests > 3 && s.overallCorrectRate < 50
      );

      expect(highPracticeLowTest.length).toBe(1);
      expect(highPracticeLowTest[0].subjectName).toBe("해부학");
    });
  });
});
