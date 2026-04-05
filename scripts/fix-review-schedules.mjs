/**
 * 비정상적으로 큰 interval/easeFactor 값을 가진 reviewSchedules 레코드를 정리합니다.
 * - easeFactor 상한: 300 (3.0배)
 * - interval 상한: 365일
 * - nextReviewDate도 interval에 맞게 재계산
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const conn = await createConnection(process.env.DATABASE_URL);

// 비정상 레코드 조회
const [rows] = await conn.execute(
  "SELECT id, `interval`, easeFactor, lastReviewedAt FROM reviewSchedules WHERE `interval` > 365 OR easeFactor > 300"
);

console.log(`비정상 레코드 ${rows.length}개 발견`);

for (const row of rows) {
  const clampedInterval = Math.min(row.interval, 365);
  const clampedEaseFactor = Math.min(row.easeFactor, 300);

  // nextReviewDate = lastReviewedAt + clampedInterval
  const base = row.lastReviewedAt ? new Date(row.lastReviewedAt) : new Date();
  const nextReviewDate = new Date(base);
  nextReviewDate.setDate(nextReviewDate.getDate() + clampedInterval);

  await conn.execute(
    "UPDATE reviewSchedules SET `interval` = ?, easeFactor = ?, nextReviewDate = ? WHERE id = ?",
    [clampedInterval, clampedEaseFactor, nextReviewDate, row.id]
  );

  console.log(
    `  id=${row.id}: interval ${row.interval}→${clampedInterval}, easeFactor ${row.easeFactor}→${clampedEaseFactor}, nextReviewDate→${nextReviewDate.toISOString().slice(0, 10)}`
  );
}

await conn.end();
console.log("완료");
