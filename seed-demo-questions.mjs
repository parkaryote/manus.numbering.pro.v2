import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'typing_quiz',
});

try {
  // 데모 과목 조회
  const [subjects] = await connection.query(
    'SELECT id, title FROM subjects WHERE isDemo = 1'
  );
  
  console.log('Demo subjects:', subjects);
  
  // 해부학 과목 찾기
  const anatomySubject = subjects.find(s => s.title.includes('해부'));
  // 치아형태학 과목 찾기
  const teethSubject = subjects.find(s => s.title.includes('치아'));
  
  if (!anatomySubject || !teethSubject) {
    console.error('Demo subjects not found');
    process.exit(1);
  }
  
  // 임시 문제 추가
  const questions = [
    {
      userId: 1,
      subjectId: anatomySubject.id,
      question: '정상 교합의 조건을 설명하시오.',
      answer: '상악 전치가 하악 전치를 약 2-3mm 피복\n상악 구치가 하악 구치를 약 1mm 피복\n상하 정중선이 일치\n상악 구치의 협측 교두가 하악 구치의 협측 홈에 위치',
      difficulty: 'medium',
      isDemo: 1,
      displayOrder: 1,
    },
    {
      userId: 1,
      subjectId: teethSubject.id,
      question: '상악 우측 제1대구치의 특징을 설명하시오.',
      answer: '근심면에 4개의 근심변연융선\n원심면에 3개의 원심변연융선\n협측면에 2개의 협측 교두\n설측면에 1개의 설측 교두',
      difficulty: 'medium',
      isDemo: 1,
      displayOrder: 1,
    },
  ];
  
  for (const q of questions) {
    await connection.query(
      'INSERT INTO questions (userId, subjectId, question, answer, difficulty, isDemo, displayOrder) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [q.userId, q.subjectId, q.question, q.answer, q.difficulty, q.isDemo, q.displayOrder]
    );
    console.log(`Added question to subject ${q.subjectId}`);
  }
  
  console.log('Demo questions added successfully');
} catch (error) {
  console.error('Error:', error);
} finally {
  await connection.end();
}
