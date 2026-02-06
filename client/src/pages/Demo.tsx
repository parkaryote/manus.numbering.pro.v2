import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { BookOpen, ArrowLeft, FileText, Image as ImageIcon, Table } from "lucide-react";

export default function Demo() {
  const [, setLocation] = useLocation();
  const { data: subjects, isLoading } = trpc.demo.subjects.useQuery();

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => setLocation("/")} className="gap-2 mb-4">
          <ArrowLeft className="h-4 w-4" />
          돌아가기
        </Button>
        <h1 className="text-4xl font-semibold tracking-tight">데모 모드</h1>
        <p className="text-muted-foreground mt-2">로그인 없이 연습할 수 있습니다</p>
      </div>

      {isLoading ? (
        <Card className="shadow-elegant">
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">로딩 중...</p>
          </CardContent>
        </Card>
      ) : subjects && subjects.length > 0 ? (
        <div className="space-y-4">
          {subjects.map((subject) => (
            <Card key={subject.id} className="shadow-elegant hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: subject.color || "#3B82F6" }}
                  />
                  <CardTitle>{subject.name}</CardTitle>
                </div>
                {subject.description && (
                  <CardDescription>{subject.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <DemoQuestions subjectId={subject.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="shadow-elegant">
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              아직 데모 과목이 없습니다
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DemoQuestions({ subjectId }: { subjectId: number }) {
  const [, setLocation] = useLocation();
  const { data: questions, isLoading } = trpc.demo.questions.useQuery({ subjectId });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">문제 로딩 중...</p>;
  }

  if (!questions || questions.length === 0) {
    return <p className="text-sm text-muted-foreground">등록된 문제가 없습니다</p>;
  }

  return (
    <div className="space-y-2">
      {questions.map((question) => {
        const isImageQuestion = !!question.imageUrl;
        const isTableQuestion = !!question.tableData;
        const questionType = isTableQuestion ? "table" : isImageQuestion ? "image" : "text";
        
        return (
          <div
            key={question.id}
            className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1">
              {questionType === "text" && <FileText className="h-4 w-4 text-blue-500" />}
              {questionType === "image" && <ImageIcon className="h-4 w-4 text-green-500" />}
              {questionType === "table" && <Table className="h-4 w-4 text-purple-500" />}
              <div className="flex-1">
                <p className="font-medium line-clamp-1">{question.question}</p>
                <p className="text-sm text-muted-foreground">
                  난이도: {question.difficulty === "easy" ? "쉬움" : question.difficulty === "medium" ? "보통" : "어려움"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/demo/practice/${question.id}`)}
              >
                연습 모드
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/demo/test/${question.id}`)}
              >
                시험 모드
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
