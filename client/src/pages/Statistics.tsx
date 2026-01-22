import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Award, Clock } from "lucide-react";

export default function Statistics() {
  const { data: practiceSessions, isLoading: practiceLoading } = trpc.practice.getByUser.useQuery();
  const { data: testSessions, isLoading: testLoading } = trpc.test.getByUser.useQuery();
  const { data: questions } = trpc.questions.listAll.useQuery();
  const { data: subjects } = trpc.subjects.list.useQuery();
  
  const utils = trpc.useUtils();
  const deleteAllPractice = trpc.practice.deleteAll.useMutation({
    onSuccess: () => {
      utils.practice.getByUser.invalidate();
    },
  });
  const deleteAllTest = trpc.test.deleteAll.useMutation({
    onSuccess: () => {
      utils.test.getByUser.invalidate();
    },
  });
  
  const handleResetStats = async () => {
    if (!confirm("모든 학습 통계를 초기화하시겠습니까? 이 작업은 취소할 수 없습니다.")) {
      return;
    }
    await Promise.all([
      deleteAllPractice.mutateAsync(),
      deleteAllTest.mutateAsync(),
    ]);
    alert("통계가 초기화되었습니다.");
  };

  // Calculate statistics
  const stats = {
    totalPractice: practiceSessions?.length || 0,
    totalTests: testSessions?.length || 0,
    avgAccuracy: practiceSessions && practiceSessions.length > 0
      ? Math.round(practiceSessions.reduce((sum, s) => sum + s.accuracy, 0) / practiceSessions.length)
      : 0,
    avgTypingSpeed: practiceSessions && practiceSessions.length > 0
      ? Math.round(practiceSessions.reduce((sum, s) => sum + s.typingSpeed, 0) / practiceSessions.length)
      : 0,
    correctRate: testSessions && testSessions.length > 0
      ? Math.round((testSessions.filter(s => s.isCorrect === 1).length / testSessions.length) * 100)
      : 0,
    avgRecallTime: testSessions && testSessions.length > 0
      ? Math.round(testSessions.reduce((sum, s) => sum + s.recallTime, 0) / testSessions.length)
      : 0,
  };

  // Practice trend data (last 10 sessions)
  const practiceTrendData = practiceSessions
    ?.slice(-10)
    .map((session, index) => ({
      session: `#${index + 1}`,
      정확도: session.accuracy,
      속도: Math.round(session.typingSpeed / 10), // Scale down for chart
    })) || [];

  // Test accuracy trend (last 10 tests)
  const testTrendData = testSessions
    ?.slice(-10)
    .map((session, index) => ({
      test: `#${index + 1}`,
      유사도: session.similarityScore || 0,
      정답: session.isCorrect === 1 ? 100 : 0,
    })) || [];

  // Question difficulty distribution
  const difficultyData = questions
    ? [
        { difficulty: "쉬움", count: questions.filter(q => q.difficulty === "easy").length },
        { difficulty: "보통", count: questions.filter(q => q.difficulty === "medium").length },
        { difficulty: "어려움", count: questions.filter(q => q.difficulty === "hard").length },
      ]
    : [];

  // Forgetting curve simulation (Ebbinghaus)
  const forgettingCurveData = [
    { day: 0, retention: 100 },
    { day: 1, retention: 58 },
    { day: 2, retention: 44 },
    { day: 7, retention: 25 },
    { day: 14, retention: 21 },
    { day: 30, retention: 18 },
  ];

  // Expected grade calculation (simple formula)
  const calculateExpectedGrade = () => {
    if (stats.correctRate >= 90) return "A+";
    if (stats.correctRate >= 85) return "A";
    if (stats.correctRate >= 80) return "B+";
    if (stats.correctRate >= 75) return "B";
    if (stats.correctRate >= 70) return "C+";
    if (stats.correctRate >= 65) return "C";
    if (stats.correctRate >= 60) return "D+";
    if (stats.correctRate >= 55) return "D";
    return "F";
  };

  const expectedGrade = calculateExpectedGrade();

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}분 ${secs}초`;
  };

  if (practiceLoading || testLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">학습 통계</h1>
          <p className="text-muted-foreground mt-1">학습 진행 상황과 성과를 확인하세요</p>
        </div>
        <button
          onClick={handleResetStats}
          className="px-4 py-2 text-sm font-medium text-destructive border border-destructive rounded-md hover:bg-destructive hover:text-destructive-foreground transition-colors"
          disabled={deleteAllPractice.isPending || deleteAllTest.isPending}
        >
          {deleteAllPractice.isPending || deleteAllTest.isPending ? "초기화 중..." : "통계 초기화"}
        </button>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-elegant">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">평균 정확도</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgAccuracy}%</div>
            <p className="text-xs text-muted-foreground">연습 모드 기준</p>
          </CardContent>
        </Card>

        <Card className="shadow-elegant">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">평균 타이핑 속도</CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgTypingSpeed}</div>
            <p className="text-xs text-muted-foreground">CPM (분당 글자 수)</p>
          </CardContent>
        </Card>

        <Card className="shadow-elegant">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">시험 정답률</CardTitle>
            <Award className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.correctRate}%</div>
            <p className="text-xs text-muted-foreground">시험 모드 기준</p>
          </CardContent>
        </Card>

        <Card className="shadow-elegant">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">예상 학점</CardTitle>
            <Award className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{expectedGrade}</div>
            <p className="text-xs text-muted-foreground">정답률 기반 예측</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Statistics */}
      <Tabs defaultValue="practice" className="space-y-4">
        <TabsList>
          <TabsTrigger value="practice">연습 통계</TabsTrigger>
          <TabsTrigger value="test">시험 통계</TabsTrigger>
          <TabsTrigger value="forgetting">망각 곡선</TabsTrigger>
          <TabsTrigger value="difficulty">난이도 분포</TabsTrigger>
        </TabsList>

        <TabsContent value="practice" className="space-y-4">
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle>연습 진행 추이</CardTitle>
              <CardDescription>최근 10회 연습 세션의 정확도와 속도</CardDescription>
            </CardHeader>
            <CardContent>
              {practiceTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={practiceTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="session" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="정확도" stroke="#10B981" strokeWidth={2} />
                    <Line type="monotone" dataKey="속도" stroke="#3B82F6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-8">연습 기록이 없습니다</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle>총 연습 시간</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatTime(practiceSessions?.reduce((sum, s) => sum + s.duration, 0) || 0)}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle>평균 오타 수</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {practiceSessions && practiceSessions.length > 0
                    ? Math.round(practiceSessions.reduce((sum, s) => sum + s.errorCount, 0) / practiceSessions.length)
                    : 0}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle>총 연습 횟수</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalPractice}</div>
              </CardContent>
            </Card>
          </div>
          
          {/* 과목별 연습 시간 */}
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle>과목별 연습 시간</CardTitle>
              <CardDescription>각 과목에 투자한 시간</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {subjects && subjects.length > 0 ? (
                  subjects.map((subject) => {
                    // 해당 과목의 문제 ID들 찾기
                    const subjectQuestions = questions?.filter(q => q.subjectId === subject.id) || [];
                    const subjectQuestionIds = subjectQuestions.map(q => q.id);
                    
                    // 해당 문제들의 연습 세션 찾기
                    const subjectPracticeSessions = practiceSessions?.filter(s => 
                      subjectQuestionIds.includes(s.questionId)
                    ) || [];
                    
                    const totalDuration = subjectPracticeSessions.reduce((sum, s) => sum + s.duration, 0);
                    const sessionCount = subjectPracticeSessions.length;
                    
                    return (
                      <div key={subject.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: subject.color || "#3B82F6" }}
                          />
                          <div>
                            <p className="font-medium">{subject.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {sessionCount}회 연습
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{formatTime(totalDuration)}</p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-center text-muted-foreground py-4">과목이 없습니다</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle>시험 성적 추이</CardTitle>
              <CardDescription>최근 10회 시험의 유사도와 정답 여부</CardDescription>
            </CardHeader>
            <CardContent>
              {testTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={testTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="test" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="유사도" fill="#8B5CF6" />
                    <Bar dataKey="정답" fill="#10B981" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-8">시험 기록이 없습니다</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle>평균 회상 시간</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatTime(stats.avgRecallTime)}</div>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle>정답 개수</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {testSessions?.filter(s => s.isCorrect === 1).length || 0} / {stats.totalTests}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle>총 시험 횟수</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalTests}</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="forgetting" className="space-y-4">
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle>망각 곡선 (Ebbinghaus)</CardTitle>
              <CardDescription>시간 경과에 따른 기억 보유율</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={forgettingCurveData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" label={{ value: "일 (Day)", position: "insideBottom", offset: -5 }} />
                  <YAxis label={{ value: "보유율 (%)", angle: -90, position: "insideLeft" }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="retention" stroke="#EF4444" strokeWidth={2} name="기억 보유율" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle>복습 권장 시점</CardTitle>
              <CardDescription>효과적인 장기 기억 형성을 위한 복습 스케줄</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                  <span className="font-medium">1차 복습</span>
                  <span className="text-muted-foreground">학습 후 1일</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                  <span className="font-medium">2차 복습</span>
                  <span className="text-muted-foreground">학습 후 3일</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                  <span className="font-medium">3차 복습</span>
                  <span className="text-muted-foreground">학습 후 7일</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                  <span className="font-medium">4차 복습</span>
                  <span className="text-muted-foreground">학습 후 14일</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                  <span className="font-medium">5차 복습</span>
                  <span className="text-muted-foreground">학습 후 30일</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="difficulty" className="space-y-4">
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle>문제 난이도 분포</CardTitle>
              <CardDescription>등록된 문제의 난이도별 개수</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={difficultyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="difficulty" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" fill="#8B5CF6" name="문제 수" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
