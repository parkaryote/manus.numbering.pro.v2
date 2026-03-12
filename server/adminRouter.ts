import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";

// 관리자 권한 확인 미들웨어
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "관리자만 접근할 수 있습니다",
    });
  }
  return next({ ctx });
});



export const adminRouter = router({
  // 데모 과목 관리
  demo: router({
    // 모든 데모 과목 조회
    subjects: adminProcedure.query(async () => {
      return db.getAllDemoSubjects();
    }),

    // 모든 데모 문제 조회 (과목 선택 여부와 관계없이)
    allQuestions: adminProcedure.query(async () => {
      return await db.getAllDemoQuestions();
    }),

    // 데모 과목의 기본 문제 조회
    questions: adminProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ input }) => {
        return db.getDemoQuestionsBySubjectId(input.subjectId);
      }),

    // 데모 문제 수정
    updateQuestion: adminProcedure
      .input(
        z.object({
          questionId: z.number(),
          question: z.string(),
          answer: z.string(),
          imageUrl: z.string().optional(),
          imageLabels: z.string().optional(),
          useAIGrading: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const updated = await db.updateDemoQuestion(
          input.questionId,
          {
            question: input.question,
            answer: input.answer,
            imageUrl: input.imageUrl,
            imageLabels: input.imageLabels,
            useAIGrading: input.useAIGrading,
          }
        );
        
        // 캐시 무효화 신호 (클라이언트가 데이터 새로고침하도록)
        return {
          success: true,
          data: updated,
          cacheInvalidated: true,
        };
      }),

    // 데모 문제 삭제
    deleteQuestion: adminProcedure
      .input(z.object({ questionId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteDemoQuestion(input.questionId);
        return {
          success: true,
          cacheInvalidated: true,
        };
      }),

    // 데모 문제 생성
    createQuestion: adminProcedure
      .input(
        z.object({
          subjectId: z.number(),
          question: z.string(),
          answer: z.string(),
          imageUrl: z.string().optional(),
          imageLabels: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const created = await db.createDemoQuestion({
          subjectId: input.subjectId,
          userId: ctx.user.id,
          question: input.question,
          answer: input.answer,
          imageUrl: input.imageUrl,
          imageLabels: input.imageLabels,
          isDemo: 1,
        });
        
        return {
          success: true,
          data: created,
          cacheInvalidated: true,
        };
      }),
  }),
});
