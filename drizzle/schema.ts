import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  aiCreditBalance: int("aiCreditBalance").default(100).notNull(), // AI grading credits
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 과목 테이블 - 문제를 과목별로 분류
 */
export const subjects = mysqlTable("subjects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 7 }).default("#3B82F6"),
  displayOrder: int("displayOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Subject = typeof subjects.$inferSelect;
export type InsertSubject = typeof subjects.$inferInsert;

/**
 * 문제 테이블 - 질문과 정답 저장
 */
export const questions = mysqlTable("questions", {
  id: int("id").autoincrement().primaryKey(),
  subjectId: int("subjectId").notNull(),
  userId: int("userId").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  imageUrl: text("imageUrl"), // Optional image attachment
  imageLabels: text("imageLabels"), // JSON array of {x, y, width, height, answer}
  useAIGrading: int("useAIGrading").default(0).notNull(), // 0: disabled, 1: enabled
  difficulty: mysqlEnum("difficulty", ["easy", "medium", "hard"]).default("medium"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Question = typeof questions.$inferSelect;
export type InsertQuestion = typeof questions.$inferInsert;

/**
 * 연습 세션 테이블 - 타이핑 연습 기록
 */
export const practiceSessions = mysqlTable("practiceSessions", {
  id: int("id").autoincrement().primaryKey(),
  questionId: int("questionId").notNull(),
  userId: int("userId").notNull(),
  duration: int("duration").notNull(), // 초 단위
  typingSpeed: int("typingSpeed").notNull(), // CPM (Characters Per Minute)
  accuracy: int("accuracy").notNull(), // 정확도 퍼센트 (0-100)
  errorCount: int("errorCount").notNull(),
  completedAt: timestamp("completedAt").defaultNow().notNull(),
});

export type PracticeSession = typeof practiceSessions.$inferSelect;
export type InsertPracticeSession = typeof practiceSessions.$inferInsert;

/**
 * 시험 세션 테이블 - 백지복습 기록
 */
export const testSessions = mysqlTable("testSessions", {
  id: int("id").autoincrement().primaryKey(),
  questionId: int("questionId").notNull(),
  userId: int("userId").notNull(),
  userAnswer: text("userAnswer").notNull(),
  isCorrect: int("isCorrect").notNull(), // 0 or 1 (boolean)
  similarityScore: int("similarityScore"), // LLM 평가 점수 (0-100)
  recallTime: int("recallTime").notNull(), // 회상 소요 시간 (초)
  mistakeHighlights: text("mistakeHighlights"), // JSON 형태로 틀린 부분 저장
  llmFeedback: text("llmFeedback"), // LLM 피드백
  completedAt: timestamp("completedAt").defaultNow().notNull(),
});

export type TestSession = typeof testSessions.$inferSelect;
export type InsertTestSession = typeof testSessions.$inferInsert;

/**
 * 복습 스케줄 테이블 - 망각 곡선 기반 복습 알림
 */
export const reviewSchedules = mysqlTable("reviewSchedules", {
  id: int("id").autoincrement().primaryKey(),
  questionId: int("questionId").notNull(),
  userId: int("userId").notNull(),
  nextReviewDate: timestamp("nextReviewDate").notNull(),
  repetitionCount: int("repetitionCount").default(0).notNull(),
  easeFactor: int("easeFactor").default(250).notNull(), // 2.5 * 100 (소수점 2자리)
  interval: int("interval").default(1).notNull(), // 일 단위
  lastReviewedAt: timestamp("lastReviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReviewSchedule = typeof reviewSchedules.$inferSelect;
export type InsertReviewSchedule = typeof reviewSchedules.$inferInsert;