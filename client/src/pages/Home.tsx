import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { BookOpen, FileQuestion, Dumbbell, ClipboardCheck, TrendingUp, Play } from "lucide-react";

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: subjects, isLoading: subjectsLoading } = trpc.subjects.list.useQuery();
  const { data: questionCount } = trpc.questions.count.useQuery();
  const { data: practiceSessions } = trpc.practice.getByUser.useQuery();
  const { data: testSessions } = trpc.test.getByUser.useQuery();
  const { data: dueReviews } = trpc.review.getDue.useQuery();
  const { data: allQuestions } = trpc.questions.listAll.useQuery();

  const stats = {
    totalSubjects: subjects?.length || 0,
    totalQuestions: questionCount || 0,
    totalPractice: practiceSessions?.length || 0,
    totalTests: testSessions?.length || 0,
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">numbering.pro</h1>
        <p className="text-muted-foreground mt-2">넘버링 달인, 그림빵 장인 되기</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-elegant">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">전체 과목</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSubjects}</div>
            <p className="text-xs text-muted-foreground">등록된 과목 수</p>
          </CardContent>
        </Card>

        <Card className="shadow-elegant">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">전체 문제</CardTitle>
            <FileQuestion className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalQuestions}</div>
            <p className="text-xs text-muted-foreground">등록된 문제 수</p>
          </CardContent>
        </Card>

        <Card className="shadow-elegant">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">연습 횟수</CardTitle>
            <Dumbbell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalPractice}</div>
            <p className="text-xs text-muted-foreground">총 연습 세션</p>
          </CardContent>
        </Card>

        <Card className="shadow-elegant">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">시험 횟수</CardTitle>
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalTests}</div>
            <p className="text-xs text-muted-foreground">총 시험 세션</p>
          </CardContent>
        </Card>
      </div>

      {/* Review Reminders */}
      {dueReviews && dueReviews.length > 0 && (
        <Card className="shadow-elegant border-accent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-accent" />
              복습 알림
            </CardTitle>
            <CardDescription>
              오늘 복습할 문제가 {dueReviews.length}개 있습니다
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {dueReviews.slice(0, 5).map((review) => {
                const question = allQuestions?.find(q => q.id === review.questionId);
                if (!question) return null;
                return (
                  <div
                    key={review.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                    onClick={() => setLocation(`/test/${question.id}`)}
                  >
                    <div className="flex-1">
                      <p className="font-medium line-clamp-1">{question.question}</p>
                      <p className="text-sm text-muted-foreground">
                        반복 횟수: {review.repetitionCount}회
                      </p>
                    </div>
                    <Button variant="ghost" size="sm">
                      복습하기
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle>빠른 시작</CardTitle>
          <CardDescription>학습을 시작하려면 아래 버튼을 클릭하세요</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <Button onClick={() => setLocation("/demo")} variant="default" className="gap-2">
            <Play className="h-4 w-4" />
            데모 시작 (로그인 불필요)
          </Button>
          <Button onClick={() => setLocation("/subjects")} variant="outline" className="gap-2">
            <BookOpen className="h-4 w-4" />
            과목 관리
          </Button>
          <Button onClick={() => setLocation("/statistics")} variant="outline" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            학습 통계 보기
          </Button>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      {subjectsLoading ? (
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>최근 활동</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">로딩 중...</p>
          </CardContent>
        </Card>
      ) : subjects && subjects.length === 0 ? (
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>시작하기</CardTitle>
            <CardDescription>아직 등록된 과목이 없습니다</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              첫 과목을 생성하고 문제를 추가하여 학습을 시작하세요.
            </p>
            <Button onClick={() => setLocation("/subjects")}>
              첫 과목 만들기
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>최근 과목</CardTitle>
            <CardDescription>등록된 과목 목록</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {subjects?.slice(0, 5).map((subject) => (
                <div
                  key={subject.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => setLocation(`/questions/${subject.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: subject.color || "#3B82F6" }}
                    />
                    <div>
                      <p className="font-medium">{subject.name}</p>
                      {subject.description && (
                        <p className="text-sm text-muted-foreground">{subject.description}</p>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">
                    문제 보기
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
