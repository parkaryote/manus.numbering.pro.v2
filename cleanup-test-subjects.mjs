/**
 * 테스트 실행으로 인해 실제 DB에 남은 과목/문제/세션 데이터 정리
 * 조건: name이 "역사", "과학", "영어", "수학", "테스트 과목" 이고 userId = 1인 항목
 */
import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, inArray, like } from "drizzle-orm";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// drizzle schema를 직접 정의 (import 문제 방지)
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// tsx로 실행
console.log("Connecting to DB...");

const connection = await mysql.createConnection(DATABASE_URL);
const db = drizzle(connection);

// 테스트 과목 이름 목록
const TEST_SUBJECT_NAMES = ["역사", "과학", "영어", "수학", "테스트 과목", "[TEST] 역사", "[TEST] 과학", "[TEST] 영어", "[TEST] 수학", "[TEST] 테스트 과목"];

// userId=1인 과목 중 테스트 과목 이름과 일치하는 것 조회
const [rows] = await connection.execute(
  `SELECT id, name, userId FROM subjects WHERE name IN (${TEST_SUBJECT_NAMES.map(() => '?').join(',')}) AND userId = 1`,
  TEST_SUBJECT_NAMES
);

console.log("Found test subjects:", rows);

if (rows.length === 0) {
  console.log("No test subjects found. DB is clean.");
  await connection.end();
  process.exit(0);
}

const subjectIds = rows.map(r => r.id);
console.log("Subject IDs to delete:", subjectIds);

// 관련 문제 조회
const [questionRows] = await connection.execute(
  `SELECT id FROM questions WHERE subjectId IN (${subjectIds.map(() => '?').join(',')})`,
  subjectIds
);
const questionIds = questionRows.map(r => r.id);
console.log("Question IDs to delete:", questionIds);

if (questionIds.length > 0) {
  // 연습 세션 삭제
  const [psDel] = await connection.execute(
    `DELETE FROM practiceSessions WHERE questionId IN (${questionIds.map(() => '?').join(',')})`,
    questionIds
  );
  console.log("Deleted practice sessions:", psDel.affectedRows);

  // 시험 세션 삭제
  const [tsDel] = await connection.execute(
    `DELETE FROM testSessions WHERE questionId IN (${questionIds.map(() => '?').join(',')})`,
    questionIds
  );
  console.log("Deleted test sessions:", tsDel.affectedRows);

  // 복습 스케줄 삭제
  const [rsDel] = await connection.execute(
    `DELETE FROM reviewSchedules WHERE questionId IN (${questionIds.map(() => '?').join(',')})`,
    questionIds
  );
  console.log("Deleted review schedules:", rsDel.affectedRows);

  // 문제 삭제
  const [qDel] = await connection.execute(
    `DELETE FROM questions WHERE id IN (${questionIds.map(() => '?').join(',')})`,
    questionIds
  );
  console.log("Deleted questions:", qDel.affectedRows);
}

// 과목 삭제
const [sDel] = await connection.execute(
  `DELETE FROM subjects WHERE id IN (${subjectIds.map(() => '?').join(',')})`,
  subjectIds
);
console.log("Deleted subjects:", sDel.affectedRows);

await connection.end();
console.log("Cleanup complete!");
