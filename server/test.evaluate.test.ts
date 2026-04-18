import { describe, it, expect, beforeEach, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

describe("test.evaluate - Line-by-line grading with similarity", () => {
  let caller: any;
  let demoCaller: any;
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

    vi.spyOn(db, "createTestSession").mockResolvedValue({
      id: 999,
      userId: testUserId,
      questionId: testQuestionId,
      userAnswer: "",
      isCorrect: 0,
      similarityScore: 0,
      feedback: null,
      createdAt: new Date(),
      recallTime: 30,
      scoreDelta: 0,
      updatedConfidence: 0,
    } as any);
    vi.spyOn(db, "getTestSessionsByQuestionId").mockResolvedValue([]);

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

    // Demo caller (no user)
    const demoCtx: TrpcContext = {
      user: null,
      req: {
        protocol: "https",
        headers: {},
      } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    demoCaller = appRouter.createCaller(demoCtx);
  });

  it("should return both accuracyRate and similarityScore for all correct", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고\n상하악 치아가 최대 교두감합위에서 균등 접촉\n교합력이 치아 장축 방향\n전방 및 측방 운동 시 구치 이개",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(true);
    expect(result.accuracyRate).toBe(100);
    expect(result.correctLineCount).toBe(5);
    expect(result.totalLines).toBe(5);
    expect(result.similarityScore).toBe(100);
    expect(result.mistakes).toHaveLength(5);
    expect(result.mistakes.every((m: any) => m.isCorrect)).toBe(true);
  });

  it("should return partial accuracy (2/5) with high similarity for partial input", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(false);
    expect(result.accuracyRate).toBe(40); // 2/5 = 40%
    expect(result.correctLineCount).toBe(2);
    expect(result.totalLines).toBe(5);
    // similarityScore should be > 0 but < 100 (character-level)
    expect(result.similarityScore).toBeGreaterThan(0);
    expect(result.similarityScore).toBeLessThan(100);
    expect(result.feedback).toContain("2/5 줄 정답");
  });

  it("should return high similarity for slightly wrong answer", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고\n상하악 치아가 최대 교두감합위에서 균등 접촉\n교합력이 치아 장축 방향\n전방 및 측방 운동 시 구치 이겨", // 이개 → 이겨
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(false);
    expect(result.accuracyRate).toBe(80); // 4/5 correct lines
    expect(result.correctLineCount).toBe(4);
    expect(result.totalLines).toBe(5);
    // Similarity should be very high since only one character differs
    expect(result.similarityScore).toBeGreaterThanOrEqual(95);
  });

  it("should return 0 similarity for empty answer", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(false);
    expect(result.accuracyRate).toBe(0);
    expect(result.correctLineCount).toBe(0);
    expect(result.totalLines).toBe(5);
    expect(result.similarityScore).toBe(0);
  });

  it("should ignore whitespace in both accuracy and similarity", async () => {
    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "  악관절이   건강하고   안정  \n모든  치아가  견고",
      recallTime: 30,
    });

    expect(result.accuracyRate).toBe(40); // 2/5 lines correct
    expect(result.mistakes[0].isCorrect).toBe(true);
    expect(result.mistakes[1].isCorrect).toBe(true);
    // Similarity should match partial input regardless of whitespace
    expect(result.similarityScore).toBeGreaterThan(0);
  });

  it("should accept bullet spacing and mixed English/Korean line in word mode", async () => {
    vi.spyOn(db, "getQuestionById").mockResolvedValueOnce({
      id: testQuestionId,
      userId: testUserId,
      subjectId: testSubjectId,
      question: "간접유지장치 문장을 입력하시오.",
      answer: "– Anteroposterior tilting leverage 감소",
      questionType: "text",
      imageUrl: null,
      imageLabels: null,
      tableData: null,
      useAIGrading: false,
      displayOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "-anteroposterior tilting leverage 감소",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(true);
    expect(result.accuracyRate).toBe(100);
    expect(result.correctLineCount).toBe(1);
    expect(result.totalLines).toBe(1);
    expect(result.similarityScore).toBe(100);
    expect(result.mistakes?.[0]?.isCorrect).toBe(true);
    expect(result.mistakes?.[0]?.compareMode).toBe("word");
  });

  it("should not steal the next line match unless cross-line similarity is very high", async () => {
    vi.spyOn(db, "getQuestionById").mockResolvedValueOnce({
      id: testQuestionId,
      userId: testUserId,
      subjectId: testSubjectId,
      question: "간접유지장치의 효과에 영향을 주는 요소",
      answer: "1. 직접유지장치의 효과\n2. 지점선으로의 거리\n3. 주연결장치의 견고성\n4. 지지 치면의 효율성",
      questionType: "text",
      imageUrl: null,
      imageLabels: null,
      tableData: null,
      useAIGrading: false,
      displayOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "1. 직접유지장치의 효과\n2. 지점선으로의 거리\n3. 몰라\n4. 지지 치면의 효율박영석",
      recallTime: 30,
    });

    expect(result.mistakes?.[2]?.matchedUserLineIndex).toBe(3);
    expect(result.mistakes?.[2]?.userAnswer).toContain("3. 몰라");
    expect(result.mistakes?.[2]?.lineScore).toBeLessThan(80);

    expect(result.mistakes?.[3]?.matchedUserLineIndex).toBe(4);
    expect(result.mistakes?.[3]?.userAnswer).toContain("4. 지지 치면의 효율");
  });

  it("should rematch to another line when cross-line similarity is 80+ in exam grading", async () => {
    vi.spyOn(db, "getQuestionById").mockResolvedValueOnce({
      id: testQuestionId,
      userId: testUserId,
      subjectId: testSubjectId,
      question: "간접유지장치의 효과에 영향을 주는 요소",
      answer: "1. 직접유지장치의 효과\n2. 지점선으로의 거리\n3. 주연결장치의 견고성",
      questionType: "text",
      imageUrl: null,
      imageLabels: null,
      tableData: null,
      useAIGrading: false,
      displayOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "1. 직접유지장치의 효과\n2. 주연결장치의 견고성\n3. 몰라",
      recallTime: 30,
    });

    // 3번째 정답줄은 2번째 입력줄(다른 줄)과 80% 이상으로 재매칭되어 정답 처리
    expect(result.mistakes?.[2]?.matchedUserLineIndex).toBe(2);
    expect(result.mistakes?.[2]?.isCorrect).toBe(true);

    // 그 결과, 2번째 줄은 남은 입력("3. 몰라")과 비교되어 오답 처리
    expect(result.mistakes?.[1]?.matchedUserLineIndex).toBe(3);
    expect(result.mistakes?.[1]?.isCorrect).toBe(false);
  });

  it("should save test session with similarityScore (character-level)", async () => {
    await caller.test.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고",
      recallTime: 30,
    });

    // Verify createTestSession was called
    expect(db.createTestSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: testUserId,
        questionId: testQuestionId,
        isCorrect: 0,
      })
    );

    // similarityScore should be character-level, not line-level
    const callArgs = (db.createTestSession as any).mock.calls[0][0];
    expect(callArgs.similarityScore).toBeGreaterThan(0);
    expect(callArgs.similarityScore).toBeLessThan(100);
  });

  // Demo mode tests
  it("demo.evaluate should return same accuracy and similarity results", async () => {
    const result = await demoCaller.demo.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고",
      recallTime: 30,
    });

    expect(result.isCorrect).toBe(false);
    expect(result.accuracyRate).toBe(40);
    expect(result.correctLineCount).toBe(2);
    expect(result.totalLines).toBe(5);
    expect(result.similarityScore).toBeGreaterThan(0);
    expect(result.similarityScore).toBeLessThan(100);
    expect(result.feedback).toContain("2/5 줄 정답");
  });

  it("demo.evaluate should not save test session", async () => {
    await demoCaller.demo.evaluate({
      questionId: testQuestionId,
      userAnswer: "악관절이 건강하고 안정\n모든 치아가 견고",
      recallTime: 30,
    });

    // createTestSession should NOT be called in demo mode
    expect(db.createTestSession).not.toHaveBeenCalled();
  });
});
