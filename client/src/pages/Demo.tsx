import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  Star,
  Flame,
  ChevronRight,
  Play,
  BookOpen,
  Zap,
  Clock,
  LogIn,
} from "lucide-react";

const TOOTH_MORPHOLOGY_NAME = "치아형태학";

type DemoDashboardQuestion = {
  questionId: number;
  subjectId: number;
  subjectName: string;
  subjectColor: string;
  question: string;
  displayOrder: number;
  displayScore: number;
  state: "green" | "yellow" | "red";
  label: string;
  isColdStart?: boolean;
  isStarred: number;
};

type DemoDashboardSubject = {
  id: number;
  name: string;
  description: string | null;
  color: string;
  examEndDate: string | Date | null;
  questionCount: number;
  aggregate: {
    totalQuestions: number;
    averageScore: number;
    greenCount: number;
    yellowCount: number;
    redCount: number;
    state: "green" | "yellow" | "red";
    label: string;
  };
  questions: DemoDashboardQuestion[];
};

function formatCountdownHMS(diffMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}시간 ${minutes}분 ${seconds}초`;
}

function getSignalFillClass(state?: string, isColdStart = false) {
  if (isColdStart) {
    if (state === "green") return "bg-emerald-200/90 dark:bg-emerald-900/60";
    if (state === "yellow") return "bg-amber-200/90 dark:bg-amber-900/60";
    if (state === "red") return "bg-rose-200/90 dark:bg-rose-900/60";
    return "bg-neutral-200/80 dark:bg-neutral-700/75";
  }
  if (state === "green") return "bg-emerald-500";
  if (state === "yellow") return "bg-amber-400";
  if (state === "red") return "bg-red-500";
  return "bg-neutral-200 dark:bg-neutral-700";
}

function DemoSubjectMiniGrid({ questions }: { questions: DemoDashboardQuestion[] }) {
  if (!questions || questions.length === 0) return null;
  const sorted = [...questions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  return (
    <div className="flex flex-wrap gap-1">
      {sorted.map((q) => {
        const fillColor = getSignalFillClass(q.state, Boolean(q.isColdStart));
        const borderColor =
          q.isStarred === 1
            ? "border-2 border-black dark:border-black"
            : "border border-neutral-200 dark:border-neutral-700";
        return (
          <div
            key={q.questionId}
            className={`rounded-md w-3 h-3 ${fillColor} ${borderColor}`}
            title={`문제 ${q.displayOrder} — ${Math.round(q.displayScore)}점${q.isStarred === 1 ? " (중요)" : ""}`}
          />
        );
      })}
    </div>
  );
}

function DemoSubjectStudyCard({
  subject,
  nowMs,
  onOpenSubject,
}: {
  subject: DemoDashboardSubject;
  nowMs: number;
  onOpenSubject: (subjectId: number, subjectName: string) => void;
}) {
  const agg = subject.aggregate;
  const totalQ = subject.questionCount || 0;
  const redCount = agg?.redCount || 0;
  const yellowCount = agg?.yellowCount || 0;
  const greenCount = agg?.greenCount || 0;
  const coldCount = totalQ - redCount - yellowCount - greenCount;

  const examDiffMs = subject.examEndDate
    ? new Date(subject.examEndDate).getTime() - nowMs
    : null;
  const daysLeft =
    examDiffMs === null ? null : Math.ceil(examDiffMs / (1000 * 60 * 60 * 24));
  const isToothMorphology = String(subject?.name ?? "").includes(TOOTH_MORPHOLOGY_NAME);
  const toothCountdown = examDiffMs && examDiffMs > 0 ? formatCountdownHMS(examDiffMs) : null;

  const stateColor =
    agg?.state === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : agg?.state === "yellow"
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  const stateBg =
    agg?.state === "green"
      ? "bg-emerald-50 dark:bg-emerald-950/30"
      : agg?.state === "yellow"
        ? "bg-amber-50 dark:bg-amber-950/30"
        : "bg-red-50 dark:bg-red-950/30";

  return (
    <Card className="shadow-sm hover:shadow-md transition-all">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: subject.color || "#3B82F6" }}
            />
            <span className="font-semibold text-sm truncate">{subject.name}</span>
            {totalQ > 0 && (
              <span className="text-xs text-muted-foreground">{totalQ}문제</span>
            )}
          </div>
          {daysLeft !== null && (
            <Badge
              variant="outline"
              className={`text-xs max-w-full flex-shrink-0 ${
                isToothMorphology
                  ? "border-red-400 text-red-700 bg-red-100/90 dark:bg-red-950/40 dark:text-red-300 animate-pulse"
                  : daysLeft <= 3
                    ? "border-red-300 text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                    : daysLeft <= 7
                      ? "border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400"
                      : "border-muted"
              }`}
            >
              <Clock className="w-3 h-3 mr-1" />
              {isToothMorphology && toothCountdown
                ? `D${daysLeft > 0 ? `-${daysLeft}` : "-Day"} · ${toothCountdown}`
                : `D${daysLeft > 0 ? `-${daysLeft}` : daysLeft === 0 ? "-Day" : `+${Math.abs(daysLeft)}`}`}
            </Badge>
          )}
        </div>

        {totalQ > 0 && (
          <>
            <div className="flex items-center gap-3 mb-2">
              {agg && agg.totalQuestions > 0 ? (
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${stateBg} ${stateColor}`}
                >
                  <span className="text-base font-bold">{agg.averageScore}점</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground">
                  <span>미측정</span>
                </div>
              )}
              <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
                {redCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-[3px] rounded-full bg-red-500 inline-block" />
                    {redCount}
                  </span>
                )}
                {yellowCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-[3px] rounded-full bg-amber-400 inline-block" />
                    {yellowCount}
                  </span>
                )}
                {greenCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-[3px] rounded-full bg-emerald-500 inline-block" />
                    {greenCount}
                  </span>
                )}
                {coldCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-[3px] rounded-full bg-neutral-200 dark:bg-neutral-700 inline-block" />
                    {coldCount}
                  </span>
                )}
              </div>
            </div>
            <DemoSubjectMiniGrid questions={subject.questions} />
          </>
        )}

        <div className="flex gap-2 mt-3">
          {redCount > 0 ? (
            <Button
              size="sm"
              variant="default"
              className="flex-1 gap-1 h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
              onClick={() => onOpenSubject(subject.id, subject.name)}
            >
              <AlertTriangle className="w-3 h-3" />
              취약 {redCount}개 복습
            </Button>
          ) : yellowCount > 0 ? (
            <Button
              size="sm"
              variant="default"
              className="flex-1 gap-1 h-8 text-xs bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => onOpenSubject(subject.id, subject.name)}
            >
              <Zap className="w-3 h-3" />
              보충문제 {yellowCount}개
            </Button>
          ) : totalQ > 0 ? (
            <Button
              size="sm"
              variant="default"
              className="flex-1 gap-1 h-8 text-xs"
              onClick={() => onOpenSubject(subject.id, subject.name)}
            >
              <Play className="w-3 h-3" />
              학습하기
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1 h-8 text-xs"
              onClick={() => onOpenSubject(subject.id, subject.name)}
            >
              문제 보기
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => onOpenSubject(subject.id, subject.name)}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Demo() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const showLoginCta = !user || user.loginMethod === "guest";
  const [nowMs, setNowMs] = useState(() => Date.now());
  const dashboardQuery = trpc.demo.dashboard.useQuery(undefined, {
    retry: 3,
    refetchOnWindowFocus: true,
  });
  const dashboard = dashboardQuery.data;
  const subjects = (dashboard?.subjects ?? []) as DemoDashboardSubject[];

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const urgentSubjects = dashboard?.urgentSubjects ?? [];
  const dueReviews = (dashboard?.todayReviewQuestions ?? []) as DemoDashboardQuestion[];
  const starredQuestions = (dashboard?.starredQuestions ?? []) as DemoDashboardQuestion[];
  const isLoading = dashboardQuery.isLoading;
  const isFailed = !isLoading && subjects.length === 0 && dashboardQuery.isError;

  const hasContent = subjects.length > 0;

  const openSubject = (subjectId: number, subjectName: string) => {
    setLocation(`/demo/questions/${subjectId}`);
  };

  const openPractice = (question: DemoDashboardQuestion) => {
    setLocation(`/demo/practice/${question.questionId}?scrollNav=1`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">학습 현황</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {hasContent
              ? `${dashboard?.totalSubjects ?? subjects.length}개 과목 · ${dashboard?.totalQuestions ?? 0}개 문제`
              : "데모 과목을 불러오는 중입니다"}
          </p>
        </div>
        {showLoginCta && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setLocation("/login")}
          >
            <LogIn className="w-4 h-4" />
            로그인 / 가입
          </Button>
        )}
      </div>

      {urgentSubjects.length > 0 && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="w-4 h-4 text-red-500" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-400">시험 임박</span>
          </div>
          <div className="space-y-1.5">
            {urgentSubjects.map((subject) => {
              const diff = new Date(subject.examEndDate!).getTime() - nowMs;
              const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
              const isToothMorphology = String(subject?.name ?? "").includes(TOOTH_MORPHOLOGY_NAME);
              const countdown = diff > 0 ? formatCountdownHMS(diff) : null;
              return (
                <div
                  key={subject.id}
                  className="flex items-center justify-between text-sm cursor-pointer hover:bg-red-100/50 dark:hover:bg-red-900/20 rounded px-2 py-1 -mx-1 transition-colors"
                  onClick={() => openSubject(subject.id, subject.name)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: subject.color || "#3B82F6" }} />
                    <span className="font-medium">{subject.name}</span>
                  </div>
                  <Badge variant="destructive" className={`text-xs ${isToothMorphology ? "animate-pulse" : ""}`}>
                    {isToothMorphology && countdown
                      ? `${days === 0 ? "D-Day" : `D-${days}`} · ${countdown}`
                      : days === 0
                        ? "D-Day"
                        : `D-${days}`}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {dueReviews.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                오늘 복습할 문제 {dashboard?.todayReviewCount ?? dueReviews.length}개
              </span>
            </div>
          </div>
          <div className="space-y-1">
            {dueReviews.slice(0, 3).map((question) => (
              <div
                key={`${question.subjectId}-${question.questionId}`}
                className="flex items-center justify-between text-sm cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/20 rounded px-2 py-1 -mx-1 transition-colors"
                onClick={() => openPractice(question)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: question.subjectColor || "#3B82F6" }} />
                  <span className="truncate">{question.question}</span>
                </div>
                <Button variant="ghost" size="sm" className="h-6 text-xs flex-shrink-0">
                  복습
                </Button>
              </div>
            ))}
            {dueReviews.length > 3 && (
              <p className="text-xs text-muted-foreground px-2 pt-1">+{dueReviews.length - 3}개 더</p>
            )}
          </div>
        </div>
      )}

      {starredQuestions.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span className="text-sm font-semibold">
              별표 문제 {dashboard?.starredCount ?? starredQuestions.length}개
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {starredQuestions.slice(0, 10).map((question) => (
              <Badge
                key={`${question.subjectId}-${question.questionId}`}
                variant="outline"
                className="cursor-pointer hover:bg-accent transition-colors text-xs gap-1 py-0.5"
                onClick={() => openPractice(question)}
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: question.subjectColor || "#3B82F6" }} />
                <span className="truncate max-w-[120px]">{question.question}</span>
              </Badge>
            ))}
            {(dashboard?.starredCount ?? starredQuestions.length) > 10 && (
              <Badge variant="secondary" className="text-xs">
                +{(dashboard?.starredCount ?? starredQuestions.length) - 10}
              </Badge>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((idx) => (
            <Card key={`demo-skeleton-${idx}`} className="shadow-sm">
              <CardContent className="p-4">
                <div className="animate-pulse space-y-3">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                  <div className="flex gap-0.5">
                    {Array.from({ length: 8 }).map((_, dotIdx) => (
                      <div key={`dot-${dotIdx}`} className="w-3 h-3 bg-muted rounded-[2px]" />
                    ))}
                  </div>
                  <div className="h-8 bg-muted rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : hasContent ? (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            과목별 학습
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {subjects.map((subject) => (
              <DemoSubjectStudyCard
                key={subject.id}
                subject={subject}
                nowMs={nowMs}
                onOpenSubject={openSubject}
              />
            ))}
          </div>
        </div>
      ) : isFailed ? (
        <Card className="shadow-sm">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg">데모 로딩 실패</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              네트워크 상태를 확인하고 다시 시도해주세요.
            </p>
            <div className="flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  void dashboardQuery.refetch();
                }}
              >
                다시 시도
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg">데모 준비 중</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">데모 과목을 구성하고 있습니다. 잠시 후 다시 확인해주세요.</p>
            {showLoginCta && (
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => setLocation("/login")} className="gap-2">
                  <LogIn className="w-4 h-4" />
                  로그인하기
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
