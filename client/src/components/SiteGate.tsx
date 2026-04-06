import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lock, BookOpen } from "lucide-react";

const STORAGE_KEY = "site_access_granted";
const SITE_PASSWORD = "wlsgur37";

export function useSiteAccess() {
  const [granted, setGranted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const grant = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setGranted(true);
  };

  return { granted, grant };
}

interface SiteGateProps {
  onGranted: () => void;
}

export function SiteGate({ onGranted }: SiteGateProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);

  const handleSubmit = () => {
    if (password === SITE_PASSWORD) {
      onGranted();
    } else {
      setError("비밀번호가 올바르지 않습니다");
      setShaking(true);
      setPassword("");
      setTimeout(() => setShaking(false), 500);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* 로고/타이틀 */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-7 h-7 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">타이핑 퀴즈</h1>
          <p className="text-sm text-muted-foreground">서술형 문제 암기 도우미</p>
        </div>

        {/* 비밀번호 카드 */}
        <Card className={`shadow-elegant transition-all ${shaking ? "animate-shake" : ""}`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="w-4 h-4" />
              접속 비밀번호
            </CardTitle>
            <CardDescription className="text-xs">
              비밀번호를 입력하면 이후 자동으로 접속됩니다
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="site-password" className="sr-only">비밀번호</Label>
              <Input
                id="site-password"
                type="password"
                placeholder="비밀번호 입력"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                autoFocus
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <Button className="w-full" onClick={handleSubmit}>
              입장
            </Button>
          </CardContent>
        </Card>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}
