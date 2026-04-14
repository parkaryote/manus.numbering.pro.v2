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
import { LayoutDashboard, LogOut, BookOpen, BarChart3, Settings, Moon, Sun, Menu, X, LogIn, Eye } from "lucide-react";
import { useState } from "react";
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
const DEMO_PUBLISHING_ENABLED = import.meta.env.VITE_ALLOW_DEMO_PUBLISHING === "true";

function isGuestUser(user: { loginMethod?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return user.loginMethod === "guest";
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading } = useAuth();

  if (loading) {
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
  const isGuest = !user || isGuestUser(user);
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const adminViewItems = user?.role === "admin"
    ? [{ icon: Eye, label: "데모 화면", path: "/demo" }]
    : [];

  const openLogin = () => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    setLocation(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

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
          <div className="flex items-center gap-1.5">
            <span className="text-base font-extrabold tracking-tight text-black dark:text-white">
              numbering.pro
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
              Beta
            </span>
          </div>
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
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-extrabold tracking-tight text-black dark:text-white">
                    numbering.pro
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                    Beta
                  </span>
                </div>
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
                  {DEMO_PUBLISHING_ENABLED &&
                    adminMenuItems.map((item) => {
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
                  {adminViewItems.map((item) => {
                    const isActive = location.startsWith(item.path);
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
                      {(user?.name?.charAt(0) ?? "G").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground truncate">
                    {isGuest ? "게스트 모드" : user?.name}
                  </span>
                </div>
                {isGuest ? (
                  <button
                    onClick={() => {
                      openLogin();
                      setMobileOpen(false);
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-primary hover:bg-primary/10 rounded-md transition-colors"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    <span>로그인 / 가입</span>
                  </button>
                ) : (
                  <button
                    onClick={logout}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>로그아웃</span>
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full max-w-[1400px] mx-auto px-3 md:px-4">{children}</div>
        </main>
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
              {DEMO_PUBLISHING_ENABLED &&
                adminMenuItems.map((item) => {
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
              {adminViewItems.map((item) => {
                const isActive = location.startsWith(item.path);
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
                        {(user?.name?.charAt(0) ?? "G").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {isGuest ? "게스트 모드" : user?.name || "계정"}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" side="right" className="w-48">
              <div className="px-2 py-1.5 text-xs text-muted-foreground border-b mb-1">
                {isGuest ? "게스트 모드" : user?.name}
              </div>
              {user?.role === "admin" && (
                <>
                  {DEMO_PUBLISHING_ENABLED && (
                    <DropdownMenuItem
                      onClick={() => setLocation("/admin/demo-management")}
                      className="cursor-pointer text-xs"
                    >
                      <Settings className="mr-2 h-3.5 w-3.5" />
                      <span>데모 관리</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => setLocation("/demo")}
                    className="cursor-pointer text-xs"
                  >
                    <Eye className="mr-2 h-3.5 w-3.5" />
                    <span>데모 화면</span>
                  </DropdownMenuItem>
                  <div className="my-1 border-t" />
                </>
              )}
              {isGuest ? (
                <DropdownMenuItem
                  onClick={openLogin}
                  className="cursor-pointer text-xs"
                >
                  <LogIn className="mr-2 h-3.5 w-3.5" />
                  <span>로그인 / 가입</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive text-xs"
                >
                  <LogOut className="mr-2 h-3.5 w-3.5" />
                  <span>로그아웃</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        <div className="w-full max-w-[1400px] mx-auto px-3 md:px-4">
          <div className="hidden md:flex items-center justify-start pt-3 pb-2">
            <div className="inline-flex items-end gap-2">
              <span className="text-xl font-extrabold tracking-tight text-black dark:text-white">
                numbering.pro
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500 dark:text-neutral-400">
                Beta Test
              </span>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
