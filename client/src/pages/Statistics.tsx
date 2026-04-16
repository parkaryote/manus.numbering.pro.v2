import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, Cell, LineChart, Line } from "recharts";
import { Target, BookOpen, TrendingUp, AlertTriangle, Dumbbell, ClipboardCheck, Timer, Brain, ChevronDown, ChevronUp, RotateCcw, Keyboard, Users, Activity, MousePointerClick, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo, useRef, useEffect } from "react";
import { useLocation } from "wouter";

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}초`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${mins}분`;
  return `${mins}분`;
}

function formatMinutes(minutes: number) {
  if (minutes < 1) return `${Math.round(minutes * 60)}초`;
  if (minutes < 60) return `${minutes.toFixed(1)}분`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}시간 ${mins}분`;
}

export default function Statistics({ demoPreview = false }: { demoPreview?: boolean }) {
  const [, setLocation] = useLocation();
  const { data: me } = trpc.auth.me.useQuery();
  const { data: summary, isLoading: summaryLoading } = trpc.statistics.getSummary.useQuery();
  const { data: subjectAnalysis, isLoading: analysisLoading } = trpc.statistics.getSubjectAnalysis.useQuery();
  const isAdmin = me?.role === "admin";
  const [uxDays, setUxDays] = useState(14);
  const { data: uxOverview, isLoading: uxLoading } = trpc.telemetry.getOverview.useQuery(
    { days: uxDays },
    { enabled: isAdmin, refetchOnWindowFocus: false }
  );
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const { data: selectedUserEngagement, isLoading: selectedUserLoading } =
    trpc.telemetry.getUserEngagement.useQuery(
      { userId: selectedUserId ?? undefined, days: uxDays },
      { enabled: isAdmin && selectedUserId !== null, refetchOnWindowFocus: false }
    );
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

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const resetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!uxOverview || selectedUserId !== null) return;
    const firstUser = uxOverview.topUsers?.[0];
    if (firstUser?.userId) {
      setSelectedUserId(firstUser.userId);
    }
  }, [selectedUserId, uxOverview]);

  const handleResetStats = async () => {
    if (resetConfirmText !== "초기화") return;
    await Promise.all([deleteAllPractice.mutateAsync(), deleteAllTest.mutateAsync()]);
    setShowResetConfirm(false);
    setResetConfirmText("");
    alert("통계가 초기화되었습니다.");
  };

  const exampleSummary = useMemo(() => {
    return {
      totalPracticeTime: 42 * 60,
      totalPracticeCount: 18,
      totalTestCount: 7,
      totalCorrect: 5,
      avgPracticeTypingSpeed: 238,
      overallCorrectRate: 71,
      practiceVsTestData: [
        { label: "0회", questionCount: 1, testCount: 1, correctRate: 0 },
        { label: "1-2회", questionCount: 2, testCount: 2, correctRate: 50 },
        { label: "3-5회", questionCount: 3, testCount: 2, correctRate: 50 },
        { label: "6-10회", questionCount: 2, testCount: 1, correctRate: 100 },
        { label: "11회+", questionCount: 1, testCount: 1, correctRate: 100 },
      ],
      weakQuestions: [
        {
          questionId: -900001,
          question: "예시) 표 I-3 상악 치아 크기",
          subjectId: -800001,
          practiceCount: 2,
          testCount: 2,
          correctRate: 50,
          latestSimilarity: 67,
        },
      ],
    };
  }, []);

  const exampleSubjectAnalysis = useMemo(() => {
    const now = Date.now();
    const d = (daysAgo: number) => new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return [
      {
        subjectId: -800001,
        subjectName: "치아형태학 (예시)",
        subjectColor: "#3B82F6",
        totalQuestions: 3,
        practiceCount: 18,
        totalPracticeTime: 42 * 60,
        totalTests: 7,
        overallCorrectRate: 71,
        overallAvgSimilarity: 79,
        questionAnalysis: [
          {
            questionId: -900001,
            question: "예시) 표 I-3 상악 치아 크기",
            practiceCount: 2,
            practiceTime: 5 * 60,
            testCount: 2,
            correctCount: 1,
            correctRate: 50,
            latestSimilarity: 67,
          },
          {
            questionId: -900002,
            question: "예시) Box-1 절치들의 근원심구별",
            practiceCount: 9,
            practiceTime: 21 * 60,
            testCount: 3,
            correctCount: 3,
            correctRate: 100,
            latestSimilarity: 95,
          },
          {
            questionId: -900003,
            question: "예시) Box-9 하악 제1소구치와 제2소구치의 차이점",
            practiceCount: 7,
            practiceTime: 16 * 60,
            testCount: 2,
            correctCount: 1,
            correctRate: 50,
            latestSimilarity: 74,
          },
        ],
        performanceTrend: [
          { date: d(4), correctRate: 50, avgSimilarity: 66, testCount: 2, cumulativePractice: 4 },
          { date: d(2), correctRate: 67, avgSimilarity: 78, testCount: 3, cumulativePractice: 12 },
          { date: d(0), correctRate: 71, avgSimilarity: 83, testCount: 2, cumulativePractice: 18 },
        ],
      },
    ];
  }, []);

  const hasLiveData = Boolean(summary && (summary.totalPracticeCount > 0 || summary.totalTestCount > 0));
  const useExampleData = !summaryLoading && !analysisLoading && (demoPreview || !hasLiveData);
  const summaryData = useExampleData ? exampleSummary : summary;
  const subjectAnalysisData = useExampleData ? exampleSubjectAnalysis : subjectAnalysis;

  // 학습 전략 추천 생성
  const strategies = useMemo(() => {
    if (!summaryData || !subjectAnalysisData) return [];
    const result: { type: "warning" | "success" | "tip"; icon: any; message: string }[] = [];

    // 연습 부족 과목 찾기
    const lowPracticeSubjects = subjectAnalysisData.filter(
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
    const highPracticeLowTest = subjectAnalysisData.filter(
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
    const efficientSubjects = subjectAnalysisData.filter(
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
    if (summaryData.weakQuestions.length > 0) {
      const weakCount = summaryData.weakQuestions.length;
      result.push({
        type: "warning",
        icon: Target,
        message: `시험에서 정답률 70% 미만인 문제가 ${weakCount}개 있습니다. 이 문제들을 집중 연습하면 전체 성적이 향상됩니다.`,
      });
    }

    // 연습 횟수와 시험 성과 상관관계 인사이트
    const pvt = summaryData.practiceVsTestData;
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
  }, [summaryData, subjectAnalysisData]);

  if (summaryLoading || analysisLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">통계를 분석하고 있습니다...</p>
      </div>
    );
  }

  const hasData = Boolean(summaryData && (summaryData.totalPracticeCount > 0 || summaryData.totalTestCount > 0));

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
          onClick={() => { setShowResetConfirm(true); setTimeout(() => resetInputRef.current?.focus(), 100); }}
          className="gap-1 text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          통계 초기화
        </Button>

        {/* 초기화 확인 다이얼로그 */}
        {showResetConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setShowResetConfirm(false); setResetConfirmText(""); }}>
            <div className="bg-card border rounded-xl shadow-xl p-6 w-80 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-semibold text-base">통계 초기화</h3>
              </div>
              <p className="text-sm text-muted-foreground">모든 연습 및 시험 기록이 <strong className="text-foreground">영구적으로 삭제</strong>됩니다. 이 작업은 취소할 수 없습니다.</p>
              <p className="text-sm">확인하려면 아래에 <strong>초기화</strong>를 입력하세요.</p>
              <input
                ref={resetInputRef}
                type="text"
                value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleResetStats(); if (e.key === 'Escape') { setShowResetConfirm(false); setResetConfirmText(""); } }}
                placeholder="초기화"
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-destructive"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setShowResetConfirm(false); setResetConfirmText(""); }}>취소</Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleResetStats}
                  disabled={resetConfirmText !== "초기화" || deleteAllPractice.isPending || deleteAllTest.isPending}
                >
                  {deleteAllPractice.isPending || deleteAllTest.isPending ? "초기화 중..." : "영구 삭제"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {useExampleData && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          예시 화면 · 실제 학습 기록이 없어 예시 통계 데이터를 표시합니다.
        </div>
      )}

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
          <div className="grid gap-4 md:grid-cols-5">
            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">총 연습</CardTitle>
                <Dumbbell className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summaryData!.totalPracticeCount}회</div>
                <p className="text-xs text-muted-foreground">{formatDuration(summaryData!.totalPracticeTime)} 투자</p>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">총 시험</CardTitle>
                <ClipboardCheck className="h-4 w-4 text-purple-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summaryData!.totalTestCount}회</div>
                <p className="text-xs text-muted-foreground">{summaryData!.totalCorrect}회 정답</p>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">시험 정답률</CardTitle>
                <Target className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summaryData!.overallCorrectRate}%</div>
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
                  {subjectAnalysisData && subjectAnalysisData.reduce((s, a) => s + a.totalQuestions, 0) > 0
                    ? (summaryData!.totalPracticeCount / subjectAnalysisData.reduce((s, a) => s + a.totalQuestions, 0)).toFixed(1)
                    : "0"}회
                </div>
                <p className="text-xs text-muted-foreground">전체 문제 기준</p>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">연습 평균 타속</CardTitle>
                <Keyboard className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summaryData!.avgPracticeTypingSpeed} CPM</div>
                <p className="text-xs text-muted-foreground">연습 모드 전체 평균</p>
              </CardContent>
            </Card>
          </div>

          {isAdmin && (
            <Card className="shadow-elegant">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5" />
                      베타 UX 분석 (관리자)
                    </CardTitle>
                    <CardDescription>체류시간, 상호작용, 경로별 사용성 데이터를 기반으로 개선 포인트를 확인합니다.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {[7, 14, 30].map((days) => (
                      <Button
                        key={days}
                        size="sm"
                        variant={uxDays === days ? "default" : "outline"}
                        onClick={() => setUxDays(days)}
                      >
                        {days}일
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {uxLoading || !uxOverview ? (
                  <p className="text-sm text-muted-foreground">UX 통계를 집계 중입니다...</p>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" />활성 사용자</p>
                          <p className="text-xl font-semibold">{uxOverview.summary.activeUserCount}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">세션 수</p>
                          <p className="text-xl font-semibold">{uxOverview.summary.sessionCount}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">평균 체류/세션</p>
                          <p className="text-xl font-semibold">{formatMinutes(uxOverview.summary.avgActiveMinutesPerSession)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><MousePointerClick className="w-3 h-3" />상호작용/세션</p>
                          <p className="text-xl font-semibold">{uxOverview.summary.avgInteractionsPerSession}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">이탈률(1페이지)</p>
                          <p className="text-xl font-semibold">{uxOverview.summary.bounceRate}%</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">5분+ 체류율</p>
                          <p className="text-xl font-semibold">{uxOverview.summary.longStayRate}%</p>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">일자별 활성 추이</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={220}>
                            <LineChart data={uxOverview.dauTrend}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                dataKey="date"
                                tickFormatter={(d) => {
                                  const parts = String(d).split("-");
                                  return `${parts[1]}/${parts[2]}`;
                                }}
                                fontSize={12}
                              />
                              <YAxis yAxisId="left" fontSize={12} />
                              <YAxis yAxisId="right" orientation="right" fontSize={12} />
                              <Tooltip />
                              <Legend />
                              <Line yAxisId="left" type="monotone" dataKey="activeUsers" name="활성 사용자" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                              <Line yAxisId="left" type="monotone" dataKey="sessions" name="세션" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2 }} />
                              <Line yAxisId="right" type="monotone" dataKey="activeMinutes" name="체류시간(분)" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Route className="w-4 h-4" />
                            상위 경로 (체류시간)
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={uxOverview.topPaths.slice(0, 8)}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                dataKey="path"
                                tickFormatter={(value) => String(value).replace(/^\/+/, "").slice(0, 10) || "/"}
                                fontSize={11}
                              />
                              <YAxis fontSize={12} />
                              <Tooltip
                                formatter={(value: any, name: string) => {
                                  if (name === "체류시간(분)") return [formatMinutes(Number(value)), name];
                                  return [value, name];
                                }}
                              />
                              <Bar dataKey="activeMinutes" name="체류시간(분)" fill="#6366f1" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">사용자별 체류/상호작용</CardTitle>
                          <CardDescription>클릭하면 해당 사용자의 세션/경로 상세를 확인할 수 있습니다.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {uxOverview.topUsers.length === 0 ? (
                            <p className="text-sm text-muted-foreground">아직 수집된 사용자 데이터가 없습니다.</p>
                          ) : (
                            uxOverview.topUsers.slice(0, 10).map((user) => (
                              <button
                                key={user.userId}
                                type="button"
                                onClick={() => setSelectedUserId(user.userId)}
                                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                                  selectedUserId === user.userId ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                      {user.email || user.name || `User #${user.userId}`}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      체류 {formatMinutes(user.activeMinutes)} · 상호작용 {user.interactionCount} · 세션 {user.sessionCount}
                                    </p>
                                  </div>
                                  <Badge variant="secondary">{user.loginMethod || "unknown"}</Badge>
                                </div>
                              </button>
                            ))
                          )}
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">선택 사용자 상세</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {selectedUserLoading ? (
                            <p className="text-sm text-muted-foreground">상세 데이터 불러오는 중...</p>
                          ) : !selectedUserEngagement ? (
                            <p className="text-sm text-muted-foreground">사용자를 선택하면 상세 세션 분석이 표시됩니다.</p>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="rounded-md border p-2">
                                  <p className="text-xs text-muted-foreground">총 체류</p>
                                  <p className="font-semibold">{formatMinutes(selectedUserEngagement.summary.totalActiveMinutes)}</p>
                                </div>
                                <div className="rounded-md border p-2">
                                  <p className="text-xs text-muted-foreground">총 상호작용</p>
                                  <p className="font-semibold">{selectedUserEngagement.summary.totalInteractions}</p>
                                </div>
                                <div className="rounded-md border p-2">
                                  <p className="text-xs text-muted-foreground">페이지뷰</p>
                                  <p className="font-semibold">{selectedUserEngagement.summary.totalPageViews}</p>
                                </div>
                                <div className="rounded-md border p-2">
                                  <p className="text-xs text-muted-foreground">세션 수</p>
                                  <p className="font-semibold">{selectedUserEngagement.summary.sessionCount}</p>
                                </div>
                              </div>
                              <div className="space-y-1">
                                {selectedUserEngagement.routes.slice(0, 5).map((route) => (
                                  <div key={route.path} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                                    <span className="truncate mr-2">{route.path}</span>
                                    <span className="text-muted-foreground">
                                      {formatMinutes(route.activeMinutes)} · 클릭 {route.interactionCount}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

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
              {summaryData!.practiceVsTestData.some(d => d.testCount > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={summaryData!.practiceVsTestData}>
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
              {subjectAnalysisData && subjectAnalysisData.length > 0 ? (
                subjectAnalysisData.map((subject) => (
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
                  {summaryData!.weakQuestions.length > 0 ? (
                    <div className="space-y-2">
                      {summaryData!.weakQuestions.map((q) => (
                        <button
                          key={q.questionId}
                          type="button"
                          onClick={() => setLocation(`/practice/${q.questionId}`)}
                          className="w-full text-left flex items-center justify-between p-3 rounded-lg border hover:bg-muted/40 transition-colors"
                          title="클릭하여 연습으로 이동"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate font-medium">{q.question}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-muted-foreground">연습 {q.practiceCount}회</span>
                            </div>
                          </div>
                          <div className="text-right ml-4">
                            <p className={`text-lg font-bold ${q.correctRate >= 40 ? "text-amber-600" : "text-red-600"}`}>
                              {q.correctRate}%
                            </p>
                            <p className="text-xs text-muted-foreground">{q.testCount}회 시험</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      {summaryData!.totalTestCount > 0
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
