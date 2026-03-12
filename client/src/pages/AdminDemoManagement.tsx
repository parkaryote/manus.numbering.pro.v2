import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BookOpen, FileText, Image as ImageIcon, Table2, Star, StarOff, ArrowLeft, Loader2, ExternalLink } from "lucide-react";

export default function AdminDemoManagement() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // 관리자 권한 확인
  if (user && user.role !== "admin") {
    setLocation("/");
    return null;
  }

  const utils = trpc.useUtils();

  const { data: subjects = [], isLoading: subjectsLoading } = trpc.admin.demo.subjects.useQuery();
  const { data: allQuestions = [], isLoading: questionsLoading } = trpc.admin.demo.allQuestions.useQuery();

  const toggleSubjectMutation = trpc.admin.demo.toggleSubjectDemo.useMutation({
    onSuccess: () => {
      utils.admin.demo.subjects.invalidate();
      utils.admin.demo.allQuestions.invalidate();
      toast.success("데모 설정이 변경되었습니다");
    },
    onError: (err) => toast.error("변경 실패: " + err.message),
  });

  const toggleQuestionMutation = trpc.admin.demo.toggleQuestionDemo.useMutation({
    onSuccess: () => {
      utils.admin.demo.allQuestions.invalidate();
      toast.success("데모 설정이 변경되었습니다");
    },
    onError: (err) => toast.error("변경 실패: " + err.message),
  });

  const isLoading = subjectsLoading || questionsLoading;

  const getQuestionTypeIcon = (question: any) => {
    if (question.tableData) return <Table2 className="w-3.5 h-3.5" />;
    if (question.imageUrl) return <ImageIcon className="w-3.5 h-3.5" />;
    return <FileText className="w-3.5 h-3.5" />;
  };

  const getQuestionTypeLabel = (question: any) => {
    if (question.tableData) return "표";
    if (question.imageUrl) return "이미지";
    return "텍스트";
  };

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/subjects")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">데모 관리</h1>
          <p className="text-muted-foreground mt-1">
            현재 데모로 지정된 과목과 문제 목록입니다. 과목/문제 수정 시 등록 화면에서 "데모로 지정" 체크박스를 사용하세요.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* 데모 과목 목록 */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" />
              <h2 className="text-xl font-semibold">데모 과목</h2>
              <Badge variant="secondary">{subjects.length}개</Badge>
            </div>

            {subjects.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>데모로 지정된 과목이 없습니다.</p>
                  <p className="text-sm mt-1">과목 관리 화면에서 과목 수정 시 "데모 과목으로 지정"을 체크하세요.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {subjects.map((subject: any) => {
                  const subjectQuestions = allQuestions.filter((q: any) => q.subjectId === subject.id);
                  return (
                    <Card key={subject.id} className="border-amber-200 dark:border-amber-800">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            className="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-75 transition-opacity"
                            onClick={() => setLocation(`/questions/${subject.id}`)}
                          >
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: subject.color || "#3B82F6" }}
                            />
                            <CardTitle className="text-base truncate">{subject.name}</CardTitle>
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          </button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50 flex-shrink-0"
                            onClick={() => toggleSubjectMutation.mutate({ subjectId: subject.id, isDemo: 0 })}
                            disabled={toggleSubjectMutation.isPending}
                          >
                            <StarOff className="w-3.5 h-3.5" />
                            데모 해제
                          </Button>
                        </div>
                        {subject.description && (
                          <p className="text-sm text-muted-foreground truncate">{subject.description}</p>
                        )}
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-sm text-muted-foreground">
                          문제 {subjectQuestions.length}개 중{" "}
                          <span className="font-medium text-amber-600">
                            {subjectQuestions.filter((q: any) => q.isDemo).length}개
                          </span>{" "}
                          데모 지정
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* 데모 문제 목록 */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" />
              <h2 className="text-xl font-semibold">데모 문제</h2>
              <Badge variant="secondary">
                {allQuestions.filter((q: any) => q.isDemo).length}개
              </Badge>
            </div>

            {allQuestions.filter((q: any) => q.isDemo).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>데모로 지정된 문제가 없습니다.</p>
                  <p className="text-sm mt-1">문제 등록/수정 화면에서 "데모 문제로 지정"을 체크하세요.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {subjects.map((subject: any) => {
                  const demoQs = allQuestions.filter((q: any) => q.subjectId === subject.id && q.isDemo);
                  if (demoQs.length === 0) return null;
                  return (
                    <div key={subject.id} className="space-y-2">
                      <div className="flex items-center gap-2 py-1">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: subject.color || "#3B82F6" }}
                        />
                        <span className="text-sm font-semibold text-muted-foreground">{subject.name}</span>
                      </div>
                      {demoQs.map((question: any) => (
                        <Card key={question.id} className="ml-4 border-amber-100 dark:border-amber-900">
                          <CardContent className="py-3 px-4">
                            <div className="flex items-start justify-between gap-3">
                              <button
                                className="flex-1 min-w-0 text-left hover:opacity-75 transition-opacity"
                                onClick={() => setLocation(`/questions/${question.subjectId}`)}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="gap-1 text-xs py-0">
                                    {getQuestionTypeIcon(question)}
                                    {getQuestionTypeLabel(question)}
                                  </Badge>
                                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                                </div>
                                <p className="text-sm line-clamp-2">{question.question}</p>
                              </button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50 flex-shrink-0"
                                onClick={() => toggleQuestionMutation.mutate({ questionId: question.id, isDemo: 0 })}
                                disabled={toggleQuestionMutation.isPending}
                              >
                                <StarOff className="w-3.5 h-3.5" />
                                해제
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
