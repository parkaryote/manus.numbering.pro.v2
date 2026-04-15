import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
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
  formatSoftRelativeTick,
} from "@/lib/softTimeScale";

interface Props {
  subjectId: number | null;
  subjectName?: string;
  open: boolean;
  onClose: () => void;
  isDemo?: boolean;
  previewLabel?: string;
}

// 브랜드 컬러 (보라 계열) - 선에만 사용
const BRAND_COLOR = "#8b5cf6";
const SOFT_DANGER_COLOR = "#d66b78";
// 성공 기준
const SUCCESS_THRESHOLD = 80;
const TOOLTIP_POINT_HOVER_RADIUS_PX = 18;

function normalizePointTimestamp(at: string, nowMs: number): string {
  const parsed = new Date(at);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  // MySQL DATETIME 등 timezone 정보가 없는 문자열 보정
  const normalized = at.replace(" ", "T");
  const parsedLocal = new Date(normalized);
  if (!Number.isNaN(parsedLocal.getTime())) {
    return parsedLocal.toISOString();
  }

  return new Date(nowMs).toISOString();
}

function getStateColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 40) return "#d4a72c";
  return SOFT_DANGER_COLOR;
}

const CustomDot = (props: any) => {
  const { cx, cy, payload, eventLayerFocused = false } = props;
  if (!cx || !cy) return null;

  if (payload.eventType === "test") {
    const isSuccess = payload.score >= SUCCESS_THRESHOLD;
    const color = isSuccess ? "#22c55e" : SOFT_DANGER_COLOR;
    const isLatest = payload.isLatest;
    const baseOpacity = eventLayerFocused ? 0.94 : 0.36;
    return (
      <g key={`dot-${cx}-${cy}`}>
        {isLatest && (
          <circle cx={cx} cy={cy} r={9} fill={color} fillOpacity={eventLayerFocused ? 0.12 : 0.07} />
        )}
        <circle
          cx={cx}
          cy={cy}
          r={isLatest ? 5 : 4}
          fill={color}
          fillOpacity={baseOpacity}
          stroke="white"
          strokeWidth={1.5}
          strokeOpacity={eventLayerFocused ? 1 : 0.7}
        />
      </g>
    );
  }
  if (payload.eventType === "forgetting") {
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle
          cx={cx}
          cy={cy}
          r={eventLayerFocused ? 3.8 : 2.8}
          fill="#94a3b8"
          fillOpacity={eventLayerFocused ? 0.78 : 0.28}
        />
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
    const color = isSuccess ? "#22c55e" : SOFT_DANGER_COLOR;
    return <circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={2} />;
  }
  if (payload.eventType === "forgetting") {
    return <circle cx={cx} cy={cy} r={5.5} fill="#94a3b8" stroke="white" strokeWidth={1.5} />;
  }
  return <circle cx={cx} cy={cy} r={7} fill={BRAND_COLOR} stroke="white" strokeWidth={2} />;
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const date = new Date(d.at);

  if (d.eventType === "practice") {
    const displayScore = d.score;
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[150px]">
        <div className="text-muted-foreground text-xs mb-1">
          {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" />
          <span className="text-muted-foreground text-xs">연습</span>
          <span className="font-semibold text-sm">{displayScore}점</span>
        </div>
        {d.questionCount && (
          <div className="text-xs text-muted-foreground mt-1">{d.questionCount}개 문제 평균</div>
        )}
      </div>
    );
  }

  if (d.eventType === "test") {
    const displayScore = d.score;
    const isSuccess = displayScore >= SUCCESS_THRESHOLD;
    const color = isSuccess ? "#22c55e" : SOFT_DANGER_COLOR;
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
        <div className="text-xs text-muted-foreground">안정도 {displayScore}점</div>
        {d.questionCount && (
          <div className="text-xs text-muted-foreground mt-1">{d.questionCount}개 문제 평균</div>
        )}
      </div>
    );
  }

  if (d.eventType === "forgetting") {
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[150px]">
        <div className="text-muted-foreground text-xs mb-1.5">
          {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" />
          <span className="text-muted-foreground text-xs">망각 구간</span>
          <span className="font-semibold text-sm">{Math.round(Number(d.score ?? 0))}점</span>
        </div>
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
        <span className="font-semibold text-sm" style={{ color: BRAND_COLOR }}>
          안정도 {Math.round(Number(d.score ?? 0))}점
        </span>
      </div>
      {d.questionCount && (
        <div className="text-xs text-muted-foreground mt-1">{d.questionCount}개 문제 평균</div>
      )}
    </div>
  );
};

export function SubjectConfidenceHistoryModal({
  subjectId,
  subjectName,
  open,
  onClose,
  isDemo = false,
  previewLabel,
}: Props) {
  const [isEventLayerFocused, setIsEventLayerFocused] = useState(false);
  const [isTooltipNearPoint, setIsTooltipNearPoint] = useState(false);
  const liveHistoryQuery = trpc.confidence.getHistoryBySubject.useQuery(
    { subjectId: subjectId! },
    { enabled: open && subjectId !== null && !isDemo }
  );
  const demoHistoryQuery = trpc.demo.confidenceHistoryBySubject.useQuery(
    { subjectId: subjectId! },
    { enabled: open && subjectId !== null && isDemo }
  );
  const data = isDemo ? demoHistoryQuery.data : liveHistoryQuery.data;
  const isExamplePreview = Boolean(isDemo || (data as any)?.isExample);
  const previewText = previewLabel || (data as any)?.previewLabel || "예시 화면";
  const isLoading = isDemo ? demoHistoryQuery.isLoading : liveHistoryQuery.isLoading;

  const normalizedNowMs = Date.now();
  const points = (data?.points ?? []).map((point) => ({
    ...point,
    at: normalizePointTimestamp(point.at, normalizedNowMs),
  }));

  const testPoints = points.filter(p => p.eventType === "test");
  const latestTestAt = testPoints.length > 0 ? testPoints[testPoints.length - 1].at : null;
  const timeScale = buildSoftTimeScale(
    points.map((p) => ({ at: p.at, eventType: p.eventType }))
  );

  const chartData = points.map((p, i) => {
    return {
      ...p,
      score: p.score,
      idx: i,
      xPos: timeScale.nodes[i]?.x ?? i * 24,
      isLatest: p.at === latestTestAt && p.eventType === "test",
    };
  });

  const hasData = chartData.length > 0;
  const currentScore = hasData
    ? Math.round(Number(chartData[chartData.length - 1].score))
    : null;
  const currentStateColor = currentScore !== null ? getStateColor(currentScore) : "#6b7280";
  const handleChartMouseMove = (state: any) => {
    const activePayload = state?.activePayload ?? [];
    const chartX = Number(state?.chartX);
    const chartY = Number(state?.chartY);
    const activeX = Number(state?.activeCoordinate?.x);
    if (!Number.isFinite(chartX) || !Number.isFinite(chartY) || !Number.isFinite(activeX)) {
      setIsEventLayerFocused(false);
      setIsTooltipNearPoint(false);
      return;
    }

    const hasEventLayerHover = activePayload.some((entry: any) => {
      const eventType = entry?.payload?.eventType;
      const dataKey = entry?.dataKey;
      return dataKey === "score" && (eventType === "practice" || eventType === "test" || eventType === "forgetting");
    });

    const eventEntry = activePayload.find(
      (entry: any) =>
        entry?.dataKey === "score" &&
        typeof entry?.value === "number"
    );

    let activeY = Number(state?.activeCoordinate?.y);
    const offsetTop = Number(state?.offset?.top);
    const offsetHeight = Number(state?.offset?.height);
    if (
      eventEntry &&
      Number.isFinite(offsetTop) &&
      Number.isFinite(offsetHeight) &&
      offsetHeight > 0
    ) {
      const score = Math.max(0, Math.min(100, Number(eventEntry.value)));
      activeY = offsetTop + (1 - score / 100) * offsetHeight;
    }

    if (!Number.isFinite(activeY)) {
      setIsEventLayerFocused(false);
      setIsTooltipNearPoint(false);
      return;
    }

    const distance = Math.hypot(chartX - activeX, chartY - activeY);
    const isNearPoint = distance <= TOOLTIP_POINT_HOVER_RADIUS_PX;
    setIsTooltipNearPoint(isNearPoint);
    setIsEventLayerFocused(hasEventLayerHover && isNearPoint);
  };

  const handleChartMouseLeave = () => {
    setIsEventLayerFocused(false);
    setIsTooltipNearPoint(false);
  };

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
        {isExamplePreview && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
            {previewText} · 실제 기록이 없어 데모 예측 데이터를 표시합니다.
          </div>
        )}

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
                안정도 변화
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full bg-green-500" />
                시험 성공 (≥80%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: SOFT_DANGER_COLOR }} />
                시험 실패 (&lt;80%)
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground/50">
                <span className="inline-block w-3 h-3 rounded-full bg-gray-400" />
                연습 (호버 시만)
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground/50">
                <span className="inline-block w-3 h-3 rounded-full bg-slate-400/70" />
                망각 구간
              </span>
              <span className="ml-auto text-xs text-muted-foreground">과목 내 문제 평균</span>
            </div>

            <div className="h-[58vh] min-h-[460px] max-h-[760px] w-full mt-2 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 14, right: 76, left: 18, bottom: 12 }}
                  onMouseMove={handleChartMouseMove}
                  onMouseLeave={handleChartMouseLeave}
                >
                  {/* 상태 구간 배경 영역 */}
                  <ReferenceArea y1={0} y2={40} fill={SOFT_DANGER_COLOR} fillOpacity={0.055} />
                  <ReferenceArea y1={40} y2={80} fill="#d4a72c" fillOpacity={0.055} />
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
                    stroke="#d4a72c"
                    strokeDasharray="4 3"
                    strokeOpacity={0.4}
                    label={{ value: "위험", position: "insideBottomRight", fontSize: 12, fill: "#d4a72c", fillOpacity: 0.75, dx: -14 }}
                  />

                  <Tooltip
                    content={(props) => (isTooltipNearPoint ? <CustomTooltip {...props} /> : null)}
                    wrapperStyle={{ zIndex: 90 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                  />

                  {/* 그래프 선: 단일 브랜드 컬러 */}
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={BRAND_COLOR}
                    strokeOpacity={0.9}
                    strokeWidth={3.4}
                    dot={<CustomDot eventLayerFocused={isEventLayerFocused} />}
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
                { label: "최고 안정도", value: `${Math.max(...chartData.map(p => Number(p.score ?? 0)))}점` },
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
