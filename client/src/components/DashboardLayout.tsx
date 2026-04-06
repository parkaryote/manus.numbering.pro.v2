import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/useMobile";
import { LayoutDashboard, LogOut, BookOpen, BarChart3, Settings, Moon, Sun, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { useTheme } from "@/contexts/ThemeContext";

const menuItems = [
  { icon: LayoutDashboard, label: "대시보드", path: "/" },
  { icon: BookOpen, label: "과목 관리", path: "/subjects" },
  { icon: BarChart3, label: "학습 통계", path: "/statistics" },
];

const adminMenuItems = [
  { icon: Settings, label: "데모 관리", path: "/admin/demo-management" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      setLocation("/demo");
    }
  }, [loading, user, setLocation]);

  if (loading || !user) {
    return <DashboardLayoutSkeleton />;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </TooltipProvider>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* 모바일 상단 헤더 */}
        <header className="flex h-12 items-center justify-between border-b px-4 sticky top-0 bg-background z-40">
          <button
            onClick={() => setMobileOpen(true)}
            className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-md transition-colors"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold">numbering.pro</span>
          <button
            onClick={toggleTheme}
            className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-md transition-colors"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>

        {/* 모바일 드로어 */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex">
            <div className="w-56 bg-background border-r flex flex-col py-3 gap-1">
              <div className="flex items-center justify-between px-3 mb-2">
                <span className="text-sm font-semibold">numbering.pro</span>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="h-7 w-7 flex items-center justify-center hover:bg-accent rounded-md"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {menuItems.map((item) => {
                const isActive = location === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => { setLocation(item.path); setMobileOpen(false); }}
                    className={`flex items-center gap-3 mx-2 px-3 py-2 rounded-md text-sm transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              {user?.role === "admin" && (
                <>
                  <div className="mx-3 my-1 border-t" />
                  {adminMenuItems.map((item) => {
                    const isActive = location === item.path;
                    return (
                      <button
                        key={item.path}
                        onClick={() => { setLocation(item.path); setMobileOpen(false); }}
                        className={`flex items-center gap-3 mx-2 px-3 py-2 rounded-md text-sm transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </>
              )}
              <div className="mt-auto px-3 pt-2 border-t mx-2">
                <div className="flex items-center gap-2 py-2">
                  <Avatar className="h-7 w-7 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground truncate">{user?.name}</span>
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>로그아웃</span>
                </button>
              </div>
            </div>
            <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
          </div>
        )}

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    );
  }

  // 데스크탑: 항상 아이콘만 표시하는 슬림 사이드바
  return (
    <div className="min-h-screen bg-background flex">
      {/* 슬림 사이드바 */}
      <aside className="w-12 flex flex-col items-center py-3 gap-1 border-r bg-background shrink-0 sticky top-0 h-screen overflow-y-auto">
        {/* 메뉴 아이템들 */}
        <div className="flex flex-col items-center gap-1 w-full">
          {menuItems.map((item) => {
            const isActive = location === item.path;
            return (
              <Tooltip key={item.path}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setLocation(item.path)}
                    className={`h-9 w-9 flex items-center justify-center rounded-md transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}

          {user?.role === "admin" && (
            <>
              <div className="w-6 border-t my-1" />
              {adminMenuItems.map((item) => {
                const isActive = location === item.path;
                return (
                  <Tooltip key={item.path}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setLocation(item.path)}
                        className={`h-9 w-9 flex items-center justify-center rounded-md transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        <item.icon className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </>
          )}
        </div>

        {/* 하단 영역 */}
        <div className="mt-auto flex flex-col items-center gap-1">
          {/* 다크모드 토글 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleTheme}
                className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {theme === "dark" ? "라이트 모드" : "다크 모드"}
            </TooltipContent>
          </Tooltip>

          {/* 유저 아바타 + 로그아웃 */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-accent transition-colors">
                    <Avatar className="h-7 w-7 border shrink-0">
                      <AvatarFallback className="text-xs font-medium">
                        {user?.name?.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {user?.name || "계정"}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" side="right" className="w-48">
              <div className="px-2 py-1.5 text-xs text-muted-foreground border-b mb-1">
                {user?.name}
              </div>
              {user?.role === "admin" && (
                <>
                  <DropdownMenuItem
                    onClick={() => setLocation("/admin/demo-management")}
                    className="cursor-pointer text-xs"
                  >
                    <Settings className="mr-2 h-3.5 w-3.5" />
                    <span>데모 관리</span>
                  </DropdownMenuItem>
                  <div className="my-1 border-t" />
                </>
              )}
              <DropdownMenuItem
                onClick={logout}
                className="cursor-pointer text-destructive focus:text-destructive text-xs"
              >
                <LogOut className="mr-2 h-3.5 w-3.5" />
                <span>로그아웃</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
