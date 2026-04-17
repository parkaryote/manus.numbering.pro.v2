import { promises as fs } from "fs";
import path from "path";
import type { InsertTelemetryEvent, Question, Subject, User } from "../drizzle/schema.js";
import * as db from "./db.js";

const LOG_DIR = path.resolve(process.cwd(), "data", "internal-analytics");
const CSV_PATH = path.join(LOG_DIR, "learning-interactions.csv");
const TELEMETRY_PAYLOAD_MAX_BYTES = 24 * 1024;

const CSV_COLUMNS = [
  "occurredAt",
  "eventCategory",
  "eventType",
  "userId",
  "userEmail",
  "userRole",
  "loginMethod",
  "clientSessionId",
  "batchId",
  "pagePath",
  "requestPath",
  "referrer",
  "ip",
  "userAgent",
  "subjectId",
  "subjectName",
  "questionId",
  "questionType",
  "isDemo",
  "questionPreview",
  "testMode",
  "source",
  "practiceSessionId",
  "testSessionId",
  "isCorrect",
  "similarityScore",
  "accuracy",
  "correctCount",
  "totalCount",
  "durationSec",
  "recallTimeSec",
  "typingSpeedCpm",
  "effectiveSpeed",
  "timeToFirstKeyMs",
  "typingDurationMs",
  "backspaceCount",
  "pasteDetected",
  "answerLength",
  "inputChars",
  "errorCount",
  "activeMs",
  "interactionCount",
  "completionRatio",
  "blindMode",
  "payloadJson",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];
type CsvRow = Record<CsvColumn, string | number | boolean | null>;

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  originalUrl?: string;
  url?: string;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};

type AnalyticsRequestMeta = {
  req?: RequestLike;
  clientSessionId?: string | null;
  pagePath?: string | null;
  batchId?: string | null;
};

type LearningMetrics = {
  testMode?: "single" | "mock" | null;
  source?: string | null;
  practiceSessionId?: number | null;
  testSessionId?: number | null;
  isCorrect?: boolean | null;
  similarityScore?: number | null;
  accuracy?: number | null;
  correctCount?: number | null;
  totalCount?: number | null;
  durationSec?: number | null;
  recallTimeSec?: number | null;
  typingSpeedCpm?: number | null;
  effectiveSpeed?: number | null;
  timeToFirstKeyMs?: number | null;
  typingDurationMs?: number | null;
  backspaceCount?: number | null;
  pasteDetected?: boolean | null;
  answerLength?: number | null;
  inputChars?: number | null;
  errorCount?: number | null;
  activeMs?: number | null;
  interactionCount?: number | null;
  completionRatio?: number | null;
  blindMode?: boolean | null;
};

type LearningEventInput = {
  eventCategory: string;
  eventType: string;
  user: Pick<User, "id" | "email" | "role" | "loginMethod">;
  question?: Pick<Question, "id" | "question" | "tableData" | "imageUrl" | "isDemo" | "subjectId"> | null;
  subject?: Pick<Subject, "id" | "name" | "isDemo"> | null;
  requestMeta?: AnalyticsRequestMeta;
  metrics?: LearningMetrics;
  payload?: unknown;
  occurredAt?: Date;
  persistToTelemetryDb?: boolean;
};

let writeQueue: Promise<void> = Promise.resolve();

function resolveHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function safeSerializePayload(payload: unknown): string | null {
  if (payload === undefined) return null;
  if (typeof payload === "string") {
    if (Buffer.byteLength(payload, "utf8") <= TELEMETRY_PAYLOAD_MAX_BYTES) {
      return payload;
    }
    return JSON.stringify({
      truncated: true,
      message: "payload_too_large",
      maxBytes: TELEMETRY_PAYLOAD_MAX_BYTES,
    });
  }
  try {
    const serialized = JSON.stringify(payload);
    if (!serialized) return null;
    if (Buffer.byteLength(serialized, "utf8") <= TELEMETRY_PAYLOAD_MAX_BYTES) {
      return serialized;
    }
    return JSON.stringify({
      truncated: true,
      message: "payload_too_large",
      maxBytes: TELEMETRY_PAYLOAD_MAX_BYTES,
    });
  } catch {
    return JSON.stringify({
      truncated: true,
      message: "payload_serialization_failed",
    });
  }
}

function inferQuestionType(question?: Pick<Question, "tableData" | "imageUrl"> | null): string {
  if (!question) return "";
  if (question.tableData) return "table";
  if (question.imageUrl) return "image";
  return "text";
}

function toQuestionPreview(value: string | null | undefined): string {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  return compact.slice(0, 180);
}

function toRequestPath(req?: RequestLike, pagePath?: string | null): string {
  if (pagePath) return pagePath.slice(0, 512);
  const referrer = resolveHeaderValue(req?.headers?.referer);
  if (referrer) {
    try {
      const parsed = new URL(referrer);
      return `${parsed.pathname}${parsed.search}`.slice(0, 512);
    } catch {
      return referrer.slice(0, 512);
    }
  }
  return (req?.originalUrl ?? req?.url ?? "").slice(0, 512);
}

function toIp(req?: RequestLike): string {
  const forwardedFor = resolveHeaderValue(req?.headers?.["x-forwarded-for"]);
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim()?.slice(0, 128) ?? "";
  return (req?.ip ?? req?.socket?.remoteAddress ?? "").slice(0, 128);
}

function csvEscape(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (!/[",\n\r]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, "\"\"")}"`;
}

async function ensureCsvFile() {
  await fs.mkdir(LOG_DIR, { recursive: true });
  try {
    await fs.access(CSV_PATH);
  } catch {
    await fs.writeFile(CSV_PATH, `${CSV_COLUMNS.join(",")}\n`, "utf8");
  }
}

async function appendCsvRow(row: CsvRow) {
  writeQueue = writeQueue
    .then(async () => {
      await ensureCsvFile();
      const line = `${CSV_COLUMNS.map((column) => csvEscape(row[column])).join(",")}\n`;
      await fs.appendFile(CSV_PATH, line, "utf8");
    })
    .catch((error) => {
      console.warn("[InternalLearningAnalytics] CSV append failed:", error);
    });

  await writeQueue;
}

function toTelemetryRow(
  input: LearningEventInput,
  payloadJson: string | null,
  occurredAt: Date,
  requestPath: string
): InsertTelemetryEvent {
  return {
    userId: input.user.id,
    sessionId: (input.requestMeta?.clientSessionId || input.requestMeta?.batchId || `user-${input.user.id}`).slice(0, 96),
    path: requestPath || "/internal/learning-analytics",
    eventType: input.eventType.slice(0, 64),
    activeMs: Math.max(0, Math.min(10 * 60 * 1000, Math.round(input.metrics?.activeMs ?? 0))),
    interactionCount: Math.max(0, Math.min(10_000, Math.round(input.metrics?.interactionCount ?? 0))),
    visible: 1,
    payload: payloadJson,
    occurredAt,
  };
}

function buildCsvRow(input: LearningEventInput, payloadJson: string | null, occurredAt: Date): CsvRow {
  const req = input.requestMeta?.req;
  const requestPath = toRequestPath(req, input.requestMeta?.pagePath);
  const referrer = resolveHeaderValue(req?.headers?.referer) ?? "";
  const userAgent = resolveHeaderValue(req?.headers?.["user-agent"]) ?? "";
  const question = input.question;
  const subject = input.subject;
  const questionType = inferQuestionType(question);
  const isDemo = (question?.isDemo ?? subject?.isDemo ?? 0) === 1;

  return {
    occurredAt: occurredAt.toISOString(),
    eventCategory: input.eventCategory,
    eventType: input.eventType,
    userId: input.user.id,
    userEmail: input.user.email ?? "",
    userRole: input.user.role ?? "",
    loginMethod: input.user.loginMethod ?? "",
    clientSessionId: input.requestMeta?.clientSessionId ?? "",
    batchId: input.requestMeta?.batchId ?? "",
    pagePath: input.requestMeta?.pagePath ?? "",
    requestPath,
    referrer,
    ip: toIp(req),
    userAgent,
    subjectId: subject?.id ?? question?.subjectId ?? "",
    subjectName: subject?.name ?? "",
    questionId: question?.id ?? "",
    questionType,
    isDemo,
    questionPreview: toQuestionPreview(question?.question),
    testMode: input.metrics?.testMode ?? "",
    source: input.metrics?.source ?? "",
    practiceSessionId: input.metrics?.practiceSessionId ?? "",
    testSessionId: input.metrics?.testSessionId ?? "",
    isCorrect: input.metrics?.isCorrect ?? "",
    similarityScore: input.metrics?.similarityScore ?? "",
    accuracy: input.metrics?.accuracy ?? "",
    correctCount: input.metrics?.correctCount ?? "",
    totalCount: input.metrics?.totalCount ?? "",
    durationSec: input.metrics?.durationSec ?? "",
    recallTimeSec: input.metrics?.recallTimeSec ?? "",
    typingSpeedCpm: input.metrics?.typingSpeedCpm ?? "",
    effectiveSpeed: input.metrics?.effectiveSpeed ?? "",
    timeToFirstKeyMs: input.metrics?.timeToFirstKeyMs ?? "",
    typingDurationMs: input.metrics?.typingDurationMs ?? "",
    backspaceCount: input.metrics?.backspaceCount ?? "",
    pasteDetected: input.metrics?.pasteDetected ?? "",
    answerLength: input.metrics?.answerLength ?? "",
    inputChars: input.metrics?.inputChars ?? "",
    errorCount: input.metrics?.errorCount ?? "",
    activeMs: input.metrics?.activeMs ?? "",
    interactionCount: input.metrics?.interactionCount ?? "",
    completionRatio: input.metrics?.completionRatio ?? "",
    blindMode: input.metrics?.blindMode ?? "",
    payloadJson: payloadJson ?? "",
  };
}

export async function recordLearningEvent(input: LearningEventInput) {
  if (process.env.NODE_ENV === "test") return;
  const occurredAt = input.occurredAt ?? new Date();
  const payloadJson = safeSerializePayload(input.payload);
  const requestPath = toRequestPath(input.requestMeta?.req, input.requestMeta?.pagePath);

  try {
    await appendCsvRow(buildCsvRow(input, payloadJson, occurredAt));
  } catch (error) {
    console.warn("[InternalLearningAnalytics] CSV logging failed:", error);
  }

  if (input.persistToTelemetryDb === false) return;

  try {
    await db.createTelemetryEvents([toTelemetryRow(input, payloadJson, occurredAt, requestPath)]);
  } catch (error) {
    console.warn("[InternalLearningAnalytics] telemetry mirror failed:", error);
  }
}

export async function mirrorTelemetryRowsToCsv(input: {
  user: Pick<User, "id" | "email" | "role" | "loginMethod">;
  rows: InsertTelemetryEvent[];
  req?: RequestLike;
}) {
  if (process.env.NODE_ENV === "test") return;
  for (const row of input.rows) {
    await recordLearningEvent({
      eventCategory: "ux",
      eventType: row.eventType,
      user: input.user,
      requestMeta: {
        req: input.req,
        clientSessionId: row.sessionId,
        pagePath: row.path,
      },
      metrics: {
        activeMs: row.activeMs,
        interactionCount: row.interactionCount,
      },
      payload: row.payload,
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt),
      persistToTelemetryDb: false,
    });
  }
}

export function getInternalLearningCsvPath() {
  return CSV_PATH;
}
