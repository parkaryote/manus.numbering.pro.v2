import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
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

describe("Subject Management", () => {
  it("should create a subject", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const subject = await caller.subjects.create({
      name: "테스트 과목",
      color: "#3B82F6",
    });

    expect(subject).toBeDefined();
    expect(subject.name).toBe("테스트 과목");
    expect(subject.color).toBe("#3B82F6");
  });

  it("should list subjects", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const subjects = await caller.subjects.list();
    expect(Array.isArray(subjects)).toBe(true);
  });
});

describe("Question Management", () => {
  it("should create a question", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // First create a subject
    const subject = await caller.subjects.create({
      name: "수학",
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

describe("Practice Session", () => {
  it("should create a practice session", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create subject and question first
    const subject = await caller.subjects.create({
      name: "영어",
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

describe("Test Session and Evaluation", () => {
  it("should evaluate an answer", { timeout: 15000 }, async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create subject and question
    const subject = await caller.subjects.create({
      name: "과학",
      color: "#EF4444",
    });

    const question = await caller.questions.create({
      subjectId: subject.id,
      question: "광합성의 과정을 설명하시오",
      answer: "식물이 빛 에너지를 이용하여 이산화탄소와 물로부터 포도당을 합성하고 산소를 방출하는 과정",
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

describe("Review Schedule", () => {
  it("should update review schedule after test", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create subject and question
    const subject = await caller.subjects.create({
      name: "역사",
      color: "#F59E0B",
    });

    const question = await caller.questions.create({
      subjectId: subject.id,
      question: "임진왜란의 원인을 설명하시오",
      answer: "일본의 도요토미 히데요시가 명나라 정복을 위한 길을 열기 위해 조선을 침략",
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
