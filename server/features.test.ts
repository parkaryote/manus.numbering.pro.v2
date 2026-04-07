import { describe, expect, it, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import {
  subjects,
  questions,
  practiceSessions,
  testSessions,
  reviewSchedules,
} from "../drizzle/schema";
import { eq } from "drizzle-orm";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

// 테스트 전용 userId - 실제 사용자(1번)와 충돌하지 않는 값 사용
const TEST_USER_ID = 99999;
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabase ? describe : describe.skip;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: TEST_USER_ID,
    openId: "test-user-isolated",
    email: "test-isolated@example.com",
    name: "Test User Isolated",
    loginMethod: "manus",
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
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

// 테스트 종료 후 테스트 데이터 정리
afterAll(async () => {
  try {
    const db = await getDb();
    if (!db) return;
    // 테스트 사용자가 생성한 데이터 모두 삭제 (외래키 순서 고려)
    await db
      .delete(reviewSchedules)
      .where(eq(reviewSchedules.userId, TEST_USER_ID));
    await db.delete(testSessions).where(eq(testSessions.userId, TEST_USER_ID));
    await db
      .delete(practiceSessions)
      .where(eq(practiceSessions.userId, TEST_USER_ID));
    // questions는 subjectId로 연결되어 있으므로 subjects 삭제 전에 처리
    const testSubjects = await db
      .select()
      .from(subjects)
      .where(eq(subjects.userId, TEST_USER_ID));
    for (const s of testSubjects) {
      await db.delete(questions).where(eq(questions.subjectId, s.id));
    }
    await db.delete(subjects).where(eq(subjects.userId, TEST_USER_ID));
  } catch {
    // DB 연결 실패 시 무시
  }
});

describeIfDb("Subject Management", () => {
  it("should create a subject", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const subject = await caller.subjects.create({
      name: "[TEST] 과목",
      color: "#3B82F6",
    });

    expect(subject).toBeDefined();
    expect(subject.name).toBe("[TEST] 과목");
    expect(subject.color).toBe("#3B82F6");
  });

  it("should list subjects", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const subjects = await caller.subjects.list();
    expect(Array.isArray(subjects)).toBe(true);
  });
});

describeIfDb("Question Management", () => {
  it("should create a question", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // First create a subject
    const subject = await caller.subjects.create({
      name: "[TEST] 수학",
      color: "#10B981",
    });

    const question = await caller.questions.create({
      subjectId: subject.id,
      question: "피타고라스 정리를 설명하시오",
      answer: "직각삼각형에서 빗변의 제곱은 다른 두 변의 제곱의 합과 같다",
      difficulty: "medium",
    });

    expect(question).toBeDefined();
    expect(question.question).toBe("피타고라스 정리를 설명하시오");
    expect(question.difficulty).toBe("medium");
  });

  it("should list all questions", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const questions = await caller.questions.listAll();
    expect(Array.isArray(questions)).toBe(true);
  });
});

describeIfDb("Practice Session", () => {
  it("should create a practice session", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create subject and question first
    const subject = await caller.subjects.create({
      name: "[TEST] 영어",
      color: "#8B5CF6",
    });

    const question = await caller.questions.create({
      subjectId: subject.id,
      question: "What is the capital of France?",
      answer: "Paris",
      difficulty: "easy",
    });

    const session = await caller.practice.create({
      questionId: question.id,
      duration: 120,
      typingSpeed: 45,
      accuracy: 95,
      errorCount: 3,
    });

    expect(session).toBeDefined();
    expect(session.duration).toBe(120);
    expect(session.accuracy).toBe(95);
  });

  it("should list practice sessions by user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const sessions = await caller.practice.getByUser();
    expect(Array.isArray(sessions)).toBe(true);
  });
});

describeIfDb("Test Session and Evaluation", () => {
  it("should evaluate an answer", { timeout: 15000 }, async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create subject and question
    const subject = await caller.subjects.create({
      name: "[TEST] 과학",
      color: "#EF4444",
    });

    const question = await caller.questions.create({
      subjectId: subject.id,
      question: "광합성의 과정을 설명하시오",
      answer:
        "식물이 빛 에너지를 이용하여 이산화탄소와 물로부터 포도당을 합성하고 산소를 방출하는 과정",
      difficulty: "hard",
    });

    const evaluation = await caller.test.evaluate({
      questionId: question.id,
      userAnswer: "식물이 빛을 이용해 포도당을 만드는 과정",
      recallTime: 60,
    });

    expect(evaluation).toBeDefined();
    expect(typeof evaluation.similarityScore).toBe("number");
    expect(typeof evaluation.isCorrect).toBe("boolean");
  });

  it("should list test sessions by user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const sessions = await caller.test.getByUser();
    expect(Array.isArray(sessions)).toBe(true);
  });
});

describeIfDb("Review Schedule", () => {
  it("should update review schedule after test", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create subject and question
    const subject = await caller.subjects.create({
      name: "[TEST] 역사",
      color: "#F59E0B",
    });

    const question = await caller.questions.create({
      subjectId: subject.id,
      question: "임진왜란의 원인을 설명하시오",
      answer:
        "일본의 도요토미 히데요시가 명나라 정복을 위한 길을 열기 위해 조선을 침략",
      difficulty: "medium",
    });

    const result = await caller.review.updateAfterReview({
      questionId: question.id,
      quality: 4,
    });

    expect(result).toBeDefined();
    expect(result.nextReviewDate).toBeInstanceOf(Date);
    expect(typeof result.interval).toBe("number");
  });

  it("should get due reviews", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const dueReviews = await caller.review.getDue();
    expect(Array.isArray(dueReviews)).toBe(true);
  });
});
