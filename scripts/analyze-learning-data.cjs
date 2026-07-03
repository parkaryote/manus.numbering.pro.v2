#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const csvPath = path.resolve(process.cwd(), "data", "internal-analytics", "learning-interactions.csv");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avg(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function fmt(value, digits = 1) {
  return value === null ? "-" : value.toFixed(digits);
}

if (!fs.existsSync(csvPath)) {
  console.log("학습 로그가 아직 없습니다. 연습/시험을 한 뒤 다시 실행하세요.");
  process.exit(0);
}

const raw = fs.readFileSync(csvPath, "utf8").trim();
if (!raw) {
  console.log("학습 로그가 비어 있습니다.");
  process.exit(0);
}

const [headerLine, ...lines] = raw.split(/\r?\n/);
const headers = parseCsvLine(headerLine);
const rows = lines
  .map(parseCsvLine)
  .filter((cols) => cols.length >= headers.length)
  .map((cols) => Object.fromEntries(headers.map((header, index) => [header, cols[index] ?? ""])));

const learningRows = rows.filter((row) =>
  ["practice_session", "test_session", "test_evaluation"].includes(row.eventType)
);
const hasConfidenceColumns =
  headers.includes("confidenceBefore") &&
  headers.includes("confidenceAfter") &&
  headers.includes("confidenceDelta");
const rowsWithConfidence = hasConfidenceColumns
  ? learningRows.filter((row) => toNumber(row.confidenceAfter) !== null)
  : [];
const byEventType = new Map();
const byQuestion = new Map();

for (const row of rowsWithConfidence) {
  const eventBucket = byEventType.get(row.eventType) ?? [];
  eventBucket.push(row);
  byEventType.set(row.eventType, eventBucket);

  const key = `${row.questionId || "unknown"} | ${row.questionPreview || "(제목 없음)"}`;
  const questionBucket = byQuestion.get(key) ?? [];
  questionBucket.push(row);
  byQuestion.set(key, questionBucket);
}

console.log("\n학습 알고리즘 튜닝 요약");
console.log(`CSV: ${csvPath}`);
console.log(`전체 학습 이벤트: ${learningRows.length}`);
console.log(`안정도 스냅샷 포함 이벤트: ${rowsWithConfidence.length}`);
if (!hasConfidenceColumns) {
  console.log("참고: 현재 CSV는 이전 형식입니다. 다음 연습/시험부터 안정도 전후값이 새 CSV에 기록됩니다.");
}

console.log("\n이벤트별 안정도 변화");
if (byEventType.size === 0) {
  console.log("- 아직 안정도 스냅샷이 있는 이벤트가 없습니다.");
} else {
  for (const [eventType, bucket] of byEventType.entries()) {
    const deltas = bucket.map((row) => toNumber(row.confidenceDelta)).filter((value) => value !== null);
    const after = bucket.map((row) => toNumber(row.confidenceAfter)).filter((value) => value !== null);
    const similarity = bucket.map((row) => toNumber(row.similarityScore)).filter((value) => value !== null);
    console.log(
      `- ${eventType}: ${bucket.length}회, 평균 증감 ${fmt(avg(deltas))}점, 평균 이후 안정도 ${fmt(avg(after))}점, 평균 유사도 ${fmt(avg(similarity))}%`
    );
  }
}

const questionSummaries = Array.from(byQuestion.entries())
  .map(([key, bucket]) => {
    const latest = [...bucket].sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt))).at(-1);
    return {
      key,
      count: bucket.length,
      avgDelta: avg(bucket.map((row) => toNumber(row.confidenceDelta)).filter((value) => value !== null)),
      latestScore: toNumber(latest?.confidenceAfter),
      latestState: latest?.confidenceAfterState || "-",
      latestAt: latest?.occurredAt || "-",
    };
  })
  .sort((a, b) => (a.latestScore ?? -1) - (b.latestScore ?? -1));

console.log("\n튜닝 우선순위 후보");
if (questionSummaries.length === 0) {
  console.log("- 아직 문제별 요약을 만들 데이터가 부족합니다.");
} else {
  for (const row of questionSummaries.slice(0, 12)) {
    console.log(
      `- ${row.key}: ${row.count}회, 최근 ${fmt(row.latestScore, 0)}점/${row.latestState}, 평균 증감 ${fmt(row.avgDelta)}점, 최근 ${row.latestAt}`
    );
  }
}

console.log("\n다음 확인 포인트");
console.log("- 연습 평균 증감이 0~1점에 몰리면 연습 보상 하한을 올릴 후보입니다.");
console.log("- 시험 성공 후 증감이 반복적으로 크면 짧은 재시험 감쇠를 강화할 후보입니다.");
console.log("- 유사도는 높은데 안정도가 낮게 유지되면 시험 신뢰도 가중치를 올릴 후보입니다.\n");
