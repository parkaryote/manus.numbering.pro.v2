import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(userId: number = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
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
    res: {} as TrpcContext["res"],
  };

  return ctx;
}

describe("Statistics Reset", () => {

  it("should have deleteAll mutation for practice sessions", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Test that deleteAll mutation exists and can be called
    const result = await caller.practice.deleteAll();
    
    // Result should be defined (returns delete result from database)
    expect(result).toBeDefined();
  });

  it("should have deleteAll mutation for test sessions", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Test that deleteAll mutation exists and can be called
    const result = await caller.test.deleteAll();
    
    // Result should be defined (returns delete result from database)
    expect(result).toBeDefined();
  });

  it("should get practice sessions by user", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Get all practice sessions
    const sessions = await caller.practice.getByUser();
    
    // Should return an array
    expect(Array.isArray(sessions)).toBe(true);
    
    // Each session should have duration field
    if (sessions.length > 0) {
      expect(sessions[0]).toHaveProperty("duration");
      expect(typeof sessions[0].duration).toBe("number");
    }
  });
});
