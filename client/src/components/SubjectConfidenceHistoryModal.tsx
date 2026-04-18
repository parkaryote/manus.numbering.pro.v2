import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";

interface Props {
  subjectId: number | null;
  subjectName?: string;
  open: boolean;
  onClose: () => void;
  isDemo?: boolean;
  previewLabel?: string;
  currentScoreOverride?: number | null;
}

type SubjectHistoryPoint = {
  at: string;
  score: number;
  eventType: string;
  questionCount?: number;
  testMode?: "single" | "mock";
  sessionIds?: number[];
};

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

function shouldRenderForgettingSegment(
  previousScore?: number | null,
  currentScore?: number | null
): boolean {
  if (typeof previousScore !== "number" || typeof currentScore !== "number") return false;
  return currentScore < previousScore;
}

function interpolateTimestamp(startAt: string, endAt: string, progress: number): string {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return startAt;
  }
  return new Date(start + (end - start) * progress).toISOString();
}

function forgettingCurveProgress(progress: number): number {
  return 1 - Math.pow(1 - progress, 1.8);
}

function splitForgettingSeriesByNow<
  T extends {
    at: string;
    forgettingScore?: number | null;
  },
>(
  rows: T[],
  nowMs: number
): Array<T & { forgettingScorePast: number | null; forgettingScoreFuture: number | null }> {
  const output = rows.map((row) => {
    const forgettingScore = typeof row.forgettingScore === "number" ? row.forgettingScore : null;
    const atMs = new Date(row.at).getTime();
    const isFuture = Number.isFinite(atMs) && atMs > nowMs;
    return {
      ...row,
      forgettingScorePast: isFuture ? null : forgettingScore,
      forgettingScoreFuture: isFuture ? forgettingScore : null,
    };
  });

  // 점선이 끊기지 않도록 경계 직전 점을 앵커로 포함한다.
  for (let index = 1; index < output.length; index += 1) {
    const previous = output[index - 1];
    const current = output[index];
    if (
      previous.forgettingScorePast !== null &&
      current.forgettingScoreFuture !== null &&
      previous.forgettingScoreFuture === null &&
      typeof previous.forgettingScore === "number"
    ) {
      previous.forgettingScoreFuture = previous.forgettingScore;
    }
  }

  return output;
}

function addSegmentLineScores<
  T extends {
    at: string;
    xPos: number;
    eventType?: string;
    score?: number | null;
    retentionScore?: number | null;
    forgettingScore?: number | null;
    isLatest?: boolean;
  },
>(rows: T[]): Array<T & { retentionScore: number | null; forgettingScore: number | null; synthetic?: boolean }> {
  const prepared = rows.map((row) => ({
    ...row,
    retentionScore: null as number | null,
    forgettingScore: null as number | null,
  }));

  if (prepared.length <= 1) return prepared;

  const output: Array<T & { retentionScore: number | null; forgettingScore: number | null; synthetic?: boolean }> = [prepared[0]];
  const curveStops = [0.36, 0.72];

  for (let index = 1; index < prepared.length; index += 1) {
    const previous = output[output.length - 1];
    const current = prepared[index];
    const previousScore = typeof previous.score === "number" ? previous.score : null;
    const currentScore = typeof current.score === "number" ? current.score : null;

    if (previousScore !== null && currentScore !== null) {
      if (shouldRenderForgettingSegment(previousScore, currentScore)) {
        previous.forgettingScore = previousScore;
        for (const stop of curveStops) {
          const syntheticScore = Math.max(
            0,
            Math.min(
              100,
              Math.round(previousScore + (currentScore - previousScore) * forgettingCurveProgress(stop))
            )
          );
          output.push({
            ...current,
            at: interpolateTimestamp(previous.at, current.at, stop),
            xPos: previous.xPos + (current.xPos - previous.xPos) * stop,
            score: syntheticScore,
            retentionScore: null,
            forgettingScore: syntheticScore,
            isLatest: false,
            synthetic: true,
            eventType: "forgetting_curve",
          });
        }
        current.forgettingScore = currentScore;
      } else {
        previous.retentionScore = previousScore;
        current.retentionScore = currentScore;
      }
    }

    output.push(current);
  }

  return output;
}

const CustomDot = (props: any) => {
  const { cx, cy, payload, eventLayerFocused = false, onSelectPoint } = props;
  if (!cx || !cy) return null;
  if (payload.synthetic) return null;
  const isSelectableTestPoint =
    payload.eventType === "test" && Array.isArray(payload.sessionIds) && payload.sessionIds.length > 0;
  const handleClick = () => {
    if (!isSelectableTestPoint || typeof onSelectPoint !== "function") return;
    onSelectPoint(payload);
  };

  if (payload.eventType === "test") {
    const isSuccess = payload.score >= SUCCESS_THRESHOLD;
    const color = isSuccess ? "#22c55e" : SOFT_DANGER_COLOR;
    const isMock = payload.testMode === "mock";
    const isLatest = payload.isLatest;
    const baseOpacity = eventLayerFocused ? 0.94 : 0.36;
    return (
      <g
        key={`dot-${cx}-${cy}`}
        onClick={handleClick}
        style={isSelectableTestPoint ? { cursor: "pointer" } : undefined}
      >
        {isLatest && (
          <circle cx={cx} cy={cy} r={9} fill={color} fillOpacity={eventLayerFocused ? 0.12 : 0.07} />
        )}
        {isMock ? (
          <rect
            x={cx - (isLatest ? 4.6 : 3.8)}
            y={cy - (isLatest ? 4.6 : 3.8)}
            width={isLatest ? 9.2 : 7.6}
            height={isLatest ? 9.2 : 7.6}
            transform={`rotate(45 ${cx} ${cy})`}
            fill={color}
            fillOpacity={baseOpacity}
            stroke="white"
            strokeWidth={1.5}
            strokeOpacity={eventLayerFocused ? 1 : 0.7}
            rx={1.2}
          />
        ) : (
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
        )}
      </g>
    );
  }
  if (payload.eventType === "forgetting") return null;
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
  const { cx, cy, payload, onSelectPoint } = props;
  if (!cx || !cy) return null;
  if (payload.synthetic) return null;
  const isSelectableTestPoint =
    payload.eventType === "test" && Array.isArray(payload.sessionIds) && payload.sessionIds.length > 0;
  const handleClick = () => {
    if (!isSelectableTestPoint || typeof onSelectPoint !== "function") return;
    onSelectPoint(payload);
  };

  if (payload.eventType === "practice") {
    return <circle cx={cx} cy={cy} r={4.5} fill="#9ca3af" stroke="white" strokeWidth={1.5} />;
  }
  if (payload.eventType === "test") {
    const isSuccess = payload.score >= SUCCESS_THRESHOLD;
    const color = isSuccess ? "#22c55e" : SOFT_DANGER_COLOR;
    if (payload.testMode === "mock") {
      return (
        <rect
          x={cx - 6}
          y={cy - 6}
          width={12}
          height={12}
          transform={`rotate(45 ${cx} ${cy})`}
          fill={color}
          stroke="white"
          strokeWidth={2}
          rx={1.2}
          onClick={handleClick}
          style={isSelectableTestPoint ? { cursor: "pointer" } : undefined}
        />
      );
    }
    return (
      <circle
        cx={cx}
        cy={cy}
        r={7}
        fill={color}
        stroke="white"
        strokeWidth={2}
        onClick={handleClick}
        style={isSelectableTestPoint ? { cursor: "pointer" } : undefined}
      />
    );
  }
  if (payload.eventType === "forgetting") return null;
  return <circle cx={cx} cy={cy} r={7} fill={BRAND_COLOR} stroke="white" strokeWidth={2} />;
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d?.synthetic) return null;
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
    const testModeLabel = d.testMode === "mock" ? "모의고사" : "개별 시험";
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
        <div className="text-xs text-muted-foreground">{testModeLabel}</div>
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
        <div className="font-semibold text-sm">{Math.round(Number(d.score ?? 0))}점</div>
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
  currentScoreOverride = null,
}: Props) {
  const [isEventLayerFocused, setIsEventLayerFocused] = useState(false);
  const [isTooltipNearPoint, setIsTooltipNearPoint] = useState(false);
  const [selectedTestPoint, setSelectedTestPoint] = useState<SubjectHistoryPoint | null>(null);
  const utils = trpc.useUtils();
  const deleteTestSessionsMutation = trpc.test.deleteSessions.useMutation({
    onSuccess: async () => {
      setSelectedTestPoint(null);
      await Promise.all([
        utils.test.getByQuestion.invalidate(),
        utils.test.getByUser.invalidate(),
        utils.confidence.getHistory.invalidate(),
        utils.confidence.getByQuestion.invalidate(),
        utils.confidence.getBySubject.invalidate(),
        utils.confidence.getHistoryBySubject.invalidate(),
      ]);
      toast.success("시험 기록을 삭제하고 과목 그래프를 다시 계산했습니다.");
    },
    onError: (error) => {
      toast.error("시험 기록 삭제 실패: " + error.message);
    },
  });
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
  const points = ((data?.points ?? []) as SubjectHistoryPoint[]).map((point) => ({
    ...point,
    at: normalizePointTimestamp(point.at, normalizedNowMs),
  }));

  const testPoints = points.filter(p => p.eventType === "test");
  const latestTestAt = testPoints.length > 0 ? testPoints[testPoints.length - 1].at : null;
  const timeScale = buildSoftTimeScale(
    points.map((p) => ({ at: p.at, eventType: p.eventType }))
  );

  const chartData = splitForgettingSeriesByNow(
    addSegmentLineScores(
      points.map((p, i) => {
        return {
          ...p,
          score: p.score,
          idx: i,
          xPos: timeScale.nodes[i]?.x ?? i * 24,
          isLatest: p.at === latestTestAt && p.eventType === "test",
        };
      })
    ),
    normalizedNowMs
  );

  const hasData = chartData.length > 0;
  const latestCurrentChartPoint = chartData
    .filter((p) => {
      const atMs = new Date(p.at).getTime();
      return !Number.isFinite(atMs) || atMs <= normalizedNowMs;
    })
    .at(-1);
  const latestAnyChartPoint = chartData.at(-1);
  const resolvedCurrentScore = latestCurrentChartPoint?.score ?? latestAnyChartPoint?.score ?? null;
  const graphCurrentScore =
    hasData && typeof resolvedCurrentScore === "number"
      ? Math.round(Number(resolvedCurrentScore))
      : null;
  const currentScore =
    typeof currentScoreOverride === "number" && Number.isFinite(currentScoreOverride)
      ? Math.round(currentScoreOverride)
      : graphCurrentScore;
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

  const handleSelectTestPoint = (point: SubjectHistoryPoint) => {
    if (isDemo) return;
    if (!Array.isArray(point.sessionIds) || point.sessionIds.length === 0) return;
    setSelectedTestPoint(point);
  };

  const handleDeleteSelectedPoint = async () => {
    if (!selectedTestPoint || !selectedTestPoint.sessionIds?.length) return;
    const label = selectedTestPoint.testMode === "mock" ? "모의고사" : "시험";
    const count = selectedTestPoint.sessionIds.length;
    if (!window.confirm(`${label} 기록 ${count}개를 삭제하고 과목 안정도 반영을 취소할까요?`)) {
      return;
    }
    await deleteTestSessionsMutation.mutateAsync({ ids: selectedTestPoint.sessionIds });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="w-[calc(100vw-16px)] max-w-[1180px] sm:w-[calc(100vw-28px)] sm:max-w-[1180px] max-h-[92svh] overflow-hidden !p-2.5 sm:!p-4">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-sm sm:text-base font-semibold truncate max-w-[220px] sm:max-w-[320px]">
              {subjectName ?? "과목"} — 과목 안정도 추이
            </span>
            {currentScore !== null && (
              <span
                className="text-xl sm:text-2xl font-bold tabular-nums"
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
          <div className="flex min-h-0 flex-col gap-2">
            {/* 범례 */}
            <div className="flex items-center gap-2.5 sm:gap-3 text-[11px] sm:text-xs text-muted-foreground px-1 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: BRAND_COLOR }} />
                회상/유지 구간 (실선)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 rounded bg-slate-500 opacity-75" />
                망각 구간 (실선)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0" style={{ borderTop: "2px dashed #64748b" }} />
                예측 망각 구간 (점선)
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
              <span className="ml-auto text-xs text-muted-foreground">과목 내 문제 평균</span>
            </div>

            <div className="h-[clamp(180px,35svh,400px)] sm:h-[clamp(210px,40svh,460px)] w-full overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 28, left: 6, bottom: 8 }}
                  onMouseMove={handleChartMouseMove}
                  onMouseLeave={handleChartMouseLeave}
                >
                  {/* 상태 구간 배경 영역 */}
                  <ReferenceArea y1={0} y2={40} fill={SOFT_DANGER_COLOR} fillOpacity={0.055} />
                  <ReferenceArea y1={40} y2={80} fill="#d4a72c" fillOpacity={0.055} />
                  <ReferenceArea y1={80} y2={100} fill="#22c55e" fillOpacity={0.06} />

                  <CartesianGrid stroke="hsl(var(--border))" opacity={0.22} />
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
                    strokeOpacity={0.22}
                    label={{ value: "안정", position: "insideTopRight", fontSize: 12, fill: "#22c55e", fillOpacity: 0.75, dx: -14 }}
                  />
                  <ReferenceLine
                    y={40}
                    stroke="#d4a72c"
                    strokeOpacity={0.22}
                    label={{ value: "위험", position: "insideBottomRight", fontSize: 12, fill: "#d4a72c", fillOpacity: 0.75, dx: -14 }}
                  />

                  <Tooltip
                    content={(props) => (isTooltipNearPoint ? <CustomTooltip {...props} /> : null)}
                    wrapperStyle={{ zIndex: 90 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                  />

                  <Line
                    type="linear"
                    dataKey="retentionScore"
                    stroke={BRAND_COLOR}
                    strokeOpacity={0.92}
                    strokeWidth={3.4}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={true}
                    animationDuration={600}
                    connectNulls={false}
                  />
                  <Line
                    type="linear"
                    dataKey="forgettingScorePast"
                    stroke="#64748b"
                    strokeOpacity={0.82}
                    strokeWidth={3}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={true}
                    animationDuration={600}
                    connectNulls={false}
                  />
                  <Line
                    type="linear"
                    dataKey="forgettingScoreFuture"
                    stroke="#64748b"
                    strokeOpacity={0.82}
                    strokeWidth={3}
                    strokeDasharray="6 4"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={true}
                    animationDuration={600}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={BRAND_COLOR}
                    strokeOpacity={0}
                    strokeWidth={8}
                    dot={<CustomDot eventLayerFocused={isEventLayerFocused} onSelectPoint={handleSelectTestPoint} />}
                    activeDot={<CustomActiveDot onSelectPoint={handleSelectTestPoint} />}
                    isAnimationActive={true}
                    animationDuration={600}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {!isDemo && selectedTestPoint?.sessionIds?.length ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  선택한 {selectedTestPoint.testMode === "mock" ? "모의고사" : "시험"} 기록
                  {selectedTestPoint.sessionIds.length > 1 ? ` ${selectedTestPoint.sessionIds.length}개` : ""}를 삭제하면
                  과목 안정도와 그래프가 다시 계산됩니다.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={handleDeleteSelectedPoint}
                  disabled={deleteTestSessionsMutation.isPending}
                >
                  {deleteTestSessionsMutation.isPending ? "삭제 중..." : "선택한 기록 삭제"}
                </Button>
              </div>
            ) : null}

            {/* 요약 통계 */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "연습 이벤트", value: `${chartData.filter(p => p.eventType === "practice").length}회` },
                { label: "시험 이벤트", value: `${chartData.filter(p => p.eventType === "test").length}회` },
                { label: "최고 안정도", value: `${Math.max(...chartData.map(p => Number(p.score ?? 0)))}점` },
              ].map(stat => (
                <div key={stat.label} className="bg-muted/40 rounded-lg p-2 text-center">
                  <div className="text-[11px] sm:text-xs text-muted-foreground mb-0.5">{stat.label}</div>
                  <div className="text-base sm:text-lg font-bold leading-tight">{stat.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
