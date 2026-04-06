import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { BookOpen, Moon, Sun, PanelLeft, LogIn } from "lucide-react";
import { CSSProperties, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "./ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { useIsMobile } from "@/hooks/useMobile";

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;

export default function DemoDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <DemoDashboardContent>{children}</DemoDashboardContent>
    </SidebarProvider>
  );
}

function DemoDashboardContent({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const isMobile = useIsMobile();

  const menuItems = [
    { icon: BookOpen, label: "데모 과목", path: "/demo" },
  ];

  return (
    <>
      <Sidebar>
        <SidebarHeader className="p-4 border-b">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">numbering.pro</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">데모 모드</p>
        </SidebarHeader>
        <SidebarContent className="p-2">
          <SidebarMenu>
            {menuItems.map((item) => (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton
                  isActive={location.startsWith(item.path)}
                  onClick={() => setLocation(item.path)}
                  className="gap-2"
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          {/* 가입/로그인 유도 */}
          <div className="mt-4 px-1">
            <Button
              variant="default"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={() => setLocation("/demo")}
            >
              <LogIn className="h-3.5 w-3.5" />
              가입 / 로그인
            </Button>
            <p className="text-[10px] text-muted-foreground text-center mt-1.5">
              가입하면 나만의 통계가 쌓입니다
            </p>
          </div>

        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        {/* 상단 헤더 */}
        <header className="flex h-14 items-center gap-2 border-b px-4 sticky top-0 bg-background z-10">
          {isMobile && (
            <SidebarTrigger>
              <PanelLeft className="h-4 w-4" />
            </SidebarTrigger>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>

        {/* 페이지 컨텐츠 */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </SidebarInset>
    </>
  );
}
