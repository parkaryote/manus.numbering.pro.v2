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
} from "recharts";
import { format, differenceInDays, differenceInHours, differenceInMinutes } from "date-fns";
import { ko } from "date-fns/locale";

interface Props {
  subjectId: number | null;
  subjectName?: string;
  open: boolean;
  onClose: () => void;
}

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

const STATE_COLORS = {
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
};

function getState(score: number): "green" | "yellow" | "red" {
  if (score >= 70) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;
  const state = getState(payload.score);
  const color = STATE_COLORS[state];

  if (payload.eventType === "test") {
    const size = 7;
    return (
      <g key={`dot-${cx}-${cy}`}>
        <polygon
          points={`${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`}
          fill={color}
          stroke="white"
          strokeWidth={1.5}
        />
      </g>
    );
  }
  if (payload.eventType === "now") {
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={6} fill={color} stroke="white" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={10} fill={color} fillOpacity={0.2} />
      </g>
    );
  }
  return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={color} stroke="white" strokeWidth={1.5} />;
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const date = new Date(d.at);
  const state = getState(d.score);
  const color = STATE_COLORS[state];
  const stateLabel = state === "green" ? "안정" : state === "yellow" ? "주의" : "위험";
  const eventLabel = d.eventType === "practice" ? "연습" : d.eventType === "test" ? "시험" : "현재";

  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[160px]">
      <div className="text-muted-foreground text-xs mb-1">
        {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{eventLabel}</span>
        <span className="font-bold text-base" style={{ color }}>{d.score}점</span>
      </div>
      <div className="text-xs" style={{ color }}>{stateLabel}</div>
      {d.questionCount && (
        <div className="text-xs text-muted-foreground mt-1">{d.questionCount}개 문제 평균</div>
      )}
    </div>
  );
};

export function SubjectConfidenceHistoryModal({ subjectId, subjectName, open, onClose }: Props) {
  const { data, isLoading } = trpc.confidence.getHistoryBySubject.useQuery(
    { subjectId: subjectId! },
    { enabled: open && subjectId !== null }
  );

  const points = data?.points ?? [];

  const chartData = points.map((p, i) => ({
    ...p,
    idx: i,
    label: points.length > 0 ? formatTimeLabel(p.at, points) : "",
  }));

  const hasData = chartData.length > 0;
  const currentScore = hasData ? chartData[chartData.length - 1].score : null;
  const currentState = currentScore !== null ? getState(currentScore) : null;
  const currentColor = currentState ? STATE_COLORS[currentState] : "#6b7280";

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-base font-semibold truncate max-w-[320px]">
              {subjectName ?? "과목"} — 과목 안정도 추이
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
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full bg-blue-400" />
                연습
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rotate-45 bg-green-500" />
                시험
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full border-2 border-current" style={{ color: currentColor }} />
                현재
              </span>
              <span className="ml-auto text-xs text-muted-foreground">과목 내 문제 평균</span>
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
                  <ReferenceLine y={70} stroke="#22c55e" strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: "안정", position: "right", fontSize: 10, fill: "#22c55e" }} />
                  <ReferenceLine y={40} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: "주의", position: "right", fontSize: 10, fill: "#f59e0b" }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={currentColor}
                    strokeWidth={2.5}
                    dot={<CustomDot />}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: "white" }}
                    isAnimationActive={true}
                    animationDuration={600}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 요약 통계 */}
            <div className="grid grid-cols-3 gap-3 mt-1">
              {[
                { label: "연습 이벤트", value: `${chartData.filter(p => p.eventType === "practice").length}회` },
                { label: "시험 이벤트", value: `${chartData.filter(p => p.eventType === "test").length}회` },
                { label: "최고 안정도", value: `${Math.max(...chartData.map(p => p.score))}점` },
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
