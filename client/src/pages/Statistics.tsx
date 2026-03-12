import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, Cell, LineChart, Line } from "recharts";
import { Target, BookOpen, TrendingUp, AlertTriangle, Dumbbell, ClipboardCheck, Timer, Brain, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";

const difficultyLabel: Record<string, string> = { easy: "쉬움", medium: "보통", hard: "어려움" };
const difficultyColor: Record<string, string> = { easy: "#10B981", medium: "#F59E0B", hard: "#EF4444" };

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}초`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${mins}분`;
  return `${mins}분`;
}

export default function Statistics() {
  const { data: summary, isLoading: summaryLoading } = trpc.statistics.getSummary.useQuery();
  const { data: subjectAnalysis, isLoading: analysisLoading } = trpc.statistics.getSubjectAnalysis.useQuery();
  const [expandedSubject, setExpandedSubject] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const deleteAllPractice = trpc.practice.deleteAll.useMutation({
    onSuccess: () => {
      utils.practice.getByUser.invalidate();
      utils.statistics.getSummary.invalidate();
      utils.statistics.getSubjectAnalysis.invalidate();
    },
  });
  const deleteAllTest = trpc.test.deleteAll.useMutation({
    onSuccess: () => {
      utils.test.getByUser.invalidate();
      utils.statistics.getSummary.invalidate();
      utils.statistics.getSubjectAnalysis.invalidate();
    },
  });

  const handleResetStats = async () => {
    if (!confirm("모든 학습 통계를 초기화하시겠습니까? 이 작업은 취소할 수 없습니다.")) return;
    await Promise.all([deleteAllPractice.mutateAsync(), deleteAllTest.mutateAsync()]);
    alert("통계가 초기화되었습니다.");
  };

  // 학습 전략 추천 생성
  const strategies = useMemo(() => {
    if (!summary || !subjectAnalysis) return [];
    const result: { type: "warning" | "success" | "tip"; icon: any; message: string }[] = [];

    // 연습 부족 과목 찾기
    const lowPracticeSubjects = subjectAnalysis.filter(
      (s) => s.totalQuestions > 0 && s.practiceCount / Math.max(s.totalQuestions, 1) < 3
    );
    if (lowPracticeSubjects.length > 0) {
      result.push({
        type: "warning",
        icon: AlertTriangle,
        message: `${lowPracticeSubjects.map((s) => s.subjectName).join(", ")} 과목은 문제당 평균 연습 횟수가 3회 미만입니다. 연습을 더 하면 시험 점수가 올라갈 가능성이 높습니다.`,
      });
    }

    // 연습 많이 했는데 시험 성과 낮은 과목
    const highPracticeLowTest = subjectAnalysis.filter(
      (s) => s.practiceCount > 10 && s.totalTests > 3 && s.overallCorrectRate < 50
    );
    if (highPracticeLowTest.length > 0) {
      result.push({
        type: "tip",
        icon: Brain,
        message: `${highPracticeLowTest.map((s) => s.subjectName).join(", ")} 과목은 연습은 충분하지만 시험 정답률이 낮습니다. 단순 반복보다 시험 모드에서 직접 써보는 백지 복습을 더 자주 시도해보세요.`,
      });
    }

    // 연습량 대비 성과 좋은 과목
    const efficientSubjects = subjectAnalysis.filter(
      (s) => s.totalTests > 3 && s.overallCorrectRate >= 80
    );
    if (efficientSubjects.length > 0) {
      result.push({
        type: "success",
        icon: TrendingUp,
        message: `${efficientSubjects.map((s) => s.subjectName).join(", ")} 과목은 시험 정답률 80% 이상입니다. 현재 학습 전략이 효과적입니다.`,
      });
    }

    // 어려운 문제 연습 부족
    if (summary.weakQuestions.length > 0) {
      const weakCount = summary.weakQuestions.length;
      result.push({
        type: "warning",
        icon: Target,
        message: `시험에서 정답률 70% 미만인 문제가 ${weakCount}개 있습니다. 이 문제들을 집중 연습하면 전체 성적이 향상됩니다.`,
      });
    }

    // 연습 횟수와 시험 성과 상관관계 인사이트
    const pvt = summary.practiceVsTestData;
    const highPracticeBucket = pvt.find((b) => b.label === "11회+");
    const lowPracticeBucket = pvt.find((b) => b.label === "0회");
    if (highPracticeBucket && lowPracticeBucket && highPracticeBucket.testCount > 0 && lowPracticeBucket.testCount > 0) {
      const diff = highPracticeBucket.correctRate - lowPracticeBucket.correctRate;
      if (diff > 0) {
        result.push({
          type: "tip",
          icon: Dumbbell,
          message: `11회 이상 연습한 문제는 0회 연습한 문제보다 시험 정답률이 ${diff}%p 높습니다. 반복 연습이 효과가 있습니다.`,
        });
      }
    }

    if (result.length === 0) {
      result.push({
        type: "tip",
        icon: BookOpen,
        message: "아직 충분한 데이터가 없습니다. 연습과 시험을 더 진행하면 개인화된 학습 전략을 제시해드립니다.",
      });
    }

    return result;
  }, [summary, subjectAnalysis]);

  if (summaryLoading || analysisLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">통계를 분석하고 있습니다...</p>
      </div>
    );
  }

  const hasData = summary && (summary.totalPracticeCount > 0 || summary.totalTestCount > 0);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">학습 분석</h1>
          <p className="text-muted-foreground mt-1">연습 투입량과 시험 성과의 관계를 분석합니다</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResetStats}
          disabled={deleteAllPractice.isPending || deleteAllTest.isPending}
          className="gap-1 text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {deleteAllPractice.isPending || deleteAllTest.isPending ? "초기화 중..." : "통계 초기화"}
        </Button>
      </div>

      {!hasData ? (
        <Card className="shadow-elegant">
          <CardContent className="py-16 text-center">
            <BookOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">아직 학습 데이터가 없습니다</h3>
            <p className="text-muted-foreground">연습 모드와 시험 모드를 진행하면 여기에 분석 결과가 표시됩니다.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 핵심 요약 카드 */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">총 연습</CardTitle>
                <Dumbbell className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary!.totalPracticeCount}회</div>
                <p className="text-xs text-muted-foreground">{formatDuration(summary!.totalPracticeTime)} 투자</p>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">총 시험</CardTitle>
                <ClipboardCheck className="h-4 w-4 text-purple-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary!.totalTestCount}회</div>
                <p className="text-xs text-muted-foreground">{summary!.totalCorrect}회 정답</p>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">시험 정답률</CardTitle>
                <Target className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary!.overallCorrectRate}%</div>
                <p className="text-xs text-muted-foreground">백지 복습 기준</p>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">문제당 평균 연습</CardTitle>
                <Timer className="h-4 w-4 text-amber-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {subjectAnalysis && subjectAnalysis.reduce((s, a) => s + a.totalQuestions, 0) > 0
                    ? (summary!.totalPracticeCount / subjectAnalysis.reduce((s, a) => s + a.totalQuestions, 0)).toFixed(1)
                    : "0"}회
                </div>
                <p className="text-xs text-muted-foreground">전체 문제 기준</p>
              </CardContent>
            </Card>
          </div>

          {/* 개인화된 학습 전략 */}
          <Card className="shadow-elegant border-l-4 border-l-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                학습 전략 분석
              </CardTitle>
              <CardDescription>현재 학습 데이터를 기반으로 한 개인화된 조언</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {strategies.map((s, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-lg ${
                      s.type === "warning" ? "bg-amber-50 dark:bg-amber-950/30" :
                      s.type === "success" ? "bg-green-50 dark:bg-green-950/30" :
                      "bg-blue-50 dark:bg-blue-950/30"
                    }`}
                  >
                    <s.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                      s.type === "warning" ? "text-amber-600" :
                      s.type === "success" ? "text-green-600" :
                      "text-blue-600"
                    }`} />
                    <p className="text-sm leading-relaxed">{s.message}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 핵심 그래프: 연습 횟수 vs 시험 정답률 */}
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle>연습 횟수별 시험 정답률</CardTitle>
              <CardDescription>문제를 몇 번 연습해야 시험에서 맞출 수 있는지 보여줍니다</CardDescription>
            </CardHeader>
            <CardContent>
              {summary!.practiceVsTestData.some(d => d.testCount > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={summary!.practiceVsTestData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" label={{ value: "연습 횟수", position: "insideBottom", offset: -5 }} />
                    <YAxis domain={[0, 100]} label={{ value: "정답률 (%)", angle: -90, position: "insideLeft" }} />
                    <Tooltip
                      formatter={(value: any, name: string) => {
                        if (name === "정답률") return [`${value}%`, name];
                        return [value, name];
                      }}
                      labelFormatter={(label) => `연습 ${label}`}
                    />
                    <Legend />
                    <Bar dataKey="correctRate" name="정답률" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-8">시험 데이터가 부족합니다. 시험 모드를 더 진행해보세요.</p>
              )}
            </CardContent>
          </Card>

          {/* 탭: 과목별 상세 / 취약 문제 */}
          <Tabs defaultValue="subjects" className="space-y-4">
            <TabsList>
              <TabsTrigger value="subjects">과목별 분석</TabsTrigger>
              <TabsTrigger value="weak">취약 문제</TabsTrigger>
            </TabsList>

            <TabsContent value="subjects" className="space-y-4">
              {subjectAnalysis && subjectAnalysis.length > 0 ? (
                subjectAnalysis.map((subject) => (
                  <Card key={subject.subjectId} className="shadow-elegant overflow-hidden">
                    <button
                      className="w-full text-left"
                      onClick={() => setExpandedSubject(expandedSubject === subject.subjectId ? null : subject.subjectId)}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: subject.subjectColor || "#3B82F6" }}
                            />
                            <CardTitle className="text-base">{subject.subjectName}</CardTitle>
                            <Badge variant="outline" className="text-xs">{subject.totalQuestions}문제</Badge>
                          </div>
                          {expandedSubject === subject.subjectId ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                        {/* 요약 바 */}
                        <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Dumbbell className="w-3.5 h-3.5" />
                            연습 {subject.practiceCount}회 ({formatDuration(subject.totalPracticeTime)})
                          </span>
                          <span className="flex items-center gap-1">
                            <ClipboardCheck className="w-3.5 h-3.5" />
                            시험 {subject.totalTests}회
                          </span>
                          {subject.totalTests > 0 && (
                            <span className="flex items-center gap-1">
                              <Target className="w-3.5 h-3.5" />
                              정답률 {subject.overallCorrectRate}%
                            </span>
                          )}
                        </div>
                      </CardHeader>
                    </button>

                    {expandedSubject === subject.subjectId && (
                      <CardContent className="pt-0 space-y-4">
                        {/* 난도별 시험 성과 */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2">난도별 시험 성과</h4>
                          <div className="grid grid-cols-3 gap-3">
                            {subject.difficultyStats.map((ds) => (
                              <div
                                key={ds.difficulty}
                                className="p-3 rounded-lg border text-center"
                              >
                                <p className="text-xs font-medium mb-1" style={{ color: difficultyColor[ds.difficulty] }}>
                                  {difficultyLabel[ds.difficulty]}
                                </p>
                                <p className="text-xl font-bold">
                                  {ds.totalTests > 0 ? `${ds.correctRate}%` : "-"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {ds.totalTests > 0 ? `${ds.correctCount}/${ds.totalTests}` : "미응시"}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* 성과 추이 그래프 */}
                        {subject.performanceTrend.length > 1 && (
                          <div>
                            <h4 className="text-sm font-semibold mb-2">시험 성과 추이</h4>
                            <ResponsiveContainer width="100%" height={200}>
                              <LineChart data={subject.performanceTrend}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                  dataKey="date"
                                  tickFormatter={(d) => {
                                    const parts = d.split("-");
                                    return `${parts[1]}/${parts[2]}`;
                                  }}
                                  fontSize={12}
                                />
                                <YAxis domain={[0, 100]} fontSize={12} />
                                <Tooltip
                                  labelFormatter={(d) => d}
                                  formatter={(value: any, name: string) => {
                                    if (name === "정답률") return [`${value}%`, name];
                                    if (name === "누적 연습") return [`${value}회`, name];
                                    return [value, name];
                                  }}
                                />
                                <Legend />
                                <Line type="monotone" dataKey="correctRate" name="정답률" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                                <Line type="monotone" dataKey="cumulativePractice" name="누적 연습" stroke="#3B82F6" strokeWidth={1} strokeDasharray="5 5" dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        {/* 문제별 분석 테이블 */}
                        {subject.questionAnalysis.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold mb-2">문제별 분석</h4>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left py-2 pr-2">문제</th>
                                    <th className="text-center py-2 px-2">난도</th>
                                    <th className="text-center py-2 px-2">연습</th>
                                    <th className="text-center py-2 px-2">시험</th>
                                    <th className="text-center py-2 px-2">정답률</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {subject.questionAnalysis
                                    .sort((a, b) => a.correctRate - b.correctRate)
                                    .map((q) => (
                                      <tr key={q.questionId} className="border-b last:border-0">
                                        <td className="py-2 pr-2 max-w-[200px] truncate">{q.question}</td>
                                        <td className="text-center py-2 px-2">
                                          <span className="text-xs" style={{ color: difficultyColor[q.difficulty || "medium"] }}>
                                            {difficultyLabel[q.difficulty || "medium"]}
                                          </span>
                                        </td>
                                        <td className="text-center py-2 px-2">{q.practiceCount}회</td>
                                        <td className="text-center py-2 px-2">{q.testCount}회</td>
                                        <td className="text-center py-2 px-2">
                                          {q.testCount > 0 ? (
                                            <span className={q.correctRate >= 70 ? "text-green-600" : q.correctRate >= 40 ? "text-amber-600" : "text-red-600"}>
                                              {q.correctRate}%
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">-</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                ))
              ) : (
                <Card className="shadow-elegant">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    과목이 없습니다. 과목을 추가하고 학습을 시작하세요.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="weak" className="space-y-4">
              <Card className="shadow-elegant">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    취약 문제 (정답률 70% 미만)
                  </CardTitle>
                  <CardDescription>시험에서 자주 틀리는 문제들입니다. 이 문제들을 집중 연습하세요.</CardDescription>
                </CardHeader>
                <CardContent>
                  {summary!.weakQuestions.length > 0 ? (
                    <div className="space-y-2">
                      {summary!.weakQuestions.map((q, i) => (
                        <div key={q.questionId} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate font-medium">{q.question}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs" style={{ color: difficultyColor[q.difficulty || "medium"] }}>
                                {difficultyLabel[q.difficulty || "medium"]}
                              </span>
                              <span className="text-xs text-muted-foreground">연습 {q.practiceCount}회</span>
                            </div>
                          </div>
                          <div className="text-right ml-4">
                            <p className={`text-lg font-bold ${q.correctRate >= 40 ? "text-amber-600" : "text-red-600"}`}>
                              {q.correctRate}%
                            </p>
                            <p className="text-xs text-muted-foreground">{q.testCount}회 시험</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      {summary!.totalTestCount > 0
                        ? "모든 문제의 정답률이 70% 이상입니다. 잘하고 있습니다!"
                        : "시험 데이터가 없습니다. 시험 모드를 진행해보세요."}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
