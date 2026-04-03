import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

// 테스트 전용 userId - 실제 사용자(id=1) 데이터에 영향 없음
const TEST_USER_ID = 99999;

function createTestContext(userId: number = TEST_USER_ID): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
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
    res: {} as TrpcContext["res"],
  };

  return ctx;
}

describe("Statistics Reset", () => {
  beforeEach(() => {
    // deleteAll은 실제 DB를 건드리지 않도록 mock 처리
    vi.spyOn(db, "deleteAllPracticeSessions").mockResolvedValue(undefined as any);
    vi.spyOn(db, "deleteAllTestSessions").mockResolvedValue(undefined as any);
    vi.spyOn(db, "getPracticeSessionsByUserId").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have deleteAll mutation for practice sessions", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // deleteAll은 mock되어 있으므로 실제 DB 데이터에 영향 없음
    // mock이 undefined를 반환하므로 에러 없이 완료되면 성공
    await expect(caller.practice.deleteAll()).resolves.not.toThrow();
  });

  it("should have deleteAll mutation for test sessions", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // deleteAll은 mock되어 있으므로 실제 DB 데이터에 영향 없음
    await expect(caller.test.deleteAll()).resolves.not.toThrow();
  });

  it("should get practice sessions by user", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const sessions = await caller.practice.getByUser();
    expect(Array.isArray(sessions)).toBe(true);
  });
});
