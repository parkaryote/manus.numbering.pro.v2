import { getLoginUrl } from "@/const";
import { LogIn, UserPlus } from "lucide-react";

export default function DemoDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const loginUrl = getLoginUrl();

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* 로그인 유도 배너 */}
      <div className="shrink-0 bg-primary/5 border-b border-primary/10 px-4 py-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground leading-snug">
          <span className="font-medium text-foreground">나만의 학습 통계</span>를 쌓고 문제를 추가하려면 로그인하세요.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={loginUrl}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <LogIn className="h-3 w-3" />
            로그인
          </a>
          <span className="text-muted-foreground/40 text-xs">|</span>
          <a
            href={loginUrl}
            className="inline-flex items-center gap-1 text-xs font-medium bg-primary text-primary-foreground px-2 py-1 rounded-md hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="h-3 w-3" />
            가입
          </a>
        </div>
      </div>

      {/* 메인 콘텐츠 - 스크롤 가능 */}
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  );
}
