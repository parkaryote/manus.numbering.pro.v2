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
  /** 간편 가입 사용자 아이디 (선택) */
  username: varchar("username", { length: 64 }).unique(),
  /** 간편 가입 비밀번호 해시 (bcrypt) */
  passwordHash: varchar("passwordHash", { length: 255 }),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 과목 테이블 - 문제를 과목별로 분류
 */
export const subjects = mysqlTable("subjects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  demoSourceSubjectId: int("demoSourceSubjectId"), // 원본 데모 과목 ID (개인 복사본 동기화용)
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 7 }).default("#3B82F6"),
  displayOrder: int("displayOrder").default(0).notNull(),
  examEndDate: timestamp("examEndDate"), // 시험 종료일 - 이 날짜 + 1달 후 미사용 문제 자동 삭제
  isDemo: int("isDemo").default(0).notNull(), // 0: 일반 과목, 1: 데모 과목
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
  demoSourceQuestionId: int("demoSourceQuestionId"), // 원본 데모 문제 ID (개인 복사본 동기화용)
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  imageUrl: text("imageUrl"), // Optional image attachment
  imageLabels: text("imageLabels"), // JSON array of {x, y, width, height, answer}
  useAIGrading: int("useAIGrading").default(0).notNull(), // 0: disabled, 1: enabled
  autoNumbering: int("autoNumbering").default(1).notNull(), // 0: disabled, 1: enabled
  tableData: text("tableData"), // JSON for table questions (엔터 기준 자동 번호 생성)
  difficulty: mysqlEnum("difficulty", ["easy", "medium", "hard"]).default("medium"),
  displayOrder: int("displayOrder").default(0).notNull(),
  isDemo: int("isDemo").default(0).notNull(), // 0: 일반 문제, 1: 데모 문제
  isStarred: int("isStarred").default(0).notNull(), // 0: 미표시, 1: 별표 표시 (중요문제/빈출문제)
  memo: text("memo"), // 암기법, 설명 등 사용자 메모 (연습장과 별도, DB에 영구 저장)
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

/**
 * OCR 작업 테이블 - 비동기 OCR 처리 추적
 */
export const ocrJobs = mysqlTable("ocrJobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  s3Url: text("s3Url").notNull(), // Original S3 file URL
  gcsUri: text("gcsUri"), // gs:// URI after upload to GCS
  operationName: text("operationName"), // Google Cloud Vision operation name
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  extractedText: text("extractedText"), // OCR result
  errorMessage: text("errorMessage"), // Error details if failed
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"), // When OCR completed
});

export type OcrJob = typeof ocrJobs.$inferSelect;
export type InsertOcrJob = typeof ocrJobs.$inferInsert;

/**
 * 타이핑 시도 기록 - 속도 보너스 시스템용
 */
export const typingAttempts = mysqlTable("typingAttempts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  questionId: int("questionId").notNull(),
  mode: mysqlEnum("mode", ["practice", "exam"]).notNull(),
  answerLength: int("answerLength").notNull(),
  inputChars: int("inputChars").notNull(),
  timeToFirstKey: int("timeToFirstKey").notNull(), // ms
  typingDuration: int("typingDuration").notNull(), // ms
  backspaceCount: int("backspaceCount").notNull(),
  pasteDetected: int("pasteDetected").default(0).notNull(), // 0=false, 1=true
  effectiveSpeed: int("effectiveSpeed").notNull(), // chars/sec * 1000 (정수 저장)
  lengthBucket: int("lengthBucket").notNull(), // 1-4
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TypingAttempt = typeof typingAttempts.$inferSelect;
export type InsertTypingAttempt = typeof typingAttempts.$inferInsert;

/**
 * 타이핑 베이스라인 - 사용자별/모드별/길이버킷별 p60 속도
 */
export const typingBaselines = mysqlTable("typingBaselines", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  mode: mysqlEnum("mode", ["practice", "exam"]).notNull(),
  lengthBucket: int("lengthBucket").notNull(), // 1-4
  baselineSpeed: int("baselineSpeed").notNull(), // chars/sec * 1000
  sampleCount: int("sampleCount").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TypingBaseline = typeof typingBaselines.$inferSelect;
export type InsertTypingBaseline = typeof typingBaselines.$inferInsert;

/**
 * 베타 UX 텔레메트리 이벤트
 * - 체류시간(activeMs), 상호작용(interactionCount), 페이지 흐름(page_view/route_change) 저장
 * - 관리자 분석용 원천 데이터
 */
export const telemetryEvents = mysqlTable("telemetryEvents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sessionId: varchar("sessionId", { length: 96 }).notNull(),
  path: varchar("path", { length: 512 }).notNull(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  activeMs: int("activeMs").default(0).notNull(),
  interactionCount: int("interactionCount").default(0).notNull(),
  visible: int("visible").default(1).notNull(), // 1: visible, 0: hidden
  payload: text("payload"),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
export type InsertTelemetryEvent = typeof telemetryEvents.$inferInsert;

/**
 * 과목 공유 링크 (비밀번호 보호)
 */
export const subjectShares = mysqlTable("subjectShares", {
  id: int("id").autoincrement().primaryKey(),
  subjectId: int("subjectId").notNull(),
  ownerUserId: int("ownerUserId").notNull(),
  shareToken: varchar("shareToken", { length: 80 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  isActive: int("isActive").default(1).notNull(),
  viewCount: int("viewCount").default(0).notNull(),
  lastAccessedAt: timestamp("lastAccessedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SubjectShare = typeof subjectShares.$inferSelect;
export type InsertSubjectShare = typeof subjectShares.$inferInsert;
