import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { useMemo } from "react";
import {
  AlertTriangle,
  Star,
  Flame,
  ChevronRight,
  Play,
  BookOpen,
  Zap,
  Clock,
} from "lucide-react";

// 과목별 미니 그리드 (Subjects.tsx에서 재사용)
function SubjectMiniGrid({
  questions,
  confidenceMap,
}: {
  questions: any[];
  confidenceMap: Map<number, { state: string; displayScore: number }>;
}) {
  if (!questions || questions.length === 0) return null;
  const sorted = [...questions].sort((a, b) => a.displayOrder - b.displayOrder);

  const getBarColor = (questionId: number) => {
    const d = confidenceMap.get(questionId);
    if (!d) return "bg-neutral-200 dark:bg-neutral-700";
    switch (d.state) {
      case "green":
        return "bg-emerald-500";
      case "yellow":
        return "bg-amber-400";
      case "red":
        return "bg-red-500";
      default:
        return "bg-neutral-200 dark:bg-neutral-700";
    }
  };

  return (
    <div className="flex flex-wrap gap-1">
      {sorted.map((q) => {
        const starred = q.isStarred === 1;
        return (
          <div
            key={q.id}
            className={`
              overflow-hidden rounded-md
              bg-white dark:bg-neutral-900
              ${starred
                ? "border-2 border-neutral-400 dark:border-neutral-500"
                : "border border-neutral-200 dark:border-neutral-700"
              }
            `}
            title={`${q.displayOrder}번${confidenceMap.get(q.id) ? ` — ${Math.round(confidenceMap.get(q.id)!.displayScore)}%` : ""}`}
          >
            {/* 상단 색 바 (2px) */}
            <div className={`h-[2px] w-full ${getBarColor(q.id)}`} />
            <div className="w-4 h-3 flex items-center justify-center">
              <span className="text-[7px] font-semibold text-foreground leading-none">
                {q.displayOrder}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 과목 카드 컴포넌트
function SubjectStudyCard({ subject }: { subject: any }) {
  const [, setLocation] = useLocation();
  const { data: questions } = trpc.questions.listBySubject.useQuery({
    subjectId: subject.id,
  });
  const { data: confidenceData } = trpc.confidence.getBySubject.useQuery({
    subjectId: subject.id,
  });

  const confidenceMap = useMemo(() => {
    const map = new Map<number, { state: string; displayScore: number }>();
    if (confidenceData?.questions) {
      for (const q of confidenceData.questions) {
        map.set(q.questionId, { state: q.state, displayScore: q.displayScore });
      }
    }
    return map;
  }, [confidenceData]);

  const agg = confidenceData?.aggregate;
  const totalQ = questions?.length || 0;
  const redCount = agg?.redCount || 0;
  const yellowCount = agg?.yellowCount || 0;
  const greenCount = agg?.greenCount || 0;
  const coldCount = totalQ - redCount - yellowCount - greenCount;

  // 시험일까지 남은 일수
  const daysLeft = useMemo(() => {
    if (!subject.examEndDate) return null;
    const diff = new Date(subject.examEndDate).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }, [subject.examEndDate]);

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
        {/* 헤더: 과목명 + 시험일 */}
        <div className="flex items-center justify-between mb-3">
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
              className={`text-xs flex-shrink-0 ${
                daysLeft <= 3
                  ? "border-red-300 text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
                  : daysLeft <= 7
                    ? "border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400"
                    : "border-muted"
              }`}
            >
              <Clock className="w-3 h-3 mr-1" />
              D{daysLeft > 0 ? `-${daysLeft}` : daysLeft === 0 ? "-Day" : `+${Math.abs(daysLeft)}`}
            </Badge>
          )}
        </div>

        {/* 안정도 요약 + 미니 그리드 */}
        {totalQ > 0 && (
          <>
            <div className="flex items-center gap-3 mb-2">
              {agg && agg.totalQuestions > 0 ? (
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${stateBg} ${stateColor}`}>
                  <span className="text-base font-bold">{agg.averageScore}%</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground">
                  <span>미측정</span>
                </div>
              )}
              <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
                {redCount > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-[3px] rounded-full bg-red-500 inline-block" />{redCount}</span>}
                {yellowCount > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-[3px] rounded-full bg-amber-400 inline-block" />{yellowCount}</span>}
                {greenCount > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-[3px] rounded-full bg-emerald-500 inline-block" />{greenCount}</span>}
                {coldCount > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-[3px] rounded-full bg-neutral-200 dark:bg-neutral-700 inline-block" />{coldCount}</span>}
              </div>
            </div>
            <SubjectMiniGrid
              questions={questions || []}
              confidenceMap={confidenceMap}
            />
          </>
        )}

        {/* 액션 버튼 */}
        <div className="flex gap-2 mt-3">
          {redCount > 0 ? (
            <Button
              size="sm"
              variant="default"
              className="flex-1 gap-1 h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
              onClick={() => setLocation(`/questions/${subject.id}`)}
            >
              <AlertTriangle className="w-3 h-3" />
              취약 {redCount}개 복습
            </Button>
          ) : yellowCount > 0 ? (
            <Button
              size="sm"
              variant="default"
              className="flex-1 gap-1 h-8 text-xs bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => setLocation(`/questions/${subject.id}`)}
            >
              <Zap className="w-3 h-3" />
              보강 {yellowCount}개
            </Button>
          ) : totalQ > 0 ? (
            <Button
              size="sm"
              variant="default"
              className="flex-1 gap-1 h-8 text-xs"
              onClick={() => setLocation(`/questions/${subject.id}`)}
            >
              <Play className="w-3 h-3" />
              학습하기
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1 h-8 text-xs"
              onClick={() => setLocation(`/questions/${subject.id}`)}
            >
              문제 추가
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => setLocation(`/questions/${subject.id}`)}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: subjects, isLoading: subjectsLoading } = trpc.subjects.list.useQuery();
  const { data: dueReviews } = trpc.review.getDue.useQuery();
  const { data: allQuestions } = trpc.questions.listAll.useQuery();

  // 별표 문제 추출
  const starredQuestions = useMemo(() => {
    if (!allQuestions) return [];
    return allQuestions.filter((q) => q.isStarred === 1);
  }, [allQuestions]);

  // 과목 이름 맵
  const subjectNameMap = useMemo(() => {
    const map = new Map<number, { name: string; color: string }>();
    if (subjects) {
      for (const s of subjects) {
        map.set(s.id, { name: s.name, color: s.color || "#3B82F6" });
      }
    }
    return map;
  }, [subjects]);

  // 시험 임박 과목 (7일 이내)
  const urgentSubjects = useMemo(() => {
    if (!subjects) return [];
    return subjects
      .filter((s) => {
        if (!s.examEndDate) return false;
        const diff = new Date(s.examEndDate).getTime() - Date.now();
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        return days >= 0 && days <= 7;
      })
      .sort((a, b) => {
        const dA = new Date(a.examEndDate!).getTime();
        const dB = new Date(b.examEndDate!).getTime();
        return dA - dB;
      });
  }, [subjects]);

  const hasContent = subjects && subjects.length > 0;

  return (
    <div className="space-y-6">
      {/* 헤더 - 간결하게 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">학습 현황</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {hasContent
              ? `${subjects.length}개 과목 · ${allQuestions?.length || 0}개 문제`
              : "과목을 추가하여 학습을 시작하세요"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setLocation("/subjects")}
        >
          <BookOpen className="w-4 h-4" />
          과목 관리
        </Button>
      </div>

      {/* 시험 임박 알림 */}
      {urgentSubjects.length > 0 && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="w-4 h-4 text-red-500" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-400">
              시험 임박
            </span>
          </div>
          <div className="space-y-1.5">
            {urgentSubjects.map((s) => {
              const diff = new Date(s.examEndDate!).getTime() - Date.now();
              const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-sm cursor-pointer hover:bg-red-100/50 dark:hover:bg-red-900/20 rounded px-2 py-1 -mx-1 transition-colors"
                  onClick={() => setLocation(`/questions/${s.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: s.color || "#3B82F6" }}
                    />
                    <span className="font-medium">{s.name}</span>
                  </div>
                  <Badge
                    variant="destructive"
                    className="text-xs"
                  >
                    {days === 0 ? "D-Day" : `D-${days}`}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 복습 알림 */}
      {dueReviews && dueReviews.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                오늘 복습할 문제 {dueReviews.length}개
              </span>
            </div>
          </div>
          <div className="space-y-1">
            {dueReviews.slice(0, 3).map((review) => {
              const question = allQuestions?.find(
                (q) => q.id === review.questionId
              );
              if (!question) return null;
              const subj = subjectNameMap.get(question.subjectId);
              return (
                <div
                  key={review.id}
                  className="flex items-center justify-between text-sm cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/20 rounded px-2 py-1 -mx-1 transition-colors"
                  onClick={() => setLocation(`/practice/${question.id}`)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {subj && (
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: subj.color }}
                      />
                    )}
                    <span className="truncate">{question.question}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 text-xs flex-shrink-0">
                    복습
                  </Button>
                </div>
              );
            })}
            {dueReviews.length > 3 && (
              <p className="text-xs text-muted-foreground px-2 pt-1">
                +{dueReviews.length - 3}개 더
              </p>
            )}
          </div>
        </div>
      )}

      {/* 별표 문제 */}
      {starredQuestions.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span className="text-sm font-semibold">
              별표 문제 {starredQuestions.length}개
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {starredQuestions.slice(0, 10).map((q) => {
              const subj = subjectNameMap.get(q.subjectId);
              return (
                <Badge
                  key={q.id}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent transition-colors text-xs gap-1 py-0.5"
                  onClick={() => setLocation(`/practice/${q.id}`)}
                >
                  {subj && (
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: subj.color }}
                    />
                  )}
                  <span className="truncate max-w-[120px]">{q.question}</span>
                </Badge>
              );
            })}
            {starredQuestions.length > 10 && (
              <Badge variant="secondary" className="text-xs">
                +{starredQuestions.length - 10}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* 과목별 학습 현황 - 메인 */}
      {subjectsLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="shadow-sm">
              <CardContent className="p-4">
                <div className="animate-pulse space-y-3">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                  <div className="flex gap-0.5">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <div key={j} className="w-3 h-3 bg-muted rounded-[2px]" />
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
              <SubjectStudyCard key={subject.id} subject={subject} />
            ))}
          </div>
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg">시작하기</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              첫 과목을 만들고 문제를 추가하여 학습을 시작하세요.
            </p>
            <div className="flex justify-center gap-3">
              <Button onClick={() => setLocation("/subjects")} className="gap-2">
                <BookOpen className="w-4 h-4" />
                첫 과목 만들기
              </Button>
              <Button
                variant="outline"
                onClick={() => setLocation("/demo")}
                className="gap-2"
              >
                <Play className="w-4 h-4" />
                데모 체험
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
