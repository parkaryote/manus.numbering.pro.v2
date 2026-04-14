import { protectedProcedure, router } from "./_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db.js";
import { ENV } from "./_core/env.js";

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

function assertDemoPublishingEnabled() {
  if (!ENV.allowDemoPublishing) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "데모 공개는 잠금 상태입니다. ALLOW_DEMO_PUBLISHING=true 설정 후 시도하세요.",
    });
  }
}


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
          tableData: z.string().optional(),
          autoNumbering: z.number().optional(),
          useAIGrading: z.number().optional(),
          isStarred: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const target = await db.getQuestionById(input.questionId);
        if (!target || target.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 문제를 찾을 수 없습니다",
          });
        }
        const updated = await db.updateDemoQuestion(
          input.questionId,
          {
            question: input.question,
            answer: input.answer,
            imageUrl: input.imageUrl,
            imageLabels: input.imageLabels,
            tableData: input.tableData,
            autoNumbering: input.autoNumbering,
            useAIGrading: input.useAIGrading,
            isStarred: input.isStarred,
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
        const target = await db.getQuestionById(input.questionId);
        if (!target || target.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 문제를 찾을 수 없습니다",
          });
        }
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
          answer: z.string().optional().default(""),
          imageUrl: z.string().optional(),
          imageLabels: z.string().optional(),
          tableData: z.string().optional(),
          autoNumbering: z.number().optional().default(1),
          difficulty: z.enum(["easy", "medium", "hard"]).optional().default("medium"),
          isStarred: z.number().optional().default(0),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertDemoPublishingEnabled();
        const created = await db.createDemoQuestion({
          subjectId: input.subjectId,
          userId: ctx.user.id,
          question: input.question,
          answer: input.answer ?? "",
          imageUrl: input.imageUrl,
          imageLabels: input.imageLabels,
          tableData: input.tableData,
          autoNumbering: input.autoNumbering ?? 1,
          difficulty: input.difficulty ?? "medium",
          isStarred: input.isStarred ?? 0,
          isDemo: 1,
        });
        
        return {
          success: true,
          data: created,
          cacheInvalidated: true,
        };
      }),

    // 데모 과목 생성
    createSubject: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().optional().default(""),
          color: z.string().optional().default("#3B82F6"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertDemoPublishingEnabled();
        const created = await db.createDemoSubject({
          userId: ctx.user.id,
          name: input.name,
          description: input.description ?? "",
          color: input.color ?? "#3B82F6",
          isDemo: 1,
          displayOrder: 0,
        });
        return { success: true, data: created };
      }),

    // 데모 과목 수정
    updateSubject: adminProcedure
      .input(
        z.object({
          subjectId: z.number(),
          name: z.string().min(1),
          description: z.string().optional(),
          color: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const target = await db.getSubjectById(input.subjectId);
        if (!target || target.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 과목을 찾을 수 없습니다",
          });
        }
        const updated = await db.updateDemoSubject(input.subjectId, {
          name: input.name,
          description: input.description,
          color: input.color,
        });
        return { success: true, data: updated };
      }),

    // 데모 과목 삭제
    deleteSubject: adminProcedure
      .input(z.object({ subjectId: z.number() }))
      .mutation(async ({ input }) => {
        const target = await db.getSubjectById(input.subjectId);
        if (!target || target.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 과목을 찾을 수 없습니다",
          });
        }
        await db.deleteDemoSubject(input.subjectId);
        return { success: true };
      }),

    // 과목 isDemo 토글 (0 ↔ 1)
    toggleSubjectDemo: adminProcedure
      .input(z.object({ subjectId: z.number(), isDemo: z.number() }))
      .mutation(async ({ input }) => {
        if (input.isDemo === 1) {
          assertDemoPublishingEnabled();
        }
        await db.updateSubjectIsDemo(input.subjectId, input.isDemo);
        return { success: true };
      }),

    // 문제 isDemo 토글 (0 ↔ 1)
    toggleQuestionDemo: adminProcedure
      .input(z.object({ questionId: z.number(), isDemo: z.number() }))
      .mutation(async ({ input }) => {
        if (input.isDemo === 1) {
          assertDemoPublishingEnabled();
        }
        await db.updateQuestionIsDemo(input.questionId, input.isDemo);
        return { success: true };
      }),

    // 문제 중요 표시 토글
    toggleQuestionStar: adminProcedure
      .input(z.object({ questionId: z.number() }))
      .mutation(async ({ input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 문제를 찾을 수 없습니다",
          });
        }
        await db.updateDemoQuestion(input.questionId, {
          isStarred: question.isStarred ? 0 : 1,
        });
        return { success: true };
      }),
  }),
});
