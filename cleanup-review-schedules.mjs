import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// userId=1의 reviewSchedules 확인
const [rs] = await conn.execute(
  "SELECT id, questionId FROM reviewSchedules WHERE userId=1"
);
console.log("reviewSchedules (userId=1) count:", rs.length);

if (rs.length > 0) {
  const questionIds = rs.map(r => r.questionId);
  const placeholders = questionIds.map(() => "?").join(",");

  // userId=1 소유 문제인지 확인
  const [ownedQ] = await conn.execute(
    `SELECT id FROM questions WHERE id IN (${placeholders}) AND userId=1`,
    questionIds
  );
  const ownedIdSet = new Set(ownedQ.map(q => q.id));

  // 고아 reviewSchedules (테스트 코드가 생성한 것)
  const orphanIds = rs
    .filter(r => !ownedIdSet.has(r.questionId))
    .map(r => r.id);
  console.log("Orphan reviewSchedule ids count:", orphanIds.length);

  if (orphanIds.length > 0) {
    const delPlaceholders = orphanIds.map(() => "?").join(",");
    const [del] = await conn.execute(
      `DELETE FROM reviewSchedules WHERE id IN (${delPlaceholders})`,
      orphanIds
    );
    console.log("Deleted orphan reviewSchedules:", del.affectedRows);
  }

  // 남은 것 확인
  const [remaining] = await conn.execute(
    "SELECT COUNT(*) as cnt FROM reviewSchedules WHERE userId=1"
  );
  console.log("Remaining reviewSchedules (userId=1):", remaining[0].cnt);
}

await conn.end();
console.log("Done!");
