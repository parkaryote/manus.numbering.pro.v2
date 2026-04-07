import { drizzle } from "drizzle-orm/mysql2";
import { eq, and } from "drizzle-orm";
import * as dotenv from "dotenv";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const db = drizzle(DATABASE_URL);

// 직접 SQL로 처리
const result = await db.execute(`
  SELECT u.id, u.name, u.username 
  FROM users u 
  WHERE u.username = 'parkham'
`);

console.log("parkham user:", result[0]);

if (!result[0] || result[0].length === 0) {
  console.log("parkham 계정을 찾을 수 없습니다");
  process.exit(0);
}

const userId = result[0][0]?.id;
console.log("userId:", userId);

if (!userId) {
  console.log("userId를 찾을 수 없습니다");
  process.exit(0);
}

// parkham의 과목 목록 확인
const subjectsResult = await db.execute(`
  SELECT id, name FROM subjects WHERE userId = ${userId} AND isDemo = 0
`);
console.log("parkham subjects:", subjectsResult[0]);

// 영어 단어, 한국사, 수학 공식 과목 삭제 (관련 문제, 세션도 함께)
const targetNames = ["영어 단어", "한국사", "수학 공식"];
const subjectRows = subjectsResult[0];

for (const subject of subjectRows) {
  if (targetNames.includes(subject.name)) {
    console.log(`삭제 중: ${subject.name} (id: ${subject.id})`);

    // 관련 문제 ID 조회
    const questionsResult = await db.execute(
      `SELECT id FROM questions WHERE subjectId = ${subject.id}`
    );
    const questionIds = questionsResult[0].map(q => q.id);

    if (questionIds.length > 0) {
      const idList = questionIds.join(",");
      // 연습/시험 세션 삭제
      await db.execute(
        `DELETE FROM practiceSessions WHERE questionId IN (${idList})`
      );
      await db.execute(
        `DELETE FROM testSessions WHERE questionId IN (${idList})`
      );
      await db.execute(
        `DELETE FROM reviewSchedules WHERE questionId IN (${idList})`
      );
      // 문제 삭제
      await db.execute(`DELETE FROM questions WHERE subjectId = ${subject.id}`);
    }
    // 과목 삭제
    await db.execute(`DELETE FROM subjects WHERE id = ${subject.id}`);
    console.log(`  완료: ${subject.name}`);
  }
}

console.log("완료!");
process.exit(0);
