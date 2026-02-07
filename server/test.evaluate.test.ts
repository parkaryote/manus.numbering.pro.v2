import { describe, it, expect, beforeEach, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

describe("test.evaluate - Line-by-line grading", () => {
  let caller: any;
  let testUserId: number;
  let testSubjectId: number;
  let testQuestionId: number;

  beforeEach(async () => {
    testUserId = 1;
    testSubjectId = 1;
    testQuestionId = 1;

    // Mock database functions
    vi.spyOn(db, "getQuestionById").mockResolvedValue({
      id: testQuestionId,
      userId: testUserId,
      subjectId: testSubjectId,
      question: "안정된 교합의 조건 5가지를 나열하시오.",
      answer: "악관절이 건강하고 안정\n모든 치아가 견고\n상하악 치아가 최대 교두감합위에서 균등 접촉\n교합력이 치아 장축 방향\n전방 및 측방 운동 시 구치 이개",
      questionType: "text",
      imageUrl: null,
      imageLabels: null,
      tableData: null,
      useAIGrading: false,
      displayOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.spyOn(db, "createTestSession").mockResolvedValue(undefined as any);
    vi.spyOn(db, "getTestSessionsByQuestionId").mockResolvedValue([
      {
        id: 1,
        userId: testUserId,
        questionId: testQuestionId,
        userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고",
        isCorrect: 0,
        recallTime: 30,
        similarityScore: 40,
        mistakeHighlights: JSON.stringify([
          { lineIndex: 1, correctAnswer: "악관절이 건강하고 안정", userAnswer: "악관절이 건강하고 안정", isCorrect: true },
          { lineIndex: 2, correctAnswer: "모든 치아가 견고", userAnswer: "모든 치아가 견고", isCorrect: true },
          { lineIndex: 3, correctAnswer: "상하악 치아가 최대 교두감합위에서 균등 접촉", userAnswer: "", isCorrect: false },
          { lineIndex: 4, correctAnswer: "교합력이 치아 장축 방향", userAnswer: "", isCorrect: false },
          { lineIndex: 5, correctAnswer: "전방 및 측방 운동 시 구치 이개", userAnswer: "", isCorrect: false },
        ]),
        llmFeedback: null,
        createdAt: new Date(),
      },
    ]);

    // Create tRPC caller with test user context
    const user: AuthenticatedUser = {
      id: testUserId,
      openId: "test-user",
      name: "Test User",
      email: "test@example.com",
      avatar: null,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };

    const ctx: TrpcContext = {
      user,
      req: {
        protocol: "https",
        headers: {},
      } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };

    caller = appRouter.createCaller(ctx);
  });

  it("should grade all correct lines as 100%", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고\n상하악 치아가 최대 교두감합위에서 균등 접촉\n교합력이 치아 장축 방향\n전방 및 측방 운동 시 구치 이개",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(true);
    expect(result.accuracyRate).toBe(100);
    expect(result.mistakes).toHaveLength(5);
    expect(result.mistakes.every((m: any) => m.isCorrect)).toBe(true);
    expect(result.feedback).toContain("정확하게 작성하셨습니다");
  });

  it("should recognize partial correct lines (2 out of 5)", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(false);
    expect(result.accuracyRate).toBe(40); // 2/5 = 40%
    expect(result.mistakes).toHaveLength(5);
    
    // First two lines should be correct
    expect(result.mistakes[0].isCorrect).toBe(true);
    expect(result.mistakes[0].correctAnswer).toBe("악관절이 건강하고 안정");
    expect(result.mistakes[0].userAnswer).toBe("악관절이 건강하고 안정");
    
    expect(result.mistakes[1].isCorrect).toBe(true);
    expect(result.mistakes[1].correctAnswer).toBe("모든 치아가 견고");
    expect(result.mistakes[1].userAnswer).toBe("모든 치아가 견고");
    
    // Remaining lines should be incorrect (empty)
    expect(result.mistakes[2].isCorrect).toBe(false);
    expect(result.mistakes[2].userAnswer).toBe("");
    
    expect(result.feedback).toContain("2/5 줄 정답");
    expect(result.feedback).toContain("40%");
  });

  it("should recognize 3 out of 5 correct lines", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고\n상하악 치아가 최대 교두감합위에서 균등 접촉",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(false);
    expect(result.accuracyRate).toBe(60); // 3/5 = 60%
    expect(result.mistakes).toHaveLength(5);
    
    // First three lines should be correct
    expect(result.mistakes[0].isCorrect).toBe(true);
    expect(result.mistakes[1].isCorrect).toBe(true);
    expect(result.mistakes[2].isCorrect).toBe(true);
    
    // Last two lines should be incorrect
    expect(result.mistakes[3].isCorrect).toBe(false);
    expect(result.mistakes[4].isCorrect).toBe(false);
    
    expect(result.feedback).toContain("3/5 줄 정답");
    expect(result.feedback).toContain("60%");
  });

  it("should handle incorrect lines in the middle", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n틀린 답\n상하악 치아가 최대 교두감합위에서 균등 접촉\n교합력이 치아 장축 방향\n전방 및 측방 운동 시 구치 이개",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(false);
    expect(result.accuracyRate).toBe(80); // 4/5 = 80%
    expect(result.mistakes).toHaveLength(5);
    
    // Check specific lines
    expect(result.mistakes[0].isCorrect).toBe(true);
    expect(result.mistakes[1].isCorrect).toBe(false); // Wrong answer
    expect(result.mistakes[1].userAnswer).toBe("틀린 답");
    expect(result.mistakes[2].isCorrect).toBe(true);
    expect(result.mistakes[3].isCorrect).toBe(true);
    expect(result.mistakes[4].isCorrect).toBe(true);
    
    expect(result.feedback).toContain("4/5 줄 정답");
  });

  it("should ignore whitespace differences", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "  악관절이   건강하고   안정  \n모든  치아가  견고",
      recallTime: 30,
    });

    expect(result.accuracyRate).toBe(40); // 2/5 = 40%
    expect(result.mistakes[0].isCorrect).toBe(true);
    expect(result.mistakes[1].isCorrect).toBe(true);
  });

  it("should handle empty answer", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(false);
    expect(result.accuracyRate).toBe(0);
    expect(result.mistakes).toHaveLength(5);
    expect(result.mistakes.every((m: any) => !m.isCorrect)).toBe(true);
    expect(result.feedback).toContain("0/5 줄 정답");
  });

  it("should save test session with line comparisons", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고",
      recallTime: 30,
    });

    // Verify createTestSession was called with correct data
    expect(db.createTestSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: testUserId,
        questionId: testQuestionId,
        isCorrect: 0,
        similarityScore: 40,
      })
    );
    
    // Verify mistakeHighlights contains line comparisons
    const callArgs = (db.createTestSession as any).mock.calls[0][0];
    const highlights = JSON.parse(callArgs.mistakeHighlights || "[]");
    expect(highlights).toHaveLength(5);
    expect(highlights[0].lineIndex).toBe(1);
    expect(highlights[0].isCorrect).toBe(true);
    expect(highlights[1].lineIndex).toBe(2);
    expect(highlights[1].isCorrect).toBe(true);
    expect(highlights[2].isCorrect).toBe(false);
  });
});
