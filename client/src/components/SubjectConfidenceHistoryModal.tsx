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
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  buildSoftTimeScale,
  buildTrendScores,
  formatSoftRelativeTick,
} from "@/lib/softTimeScale";

interface Props {
  subjectId: number | null;
  subjectName?: string;
  open: boolean;
  onClose: () => void;
}

// 브랜드 컬러 (보라 계열) - 선에만 사용
const BRAND_COLOR = "#8b5cf6";
const EVENT_LINE_COLOR = "#64748b"; // 실제 이벤트 연결선(보조)
// 성공 기준
const SUCCESS_THRESHOLD = 80;

function getStateColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

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
          <circle cx={cx} cy={cy} r={9} fill={color} fillOpacity={0.12} />
        )}
        <circle cx={cx} cy={cy} r={isLatest ? 5 : 4} fill={color} stroke="white" strokeWidth={1.5} />
      </g>
    );
  }
  if (payload.eventType === "now") {
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={8} fill={BRAND_COLOR} fillOpacity={0.12} />
        <circle cx={cx} cy={cy} r={4.5} fill={BRAND_COLOR} stroke="white" strokeWidth={1.5} />
      </g>
    );
  }
  // 연습 - 기본 상태에서는 숨김
  return null;
};

const CustomActiveDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;

  if (payload.eventType === "practice") {
    return <circle cx={cx} cy={cy} r={4.5} fill="#9ca3af" stroke="white" strokeWidth={1.5} />;
  }
  if (payload.eventType === "test") {
    const isSuccess = payload.score >= SUCCESS_THRESHOLD;
    const color = isSuccess ? "#22c55e" : "#ef4444";
    return <circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={7} fill={BRAND_COLOR} stroke="white" strokeWidth={2} />;
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const date = new Date(d.at);

  if (d.eventType === "practice") {
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[150px]">
        <div className="text-muted-foreground text-xs mb-1">
          {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" />
          <span className="text-muted-foreground text-xs">연습</span>
          <span className="font-semibold text-sm">{d.score}점</span>
        </div>
        {d.questionCount && (
          <div className="text-xs text-muted-foreground mt-1">{d.questionCount}개 문제 평균</div>
        )}
      </div>
    );
  }

  if (d.eventType === "test") {
    const isSuccess = d.score >= SUCCESS_THRESHOLD;
    const color = isSuccess ? "#22c55e" : "#ef4444";
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[160px]">
        <div className="text-muted-foreground text-xs mb-1.5">
          {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
          <span className="font-semibold text-sm" style={{ color }}>
            시험: {isSuccess ? "성공" : "실패"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">안정도 {d.score}점</div>
        {d.questionCount && (
          <div className="text-xs text-muted-foreground mt-1">{d.questionCount}개 문제 평균</div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[130px]">
      <div className="text-muted-foreground text-xs mb-1">현재</div>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: BRAND_COLOR }} />
        <span className="font-semibold text-sm" style={{ color: BRAND_COLOR }}>안정도 {d.score}점</span>
      </div>
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

  const testPoints = points.filter(p => p.eventType === "test");
  const latestTestAt = testPoints.length > 0 ? testPoints[testPoints.length - 1].at : null;
  const timeScale = buildSoftTimeScale(
    points.map((p) => ({ at: p.at, eventType: p.eventType }))
  );
  const trendScores = buildTrendScores(
    points.map((p) => p.score),
    points.map((p) => p.eventType)
  );

  const chartData = points.map((p, i) => ({
    ...p,
    idx: i,
    xPos: timeScale.nodes[i]?.x ?? i * 24,
    trendScore: trendScores[i],
    isLatest: p.at === latestTestAt && p.eventType === "test",
  }));

  const hasData = chartData.length > 0;
  const currentScore = hasData ? chartData[chartData.length - 1].score : null;
  const currentStateColor = currentScore !== null ? getStateColor(currentScore) : "#6b7280";

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="w-[calc(100vw-28px)] max-w-[1240px] sm:max-w-[1240px] max-h-[94vh] overflow-visible !p-4 sm:!p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-base font-semibold truncate max-w-[320px]">
              {subjectName ?? "과목"} — 과목 안정도 추이
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
            <div className="flex items-center gap-4 text-sm text-muted-foreground px-1 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: BRAND_COLOR }} />
                추세선 (주요)
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground/80">
                <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: EVENT_LINE_COLOR, opacity: 0.5 }} />
                실제 이벤트 (보조)
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
              <span className="ml-auto text-xs text-muted-foreground">과목 내 문제 평균</span>
            </div>

            <div className="h-[58vh] min-h-[460px] max-h-[760px] w-full mt-2 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 14, right: 76, left: 18, bottom: 12 }}
                >
                  {/* 상태 구간 배경 영역 */}
                  <ReferenceArea y1={0} y2={40} fill="#ef4444" fillOpacity={0.06} />
                  <ReferenceArea y1={40} y2={80} fill="#f59e0b" fillOpacity={0.06} />
                  <ReferenceArea y1={80} y2={100} fill="#22c55e" fillOpacity={0.06} />

                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    type="number"
                    dataKey="xPos"
                    domain={[timeScale.xDomainMin, timeScale.xDomainMax]}
                    scale="linear"
                    tickCount={8}
                    interval="preserveStartEnd"
                    minTickGap={24}
                    tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) =>
                      formatSoftRelativeTick(Number(value), timeScale.nodes, timeScale.firstTs)
                    }
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 40, 80, 100]}
                    tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />

                  <ReferenceLine
                    y={80}
                    stroke="#22c55e"
                    strokeDasharray="4 3"
                    strokeOpacity={0.4}
                    label={{ value: "안정", position: "insideTopRight", fontSize: 12, fill: "#22c55e", fillOpacity: 0.75, dx: -14 }}
                  />
                  <ReferenceLine
                    y={40}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    strokeOpacity={0.4}
                    label={{ value: "위험", position: "insideBottomRight", fontSize: 12, fill: "#f59e0b", fillOpacity: 0.75, dx: -14 }}
                  />

                  <Tooltip
                    content={<CustomTooltip />}
                    wrapperStyle={{ zIndex: 90 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                  />

                  {/* 그래프 선: 단일 브랜드 컬러 */}
                  <Line
                    type="monotone"
                    dataKey="trendScore"
                    stroke={BRAND_COLOR}
                    strokeOpacity={0.9}
                    strokeWidth={3.4}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={true}
                    animationDuration={500}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={EVENT_LINE_COLOR}
                    strokeOpacity={0.5}
                    strokeWidth={1.35}
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
