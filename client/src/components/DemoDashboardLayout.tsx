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
import { LayoutDashboard, BookOpen, BarChart3, Moon, Sun, PanelLeft } from "lucide-react";
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
    { icon: LayoutDashboard, label: "대시보드", path: "/" },
    { icon: BookOpen, label: "과목 관리", path: "/subjects" },
    { icon: BarChart3, label: "학습 통계", path: "/statistics" },
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
                  isActive={location === item.path}
                  onClick={() => setLocation("/demo")}
                  className="gap-2"
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
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
