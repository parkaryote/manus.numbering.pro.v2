import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Dot,
} from "recharts";
import { format, differenceInDays, differenceInHours, differenceInMinutes } from "date-fns";
import { ko } from "date-fns/locale";

interface Props {
  questionId: number | null;
  questionTitle?: string;
  open: boolean;
  onClose: () => void;
}

// 시간 축 레이블 포맷
function formatTimeLabel(isoStr: string, allPoints: { at: string }[]): string {
  const date = new Date(isoStr);
  const first = new Date(allPoints[0].at);
  const diffDays = differenceInDays(date, first);
  if (diffDays === 0) {
    const diffH = differenceInHours(date, first);
    if (diffH === 0) {
      const diffM = differenceInMinutes(date, first);
      return `+${diffM}분`;
    }
    return `+${diffH}시간`;
  }
  if (diffDays < 30) return `+${diffDays}일`;
  return format(date, "M/d", { locale: ko });
}

// 상태별 색상
const STATE_COLORS = {
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
};

// 커스텀 점 렌더러 (시험=원, 연습=호버 시에만 표시)
const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;
  const color = STATE_COLORS[payload.state as keyof typeof STATE_COLORS] || "#6b7280";

  if (payload.eventType === "test") {
    // 시험 - 원
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={5} fill={payload.isCorrect ? "#22c55e" : "#ef4444"} stroke="white" strokeWidth={1.5} />
      </g>
    );
  }
  if (payload.eventType === "now") {
    // 현재 시점 - 큰 원
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={6} fill={color} stroke="white" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={10} fill={color} fillOpacity={0.2} />
      </g>
    );
  }
  // 연습 - 호버 시에만 표시하므로 여기서는 null 반환
  return null;
};

// 커스텀 활성 점 렌더러 (호버 시)
const CustomActiveDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;
  const color = STATE_COLORS[payload.state as keyof typeof STATE_COLORS] || "#6b7280";
  if (payload.eventType === "practice") {
    return <circle cx={cx} cy={cy} r={5} fill={color} stroke="white" strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={6} fill={color} stroke="white" strokeWidth={2} />;
};

// 커스텀 툴팁
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const date = new Date(d.at);
  const eventLabel = d.eventType === "practice" ? "연습" : d.eventType === "test" ? (d.isCorrect ? "시험 ✓" : "시험 ✗") : "현재";
  const stateLabel = d.state === "green" ? "안정" : d.state === "yellow" ? "주의" : "위험";
  const stateColor = STATE_COLORS[d.state as keyof typeof STATE_COLORS] || "#6b7280";

  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[140px]">
      <div className="text-muted-foreground text-xs mb-1">
        {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{eventLabel}</span>
        <span className="font-bold text-base" style={{ color: stateColor }}>{d.score}점</span>
      </div>
      <div className="text-xs" style={{ color: stateColor }}>{stateLabel}</div>
    </div>
  );
};

export function ConfidenceHistoryModal({ questionId, questionTitle, open, onClose }: Props) {
  const { data, isLoading } = trpc.confidence.getHistory.useQuery(
    { questionId: questionId! },
    { enabled: open && questionId !== null }
  );

  const points = data?.points ?? [];

  // X축용 인덱스 추가
  const chartData = points.map((p, i) => ({
    ...p,
    idx: i,
    label: points.length > 0 ? formatTimeLabel(p.at, points) : "",
  }));

  // 세그먼트별 색상 처리를 위해 그라디언트 대신 단색 사용
  const hasData = chartData.length > 0;
  const currentScore = hasData ? chartData[chartData.length - 1].score : null;
  const currentState = hasData ? chartData[chartData.length - 1].state : null;
  const currentColor = currentState ? STATE_COLORS[currentState as keyof typeof STATE_COLORS] : "#6b7280";

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-base font-semibold truncate max-w-[320px]">
              {questionTitle ?? "문제"} — 안정도 변화
            </span>
            {currentScore !== null && (
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: currentColor }}
              >
                {currentScore}점
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            불러오는 중...
          </div>
        ) : !hasData ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <span className="text-4xl">📊</span>
            <span className="text-sm">아직 연습 또는 시험 기록이 없습니다.</span>
          </div>
        ) : (
          <>
            {/* 범례 */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
              <span className="flex items-center gap-1.5 text-muted-foreground/50">
                <span className="inline-block w-3 h-3 rounded-full bg-blue-400" />
                연습 (호버 시만 표시)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rotate-45 bg-green-500" />
                시험 정답
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rotate-45 bg-red-500" />
                시험 오답
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full border-2 border-current" style={{ color: currentColor }} />
                현재
              </span>
            </div>

            <div className="h-64 w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 70, 100]}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  {/* 안정 구간 참조선 */}
                  <ReferenceLine y={70} stroke="#22c55e" strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: "안정", position: "right", fontSize: 10, fill: "#22c55e" }} />
                  <ReferenceLine y={40} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: "주의", position: "right", fontSize: 10, fill: "#f59e0b" }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={currentColor}
                    strokeWidth={2.5}
                    dot={<CustomDot />}
                    activeDot={<CustomActiveDot />}
                    isAnimationActive={true}
                    animationDuration={600}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 요약 통계 */}
            <div className="grid grid-cols-3 gap-3 mt-1">
              {[
                { label: "연습 횟수", value: `${chartData.filter(p => p.eventType === "practice").length}회` },
                { label: "시험 횟수", value: `${chartData.filter(p => p.eventType === "test").length}회` },
                { label: "정답률", value: (() => {
                  const tests = chartData.filter(p => p.eventType === "test");
                  if (tests.length === 0) return "-";
                  const correct = tests.filter(p => p.isCorrect).length;
                  return `${Math.round((correct / tests.length) * 100)}%`;
                })() },
              ].map(stat => (
                <div key={stat.label} className="bg-muted/40 rounded-lg p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">{stat.label}</div>
                  <div className="text-lg font-bold">{stat.value}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
