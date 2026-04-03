import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
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

// 성공 기준: 안정도 ≥ 80
const SUCCESS_THRESHOLD = 80;

// 브랜드 컬러 (보라 계열) - 선에만 사용
const BRAND_COLOR = "#8b5cf6";

// 커스텀 점 렌더러
const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;

  if (payload.eventType === "test") {
    const isSuccess = payload.score >= SUCCESS_THRESHOLD;
    const color = isSuccess ? "#22c55e" : "#ef4444";
    const isLatest = payload.isLatest;
    return (
      <g key={`dot-${cx}-${cy}`}>
        {isLatest && (
          <circle cx={cx} cy={cy} r={12} fill={color} fillOpacity={0.15} />
        )}
        <circle cx={cx} cy={cy} r={isLatest ? 7 : 5.5} fill={color} stroke="white" strokeWidth={2} />
      </g>
    );
  }
  if (payload.eventType === "now") {
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={12} fill={BRAND_COLOR} fillOpacity={0.15} />
        <circle cx={cx} cy={cy} r={6} fill={BRAND_COLOR} stroke="white" strokeWidth={2} />
      </g>
    );
  }
  // 연습 - 기본 상태에서는 숨김
  return null;
};

// 커스텀 활성 점 (호버 시)
const CustomActiveDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;

  if (payload.eventType === "practice") {
    // 연습 점: 호버 시에만 회색으로 표시
    return <circle cx={cx} cy={cy} r={4.5} fill="#9ca3af" stroke="white" strokeWidth={1.5} />;
  }
  if (payload.eventType === "test") {
    const isSuccess = payload.score >= SUCCESS_THRESHOLD;
    const color = isSuccess ? "#22c55e" : "#ef4444";
    return <circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={7} fill={BRAND_COLOR} stroke="white" strokeWidth={2} />;
};

// 커스텀 툴팁
const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const date = new Date(d.at);

  if (d.eventType === "practice") {
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[130px]">
        <div className="text-muted-foreground text-xs mb-1">
          {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" />
          <span className="text-muted-foreground text-xs">연습</span>
          <span className="font-semibold text-sm">{d.score}점</span>
        </div>
      </div>
    );
  }

  if (d.eventType === "test") {
    const isSuccess = d.score >= SUCCESS_THRESHOLD;
    const color = isSuccess ? "#22c55e" : "#ef4444";
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[150px]">
        <div className="text-muted-foreground text-xs mb-1.5">
          {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
          <span className="font-semibold text-sm" style={{ color }}>
            시험: {isSuccess ? "성공" : "실패"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">안정도 {d.score}%</div>
      </div>
    );
  }

  // 현재
  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[130px]">
      <div className="text-muted-foreground text-xs mb-1">현재</div>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: BRAND_COLOR }} />
        <span className="font-semibold text-sm" style={{ color: BRAND_COLOR }}>안정도 {d.score}%</span>
      </div>
    </div>
  );
};

export function ConfidenceHistoryModal({ questionId, questionTitle, open, onClose }: Props) {
  const { data, isLoading } = trpc.confidence.getHistory.useQuery(
    { questionId: questionId! },
    { enabled: open && questionId !== null }
  );

  const points = data?.points ?? [];

  // 최신 시험 점 표시를 위해 isLatest 플래그 추가
  const testPoints = points.filter(p => p.eventType === "test");
  const latestTestAt = testPoints.length > 0 ? testPoints[testPoints.length - 1].at : null;

  const chartData = points.map((p, i) => ({
    ...p,
    idx: i,
    label: points.length > 0 ? formatTimeLabel(p.at, points) : "",
    isLatest: p.at === latestTestAt && p.eventType === "test",
  }));

  const hasData = chartData.length > 0;
  const currentScore = hasData ? chartData[chartData.length - 1].score : null;

  // 현재 상태 색상 (점수 기반)
  const currentStateColor = currentScore === null
    ? "#6b7280"
    : currentScore >= 80
    ? "#22c55e"
    : currentScore >= 40
    ? "#f59e0b"
    : "#ef4444";

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
                style={{ color: currentStateColor }}
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
            <div className="flex items-center gap-4 text-xs text-muted-foreground px-1 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: BRAND_COLOR }} />
                안정도 흐름
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full bg-green-500" />
                시험 성공 (≥80%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full bg-red-500" />
                시험 실패 (&lt;80%)
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground/50">
                <span className="inline-block w-3 h-3 rounded-full bg-gray-400" />
                연습 (호버 시만)
              </span>
            </div>

            <div className="h-64 w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                >
                  {/* 상태 구간 배경 영역 */}
                  <ReferenceArea y1={0} y2={40} fill="#ef4444" fillOpacity={0.06} />
                  <ReferenceArea y1={40} y2={80} fill="#f59e0b" fillOpacity={0.06} />
                  <ReferenceArea y1={80} y2={100} fill="#22c55e" fillOpacity={0.06} />

                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 40, 80, 100]}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />

                  {/* 구간 경계선 */}
                  <ReferenceLine
                    y={80}
                    stroke="#22c55e"
                    strokeDasharray="4 3"
                    strokeOpacity={0.4}
                    label={{ value: "안정", position: "right", fontSize: 10, fill: "#22c55e", fillOpacity: 0.7 }}
                  />
                  <ReferenceLine
                    y={40}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    strokeOpacity={0.4}
                    label={{ value: "위험", position: "right", fontSize: 10, fill: "#f59e0b", fillOpacity: 0.7 }}
                  />

                  <Tooltip content={<CustomTooltip />} />

                  {/* 그래프 선: 단일 브랜드 컬러 (상태와 무관) */}
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={BRAND_COLOR}
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
                { label: "시험 성공률", value: (() => {
                  const tests = chartData.filter(p => p.eventType === "test");
                  if (tests.length === 0) return "-";
                  const success = tests.filter(p => p.score >= SUCCESS_THRESHOLD).length;
                  return `${Math.round((success / tests.length) * 100)}%`;
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
