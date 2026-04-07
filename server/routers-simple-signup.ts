import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { publicProcedure, router } from "./_core/trpc";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";

/**
 * 초기 안정도 데이터 생성
 * 문제 길이와 난이도를 고려하여 realistic한 초기값 설정
 */
async function createInitialDataForUser(userId: number) {
  // 1. 초기 과목 생성
  const subject1 = await db.createSubject({
    userId,
    name: "영어 단어",
    description: "일상 영어 단어 암기",
    color: "#3B82F6",
    displayOrder: 1,
  });

  const subject2 = await db.createSubject({
    userId,
    name: "한국사",
    description: "한국사 시험 대비",
    color: "#EF4444",
    displayOrder: 2,
  });

  const subject3 = await db.createSubject({
    userId,
    name: "수학 공식",
    description: "수학 공식 및 정리",
    color: "#10B981",
    displayOrder: 3,
  });

  // 2. 각 과목별 문제 생성 및 초기 안정도 설정
  await createSubjectQuestionsWithData(userId, subject1.id, "short");
  await createSubjectQuestionsWithData(userId, subject2.id, "medium");
  await createSubjectQuestionsWithData(userId, subject3.id, "long");
}

/**
 * 문제 길이별 초기 데이터 생성
 */
async function createSubjectQuestionsWithData(
  userId: number,
  subjectId: number,
  length: "short" | "medium" | "long"
) {
  const questionTemplates = {
    short: [
      { q: "apple", a: "사과" },
      { q: "book", a: "책" },
      { q: "cat", a: "고양이" },
      { q: "dog", a: "개" },
      { q: "tree", a: "나무" },
    ],
    medium: [
      { q: "삼국통일을 이룬 왕은?", a: "신문왕" },
      { q: "한글을 창제한 왕은?", a: "세종대왕" },
      { q: "임진왜란을 격퇴한 장군은?", a: "이순신" },
      { q: "조선을 건국한 인물은?", a: "이성계" },
      { q: "한반도 최초의 국가는?", a: "고조선" },
    ],
    long: [
      { q: "이차방정식의 근의 공식은?", a: "x = (-b ± √(b²-4ac)) / 2a" },
      { q: "삼각함수 sin²θ + cos²θ = ?", a: "1" },
      { q: "원의 넓이 공식은?", a: "πr²" },
      { q: "피타고라스 정리는?", a: "a² + b² = c²" },
      { q: "등차수열의 합 공식은?", a: "Sn = n(a₁ + aₙ)/2" },
    ],
  };

  const templates = questionTemplates[length];
  const now = new Date();

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    const question = await db.createQuestion({
      userId,
      subjectId,
      question: template.q,
      answer: template.a,
      difficulty: length === "short" ? "easy" : length === "medium" ? "medium" : "hard",
      displayOrder: i + 1,
      isDemo: 0,
    });

    // 초기 연습 세션 생성 (realistic한 데이터)
    const practiceCount = length === "short" ? 5 : length === "medium" ? 3 : 2;
    for (let j = 0; j < practiceCount; j++) {
      const daysAgo = Math.floor(Math.random() * 14);
      const sessionDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      await db.createPracticeSession({
        userId,
        questionId: question.id,
        duration: length === "short" ? 10 + Math.random() * 20 : length === "medium" ? 30 + Math.random() * 40 : 50 + Math.random() * 60,
        typingSpeed: length === "short" ? 300 + Math.random() * 100 : length === "medium" ? 250 + Math.random() * 100 : 200 + Math.random() * 80,
        accuracy: 80 + Math.random() * 20, // 80-100% 정확도
        errorCount: Math.floor(Math.random() * 3),
        completedAt: sessionDate,
      });
    }

    // 초기 시험 세션 생성
    const testCount = length === "short" ? 3 : length === "medium" ? 2 : 1;
    for (let j = 0; j < testCount; j++) {
      const daysAgo = Math.floor(Math.random() * 7);
      const sessionDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      await db.createTestSession({
        userId,
        questionId: question.id,
        userAnswer: template.a,
        isCorrect: Math.random() > 0.15 ? 1 : 0, // 85% 정답률
        similarityScore: 85 + Math.random() * 15,
        recallTime: length === "short" ? 1500 + Math.random() * 2000 : length === "medium" ? 3500 + Math.random() * 4000 : 5500 + Math.random() * 6000,
        completedAt: sessionDate,
      });
    }
  }
}

export const simpleSignupRouter = router({
  signup: publicProcedure
    .input(z.object({ password: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (ENV.signupAccessPassword && input.password !== ENV.signupAccessPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "비밀번호가 일치하지 않습니다",
        });
      }

      // 고유한 openId 생성 (간편 가입용)
      const simpleOpenId = `simple_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

      // 사용자 생성
      await db.upsertUser({
        openId: simpleOpenId,
        name: `사용자_${Date.now().toString().slice(-6)}`,
        email: null,
        loginMethod: "simple",
        lastSignedIn: new Date(),
      });

      // 사용자 조회
      const user = await db.getUserByOpenId(simpleOpenId);
      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "사용자 생성 실패",
        });
      }

      // 초기 데이터 생성
      await createInitialDataForUser(user.id);

      // 세션 토큰 생성
      const sessionToken = await sdk.createSessionToken(simpleOpenId, {
        name: user.name || "사용자",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      return { success: true, userId: user.id };
    }),
});
