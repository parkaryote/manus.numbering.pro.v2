import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { transcribeAudio } from "./_core/voiceTranscription";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

// 글자 단위 유사도 계산 (대소문자 무시, 띄어쓰기 무시)
function calcCharSimilarity(userText: string, correctText: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const a = normalize(userText);
  const b = normalize(correctText);
  if (b.length === 0) return a.length === 0 ? 100 : 0;
  if (a.length === 0) return 0;
  // LCS 기반 유사도
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const lcsLen = dp[m][n];
  return Math.round((lcsLen / Math.max(m, n)) * 100);
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Demo mode - public access
  demo: router({
    subjects: publicProcedure.query(async () => {
      return db.getDemoSubjects();
    }),
    
    questions: publicProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ input }) => {
        return db.getDemoQuestions(input.subjectId);
      }),

    evaluate: publicProcedure
      .input(z.object({
        questionId: z.number(),
        userAnswer: z.string(),
        recallTime: z.number(),
      }))
      .mutation(async ({ input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question) {
          throw new Error("문제를 찾을 수 없습니다");
        }

        // 이미지 문제인 경우 imageLabels에서 정답 추출
        const isImageQuestion = question.imageUrl && question.imageLabels;
        let correctAnswer = question.answer || "";

        if (isImageQuestion) {
          try {
            const imageLabels = JSON.parse(question.imageLabels || "[]");
            correctAnswer = imageLabels.map((label: any, index: number) =>
              `${index + 1}. ${label.answer}`
            ).join("\n");
          } catch (e) {
            console.error("Failed to parse imageLabels:", e);
          }
        }

        // 이미지 문제 라벨별 채점
        if (isImageQuestion) {
          try {
            const imageLabels = JSON.parse(question.imageLabels || "[]");
            const userAnswerLines = input.userAnswer.split("\n");

            let correctCount = 0;
            const totalCount = imageLabels.length;
            const labelComparisons: any[] = [];

            for (let i = 0; i < totalCount; i++) {
              const correctAns = imageLabels[i]?.answer?.trim().toLowerCase() || "";
              const userAnswerLine = userAnswerLines[i] || "";
              const userAns = userAnswerLine.replace(/^\d+\.\s*/, "").trim().toLowerCase();
              const isLabelCorrect = userAns === correctAns;
              if (isLabelCorrect) correctCount++;

              labelComparisons.push({
                labelIndex: i + 1,
                correctAnswer: correctAns,
                userAnswer: userAns,
                isCorrect: isLabelCorrect
              });
            }

            const accuracyRate = Math.round((correctCount / totalCount) * 100);
            const isCorrect = accuracyRate === 100;

            return {
              isCorrect,
              similarityScore: accuracyRate,
              accuracyRate,
              mistakes: labelComparisons,
              feedback: isCorrect ? "정확하게 작성하셨습니다!" : `${correctCount}/${totalCount} 정답`,
              missingKeywords: [],
            };
          } catch (e) {
            console.error("Failed to grade image question:", e);
          }
        }

        // 텍스트 문제 줄 단위 채점
        const userLines = input.userAnswer.split('\n').map(line => line.trim());
        const correctLines = correctAnswer.split('\n').map(line => line.trim());

        const lineComparisons: any[] = [];
        let correctLineCount = 0;
        const totalLines = correctLines.length;

        for (let i = 0; i < totalLines; i++) {
          const correctLine = correctLines[i].toLowerCase().replace(/\s+/g, "");
          const userLine = (userLines[i] || "").toLowerCase().replace(/\s+/g, "");
          const isLineCorrect = userLine === correctLine;
          if (isLineCorrect) correctLineCount++;

          lineComparisons.push({
            lineIndex: i + 1,
            correctAnswer: correctLines[i],
            userAnswer: userLines[i] || "",
            isCorrect: isLineCorrect
          });
        }

        const isCorrect = correctLineCount === totalLines && userLines.length === totalLines;
        const accuracyRate = totalLines > 0 ? Math.round((correctLineCount / totalLines) * 100) : 0;
        const similarityScore = calcCharSimilarity(input.userAnswer, correctAnswer);

        return {
          isCorrect,
          similarityScore,
          accuracyRate,
          correctLineCount,
          totalLines,
          mistakes: lineComparisons,
          feedback: isCorrect ? "정확하게 작성하셨습니다!" : `${correctLineCount}/${totalLines} 줄 정답`,
          missingKeywords: [],
        };
      }),
  }),

  // Subject management
  subjects: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getSubjectsByUserId(ctx.user.id);
    }),
    
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getSubjectById(input.id);
      }),
    
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        color: z.string().optional(),
        examEndDate: z.string().optional(), // ISO date string
      }))
      .mutation(async ({ ctx, input }) => {
        return db.createSubject({
          userId: ctx.user.id,
          name: input.name,
          description: input.description,
          color: input.color,
          examEndDate: input.examEndDate ? new Date(input.examEndDate) : undefined,
        });
      }),
    
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        color: z.string().optional(),
        examEndDate: z.string().nullable().optional(), // ISO date string or null to clear
      }))
      .mutation(async ({ input }) => {
        const { id, examEndDate, ...data } = input;
        const updateData: any = { ...data };
        if (examEndDate !== undefined) {
          updateData.examEndDate = examEndDate ? new Date(examEndDate) : null;
        }
        return db.updateSubject(id, updateData);
      }),
    
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return db.deleteSubject(input.id);
      }),
    
    updateOrder: protectedProcedure
      .input(z.object({
        subjectOrders: z.array(z.object({
          id: z.number(),
          displayOrder: z.number(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.updateSubjectOrder(ctx.user.id, input.subjectOrders);
      }),
  }),

  // Question management
  questions: router({
    listBySubject: protectedProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ input }) => {
        return db.getQuestionsBySubjectId(input.subjectId);
      }),
    
    listAll: protectedProcedure.query(async ({ ctx }) => {
      return db.getQuestionsByUserId(ctx.user.id);
    }),
    
    count: protectedProcedure.query(async ({ ctx }) => {
      return db.countQuestionsByUserId(ctx.user.id);
    }),
    
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const question = await db.getQuestionById(input.id);
        // Allow access to demo questions without auth
        if (question?.isDemo) {
          return question;
        }
        // Require auth for non-demo questions
        if (!ctx.user) {
          throw new TRPCError({ code: 'UNAUTHORIZED' });
        }
        return question;
      }),
    
    create: protectedProcedure
      .input(z.object({
        subjectId: z.number(),
        question: z.string().min(1),
        answer: z.string().optional(),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        imageUrl: z.string().optional(),
        imageLabels: z.string().optional(),
        autoNumbering: z.number().optional(),
        tableData: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.createQuestion({
          userId: ctx.user.id,
          subjectId: input.subjectId,
          question: input.question,
          answer: input.answer || "",
          difficulty: input.difficulty,
          imageUrl: input.imageUrl,
          imageLabels: input.imageLabels,
          autoNumbering: input.autoNumbering,
          tableData: input.tableData,
        });
      }),
    
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        question: z.string().min(1).optional(),
        answer: z.string().optional(),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        imageUrl: z.string().optional(),
        imageLabels: z.string().optional(),
        autoNumbering: z.number().optional(),
        tableData: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return db.updateQuestion(id, data);
      }),
    
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return db.deleteQuestion(input.id);
      }),
    
    updateOrder: protectedProcedure
      .input(z.object({
        questionOrders: z.array(z.object({
          id: z.number(),
          displayOrder: z.number(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.updateQuestionOrder(ctx.user.id, input.questionOrders);
      }),
    
    copy: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        targetSubjectId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.copyQuestion(ctx.user.id, input.questionId, input.targetSubjectId);
      }),
    
    move: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        targetSubjectId: z.number(),
      }))
      .mutation(async ({ input }) => {
        return db.moveQuestion(input.questionId, input.targetSubjectId);
      }),
  }),

  // Practice session management
  practice: router({
    getByQuestion: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ input }) => {
        return db.getPracticeSessionsByQuestionId(input.questionId);
      }),
    
    getByUser: protectedProcedure.query(async ({ ctx }) => {
      return db.getPracticeSessionsByUserId(ctx.user.id);
    }),
    
    getBySubject: protectedProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getPracticeSessionsBySubjectId(ctx.user.id, input.subjectId);
      }),
    
    create: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        duration: z.number(),
        typingSpeed: z.number(),
        accuracy: z.number(),
        errorCount: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.createPracticeSession({
          userId: ctx.user.id,
          questionId: input.questionId,
          duration: input.duration,
          typingSpeed: input.typingSpeed,
          accuracy: input.accuracy,
          errorCount: input.errorCount,
        });
      }),
    
    deleteAll: protectedProcedure
      .mutation(async ({ ctx }) => {
        return db.deleteAllPracticeSessions(ctx.user.id);
      }),
    
    countByQuestion: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ ctx, input }) => {
        const sessions = await db.getPracticeSessionsByQuestionId(input.questionId);
        return { count: sessions.length };
      })
  }),

  // Voice transcription
  voice: router({
    transcribe: protectedProcedure
      .input(z.object({
        audioUrl: z.string(),
      }))
      .mutation(async ({ input }) => {
        try {
          const result = await transcribeAudio({
            audioUrl: input.audioUrl,
            language: "ko",
          });
          
          if ("error" in result) {
            throw new Error(result.error);
          }
          
          return { text: result.text };
        } catch (error) {
          console.error("Transcription error:", error);
          throw new Error("음성 변환에 실패했습니다");
        }
      }),
  }),

  // Test session management
  test: router({
    getByQuestion: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ input }) => {
        return db.getTestSessionsByQuestionId(input.questionId);
      }),
    
    getByUser: protectedProcedure.query(async ({ ctx }) => {
      return db.getTestSessionsByUserId(ctx.user.id);
    }),
    
    create: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        userAnswer: z.string(),
        isCorrect: z.number(),
        recallTime: z.number(),
        similarityScore: z.number().optional(),
        mistakeHighlights: z.string().optional(),
        llmFeedback: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.createTestSession({
          userId: ctx.user.id,
          questionId: input.questionId,
          userAnswer: input.userAnswer,
          isCorrect: input.isCorrect,
          recallTime: input.recallTime,
          similarityScore: input.similarityScore,
          mistakeHighlights: input.mistakeHighlights,
          llmFeedback: input.llmFeedback,
        });
      }),
    
    evaluate: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        userAnswer: z.string(),
        recallTime: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question) {
          throw new Error("문제를 찾을 수 없습니다");
        }

        // 이미지 문제인 경우 imageLabels에서 정답 추출
        const isImageQuestion = question.imageUrl && question.imageLabels;
        let correctAnswer = question.answer || "";
        
        if (isImageQuestion) {
          try {
            const imageLabels = JSON.parse(question.imageLabels || "[]");
            // 각 라벨의 정답을 합쳐서 정답 문자열 생성
            correctAnswer = imageLabels.map((label: any, index: number) => 
              `${index + 1}. ${label.answer}`
            ).join("\n");
            console.log("[DEBUG] Image question detected");
            console.log("[DEBUG] correctAnswer:", correctAnswer);
            console.log("[DEBUG] userAnswer:", input.userAnswer);
          } catch (e) {
            console.error("Failed to parse imageLabels:", e);
          }
        }
        
        console.log("[DEBUG] useAIGrading:", question.useAIGrading);

        // Check if AI grading is enabled for this question
        if (!question.useAIGrading) {
          // 이미지 문제인 경우 라벨별로 채점
          if (isImageQuestion) {
            try {
              const imageLabels = JSON.parse(question.imageLabels || "[]");
              const userAnswerLines = input.userAnswer.split("\n");
              
              let correctCount = 0;
              const totalCount = imageLabels.length;
              const labelComparisons: any[] = [];
              
              for (let i = 0; i < totalCount; i++) {
                const correctAnswer = imageLabels[i]?.answer?.trim().toLowerCase() || "";
                const userAnswerLine = userAnswerLines[i] || "";
                const userAnswer = userAnswerLine.replace(/^\d+\.\s*/, "").trim().toLowerCase();
                
                console.log(`[DEBUG] Label ${i + 1}: correct="${correctAnswer}", user="${userAnswer}"`);
                
                const isLabelCorrect = userAnswer === correctAnswer;
                if (isLabelCorrect) {
                  correctCount++;
                }
                
                labelComparisons.push({
                  labelIndex: i + 1,
                  correctAnswer,
                  userAnswer,
                  isCorrect: isLabelCorrect
                });
              }
              
              const accuracyRate = Math.round((correctCount / totalCount) * 100);
              const isCorrect = accuracyRate === 100;
              
              console.log(`[DEBUG] Image question grading: ${correctCount}/${totalCount} correct, accuracy: ${accuracyRate}%`);
              
              // Save test session
              await db.createTestSession({
                userId: ctx.user.id,
                questionId: input.questionId,
                userAnswer: input.userAnswer,
                isCorrect: isCorrect ? 1 : 0,
                recallTime: input.recallTime,
                similarityScore: accuracyRate,
                mistakeHighlights: JSON.stringify(labelComparisons),
                llmFeedback: null,
              });
              
              return {
                isCorrect,
                similarityScore: accuracyRate,
                accuracyRate,
                mistakes: labelComparisons,
                feedback: isCorrect ? "정확하게 작성하셨습니다!" : `${correctCount}/${totalCount} 정답`,
                missingKeywords: [],
              };
            } catch (e) {
              console.error("Failed to grade image question:", e);
            }
          }
          
          // Line-by-line comparison for text questions
          const userLines = input.userAnswer.split('\n').map(line => line.trim());
          const correctLines = correctAnswer.split('\n').map(line => line.trim());
          
          // Compare each line and build lineComparisons array
          const lineComparisons: any[] = [];
          let correctLineCount = 0;
          const totalLines = correctLines.length;
          
          for (let i = 0; i < totalLines; i++) {
            const correctLine = correctLines[i].toLowerCase().replace(/\s+/g, "");
            const userLine = (userLines[i] || "").toLowerCase().replace(/\s+/g, "");
            const isLineCorrect = userLine === correctLine;
            
            if (isLineCorrect) {
              correctLineCount++;
            }
            
            lineComparisons.push({
              lineIndex: i + 1,
              correctAnswer: correctLines[i],
              userAnswer: userLines[i] || "",
              isCorrect: isLineCorrect
            });
          }
          
          // Check if all lines match (exact correctness)
          const isCorrect = correctLineCount === totalLines && userLines.length === totalLines;
          
          // Calculate accuracy rate based on correct lines
          const accuracyRate = totalLines > 0 ? Math.round((correctLineCount / totalLines) * 100) : 0;
          // Calculate character-level similarity
          const similarityScore = calcCharSimilarity(input.userAnswer, correctAnswer);
          
          console.log("[DEBUG] Line-by-line comparison mode");
          console.log("[DEBUG] correctLineCount:", correctLineCount, "/", totalLines);
          console.log("[DEBUG] isCorrect:", isCorrect);
          console.log("[DEBUG] accuracyRate:", accuracyRate);
          console.log("[DEBUG] similarityScore:", similarityScore);
          
          // Save test session
          await db.createTestSession({
            userId: ctx.user.id,
            questionId: input.questionId,
            userAnswer: input.userAnswer,
            isCorrect: isCorrect ? 1 : 0,
            recallTime: input.recallTime,
            similarityScore,
            mistakeHighlights: JSON.stringify(lineComparisons),
            llmFeedback: null,
          });
          
          return {
            isCorrect,
            similarityScore,
            accuracyRate,
            correctLineCount,
            totalLines,
            mistakes: lineComparisons,
            feedback: isCorrect ? "정확하게 작성하셨습니다!" : `${correctLineCount}/${totalLines} 줄 정답`,
            missingKeywords: [],
          };
        }

        // Deduct AI credit
        try {
          await db.deductAICredits(ctx.user.id, 1);
        } catch (error: any) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message || "AI 크레딧이 부족합니다. 설정에서 충전하세요.",
          });
        }

        // LLM-based evaluation
        const evaluationPrompt = `다음 서술형 문제의 모범 답안과 학생 답안을 비교하여 평가해주세요.

**문제:**
${question.question}

**모범 답안:**
${correctAnswer}

**학생 답안:**
${input.userAnswer}

다음 형식으로 JSON으로 답변해주세요:
{
  "isCorrect": true/false,
  "similarityScore": 0-100 사이의 점수,
  "mistakes": [
    {
      "type": "오류 유형 (예: 키워드 누락, 논리적 오류, 부정확한 표현)",
      "description": "구체적인 오류 설명",
      "position": "오류 위치"
    }
  ],
  "feedback": "개선 제안 및 피드백 (한글로)",
  "missingKeywords": ["누락된 핵심 키워드 목록"]
}`;

        try {
          const llmResponse = await invokeLLM({
            messages: [
              { role: "system", content: "당신은 교육 평가 전문가입니다. 학생의 서술형 답안을 의미적으로 분석하고 건설적인 피드백을 제공합니다." },
              { role: "user", content: evaluationPrompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "answer_evaluation",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    isCorrect: { type: "boolean" },
                    similarityScore: { type: "integer" },
                    mistakes: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type: { type: "string" },
                          description: { type: "string" },
                          position: { type: "string" },
                        },
                        required: ["type", "description", "position"],
                        additionalProperties: false,
                      },
                    },
                    feedback: { type: "string" },
                    missingKeywords: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["isCorrect", "similarityScore", "mistakes", "feedback", "missingKeywords"],
                  additionalProperties: false,
                },
              },
            },
          });

          const content = llmResponse.choices[0]?.message?.content;
          const contentStr = typeof content === "string" ? content : JSON.stringify(content);
          const evaluation = JSON.parse(contentStr || "{}");
          const isCorrect = evaluation.isCorrect ? 1 : 0;
          const similarityScore = evaluation.similarityScore || 0;
          const mistakeHighlights = JSON.stringify(evaluation.mistakes || []);
          const llmFeedback = evaluation.feedback || "";

          // Save test session
          await db.createTestSession({
            userId: ctx.user.id,
            questionId: input.questionId,
            userAnswer: input.userAnswer,
            isCorrect,
            recallTime: input.recallTime,
            similarityScore,
            mistakeHighlights,
            llmFeedback,
          });

          return {
            isCorrect,
            similarityScore,
            accuracyRate: similarityScore,
            mistakeHighlights,
            llmFeedback,
            missingKeywords: evaluation.missingKeywords || [],
          };
        } catch (error) {
          console.error("LLM evaluation error:", error);
          
          // Fallback to simple comparison (use correctAnswer from above)
          const correctAnswerNormalized = correctAnswer.trim().toLowerCase();
          const userAnswerNormalized = input.userAnswer.trim().toLowerCase();
          const isCorrect = correctAnswerNormalized === userAnswerNormalized ? 1 : 0;
          const similarityScore = Math.round(
            (1 - (Math.abs(correctAnswerNormalized.length - userAnswerNormalized.length) / Math.max(correctAnswerNormalized.length, userAnswerNormalized.length))) * 100
          );

          await db.createTestSession({
            userId: ctx.user.id,
            questionId: input.questionId,
            userAnswer: input.userAnswer,
            isCorrect,
            recallTime: input.recallTime,
            similarityScore,
            mistakeHighlights: null,
            llmFeedback: null,
          });

          return {
            isCorrect,
            similarityScore,
            accuracyRate: similarityScore,
            mistakeHighlights: null,
            llmFeedback: "LLM 평가를 사용할 수 없어 기본 평가를 사용했습니다.",
          };
        }
      }),
    
    deleteAll: protectedProcedure
      .mutation(async ({ ctx }) => {
        return db.deleteAllTestSessions(ctx.user.id);
      }),
  }),

  // Review schedule management
  review: router({
    getByUser: protectedProcedure.query(async ({ ctx }) => {
      return db.getReviewSchedulesByUserId(ctx.user.id);
    }),
    
    getDue: protectedProcedure.query(async ({ ctx }) => {
      const schedules = await db.getReviewSchedulesByUserId(ctx.user.id);
      const now = new Date();
      return schedules.filter(s => s.nextReviewDate <= now);
    }),
    
    getByQuestion: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getReviewScheduleByQuestionId(input.questionId, ctx.user.id);
      }),
    
    create: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        nextReviewDate: z.date(),
        repetitionCount: z.number().optional(),
        easeFactor: z.number().optional(),
        interval: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.createReviewSchedule({
          userId: ctx.user.id,
          questionId: input.questionId,
          nextReviewDate: input.nextReviewDate,
          repetitionCount: input.repetitionCount,
          easeFactor: input.easeFactor,
          interval: input.interval,
        });
      }),
    
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        nextReviewDate: z.date().optional(),
        repetitionCount: z.number().optional(),
        easeFactor: z.number().optional(),
        interval: z.number().optional(),
        lastReviewedAt: z.date().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return db.updateReviewSchedule(id, data);
      }),
    
    // SM-2 algorithm for spaced repetition
    updateAfterReview: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        quality: z.number().min(0).max(5), // 0-5 quality rating
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await db.getReviewScheduleByQuestionId(input.questionId, ctx.user.id);
        
        let repetitionCount = 0;
        let easeFactor = 250; // 2.5 * 100
        let interval = 1;
        
        if (existing) {
          repetitionCount = existing.repetitionCount || 0;
          easeFactor = existing.easeFactor || 250;
          interval = existing.interval || 1;
        }
        
        // SM-2 algorithm
        if (input.quality >= 3) {
          if (repetitionCount === 0) {
            interval = 1;
          } else if (repetitionCount === 1) {
            interval = 6;
          } else {
            interval = Math.round(interval * (easeFactor / 100));
          }
          repetitionCount += 1;
        } else {
          repetitionCount = 0;
          interval = 1;
        }
        
        easeFactor = easeFactor + (80 - 50 * (5 - input.quality));
        if (easeFactor < 130) easeFactor = 130;
        
        const nextReviewDate = new Date();
        nextReviewDate.setDate(nextReviewDate.getDate() + interval);
        
        if (existing) {
          await db.updateReviewSchedule(existing.id, {
            nextReviewDate,
            repetitionCount,
            easeFactor,
            interval,
            lastReviewedAt: new Date(),
          });
        } else {
          await db.createReviewSchedule({
            userId: ctx.user.id,
            questionId: input.questionId,
            nextReviewDate,
            repetitionCount,
            easeFactor,
            interval,
            lastReviewedAt: new Date(),
          });
        }
        
        return { nextReviewDate, interval };
      }),
  }),

  // Expiring questions management
  expiring: router({
    // 만료 예정 문제 조회 (1달 이내 삭제 예정)
    getQuestions: protectedProcedure.query(async ({ ctx }) => {
      return db.getExpiringQuestions(ctx.user.id);
    }),
    
    // 만료된 문제 자동 삭제
    cleanup: protectedProcedure.mutation(async () => {
      return db.deleteExpiredQuestions();
    }),
  }),
});

export type AppRouter = typeof appRouter;
