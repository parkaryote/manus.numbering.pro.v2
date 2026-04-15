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
import { format, differenceInDays, differenceInHours, differenceInMinutes } from "date-fns";
import { ko } from "date-fns/locale";
import {
  buildSoftTimeScale,
  formatSoftRelativeTick,
} from "@/lib/softTimeScale";

interface ExamDatePrediction {
  predictedScore: number;
  predictedState: "green" | "yellow" | "red";
  predictedLabel: string;
  daysUntilExam: number;
  hoursUntilExam: number;
  minutesUntilExam: number;
  examAtISO: string;
  currentScore: number;
  scoreDelta: number;
  canReachGreen: boolean;
}

interface Props {
  questionId: number | null;
  questionTitle?: string;
  open: boolean;
  onClose: () => void;
  examDatePrediction?: ExamDatePrediction | null;
  isDemo?: boolean;
  previewLabel?: string;
}

type HistoryPoint = {
  at: string;
  score: number;
  state: string;
  eventType: string;
  isCorrect?: boolean;
  accuracyRate?: number;
  practiceSessionCount?: number;
  practiceDelta?: number;
};

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

function formatExamCountdown(minutesUntilExam: number): string {
  if (minutesUntilExam <= 0) return "D-Day";
  const days = Math.floor(minutesUntilExam / (60 * 24));
  const hours = Math.floor((minutesUntilExam % (60 * 24)) / 60);
  const minutes = minutesUntilExam % 60;
  if (days > 0) return `D-${days} · ${hours}시간 ${minutes}분 후`;
  if (hours > 0) return `D-Day · ${hours}시간 ${minutes}분 후`;
  return `D-Day · ${minutes}분 후`;
}

// 성공 기준: 시험 정답률 ≥ 80% (accuracyRate 기준)
const SUCCESS_ACCURACY_THRESHOLD = 80;

// 브랜드 컬러 (보라 계열) - 선에만 사용
const BRAND_COLOR = "#8b5cf6";
const SOFT_DANGER_COLOR = "#d66b78";
const PREDICT_COLOR = BRAND_COLOR; // 시험일 예측 점선
const TOOLTIP_POINT_HOVER_RADIUS_PX = 18;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stateFromScore(score: number): "green" | "yellow" | "red" {
  if (score >= 80) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

// 커스텀 점 렌더러
const CustomDot = (props: any) => {
  const { cx, cy, payload, eventLayerFocused = false } = props;
  if (!cx || !cy) return null;

  if (payload.eventType === "test") {
    const isSuccess = payload.accuracyRate !== undefined
      ? payload.accuracyRate >= SUCCESS_ACCURACY_THRESHOLD
      : payload.isCorrect === true;
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
  if (payload.eventType === "now") {
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={8} fill={BRAND_COLOR} fillOpacity={0.12} />
        <circle cx={cx} cy={cy} r={4.5} fill={BRAND_COLOR} stroke="white" strokeWidth={1.5} />
      </g>
    );
  }
  if (payload.eventType === "exam_predict") {
    const stateColor = payload.predictedState === "green" ? "#22c55e" : payload.predictedState === "yellow" ? "#d4a72c" : SOFT_DANGER_COLOR;
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={8} fill={stateColor} fillOpacity={0.12} />
        <circle cx={cx} cy={cy} r={4.5} fill={stateColor} stroke="white" strokeWidth={1.5} strokeDasharray="2 1" />
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
    return <circle cx={cx} cy={cy} r={4.5} fill="#9ca3af" stroke="white" strokeWidth={1.5} />;
  }
  if (payload.eventType === "test") {
    const isSuccess = payload.accuracyRate !== undefined
      ? payload.accuracyRate >= SUCCESS_ACCURACY_THRESHOLD
      : payload.isCorrect === true;
    const color = isSuccess ? "#22c55e" : SOFT_DANGER_COLOR;
    return <circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={2} />;
  }
  if (payload.eventType === "exam_predict") {
    const stateColor = payload.predictedState === "green" ? "#22c55e" : payload.predictedState === "yellow" ? "#d4a72c" : SOFT_DANGER_COLOR;
    return <circle cx={cx} cy={cy} r={7} fill={stateColor} stroke="white" strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={7} fill={BRAND_COLOR} stroke="white" strokeWidth={2} />;
};

// 커스텀 툴팁
const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const date = new Date(d.at);

  if (d.eventType === "practice") {
    const displayScore = d.score;
    const practiceCount = d.practiceSessionCount ?? 1;
    const delta = typeof d.practiceDelta === "number" ? d.practiceDelta : null;
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[130px]">
        <div className="text-muted-foreground text-xs mb-1">
          {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" />
          <span className="text-muted-foreground text-xs">연습 {practiceCount}회째</span>
          <span className="font-semibold text-sm">{displayScore}점</span>
        </div>
        {delta !== null && (
          <div className="text-xs text-muted-foreground mt-1">
            세션 연습 누적 {delta >= 0 ? `+${delta}` : delta}점
          </div>
        )}
      </div>
    );
  }

  if (d.eventType === "test") {
    const displayScore = d.score;
    const isSuccess = d.accuracyRate !== undefined
      ? d.accuracyRate >= SUCCESS_ACCURACY_THRESHOLD
      : d.isCorrect === true;
    const color = isSuccess ? "#22c55e" : SOFT_DANGER_COLOR;
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
        {d.accuracyRate !== undefined && (
          <div className="text-xs text-muted-foreground">정답률 {d.accuracyRate}%</div>
        )}
        <div className="text-xs text-muted-foreground">안정도 {displayScore}점</div>
      </div>
    );
  }

  if (d.eventType === "exam_predict_mid") {
    return null;
  }

  if (d.eventType === "exam_predict") {
    const stateColor = d.predictedState === "green" ? "#22c55e" : d.predictedState === "yellow" ? "#d4a72c" : SOFT_DANGER_COLOR;
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[160px]">
        <div className="text-muted-foreground text-xs mb-1.5">시험일 예측 ({formatExamCountdown(d.minutesUntilExam ?? d.daysUntilExam * 24 * 60)})</div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: stateColor }} />
          <span className="font-semibold text-sm" style={{ color: stateColor }}>
            예상 안정도 {d.score}점
          </span>
        </div>
        {d.scoreDelta < 0 && (
          <div className="text-xs text-rose-400 mt-0.5">현재 대비 {d.scoreDelta}점</div>
        )}
      </div>
    );
  }

  // 현재
  const displayScore = Math.round(Number(d.score ?? 0));
  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[130px]">
      <div className="text-muted-foreground text-xs mb-1">현재</div>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: BRAND_COLOR }} />
        <span className="font-semibold text-sm" style={{ color: BRAND_COLOR }}>안정도 {displayScore}점</span>
      </div>
    </div>
  );
};

export function ConfidenceHistoryModal({
  questionId,
  questionTitle,
  open,
  onClose,
  examDatePrediction,
  isDemo = false,
  previewLabel,
}: Props) {
  const [isEventLayerFocused, setIsEventLayerFocused] = useState(false);
  const [isTooltipNearPoint, setIsTooltipNearPoint] = useState(false);
  const liveHistoryQuery = trpc.confidence.getHistory.useQuery(
    { questionId: questionId! },
    { enabled: open && questionId !== null && !isDemo }
  );
  const demoHistoryQuery = trpc.demo.confidenceHistory.useQuery(
    { questionId: questionId! },
    { enabled: open && questionId !== null && isDemo }
  );
  const liveLatestConfidenceQuery = trpc.confidence.getByQuestion.useQuery(
    { questionId: questionId! },
    {
      enabled: open && questionId !== null && !examDatePrediction && !isDemo,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }
  );
  const demoLatestConfidenceQuery = trpc.demo.confidenceByQuestion.useQuery(
    { questionId: questionId! },
    {
      enabled: open && questionId !== null && !examDatePrediction && isDemo,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }
  );
  const historyData = isDemo ? demoHistoryQuery.data : liveHistoryQuery.data;
  const latestConfidence = isDemo ? demoLatestConfidenceQuery.data : liveLatestConfidenceQuery.data;
  const isExamplePreview = Boolean(isDemo || (historyData as any)?.isExample);
  const previewText = previewLabel || (historyData as any)?.previewLabel || "예시 화면";
  const isLoading = isDemo
    ? demoHistoryQuery.isLoading || demoLatestConfidenceQuery.isLoading
    : liveHistoryQuery.isLoading || liveLatestConfidenceQuery.isLoading;
  const effectiveExamDatePrediction =
    examDatePrediction ?? ((latestConfidence as any)?.examDatePrediction ?? null);

  const normalizedNowMs = Date.now();
  const points = ((historyData?.points ?? []) as HistoryPoint[]).map((point) => ({
    ...point,
    at: normalizePointTimestamp(point.at, normalizedNowMs),
  }));
  const pointsWithFallback: HistoryPoint[] = [...points];
  if (pointsWithFallback.length === 0 && effectiveExamDatePrediction) {
    const state =
      effectiveExamDatePrediction.currentScore >= 80
        ? "green"
        : effectiveExamDatePrediction.currentScore >= 40
          ? "yellow"
          : "red";
    pointsWithFallback.push({
      at: new Date(normalizedNowMs).toISOString(),
      score: effectiveExamDatePrediction.currentScore,
      state,
      eventType: "now",
    } as any);
  }

  // 최신 시험 점 표시를 위해 isLatest 플래그 추가
  const testPoints = pointsWithFallback.filter(p => p.eventType === "test");
  const latestTestAt = testPoints.length > 0 ? testPoints[testPoints.length - 1].at : null;

  // 실제 이벤트 점수만 공식 점수로 사용한다.
  const solidData: HistoryPoint[] = [...pointsWithFallback];
  const projectionExamDatePrediction = effectiveExamDatePrediction;

  const allPoints: HistoryPoint[] = [...solidData];
  let projectionMidAtISO: string | null = null;
  let projectionExamAtISO: string | null = null;
  if (projectionExamDatePrediction) {
    let examDate = new Date(projectionExamDatePrediction.examAtISO);
    if (Number.isNaN(examDate.getTime())) {
      examDate = new Date(
        Date.now() +
          (projectionExamDatePrediction.minutesUntilExam ??
            projectionExamDatePrediction.daysUntilExam * 24 * 60) *
            60_000
      );
    }
    const lastAt =
      allPoints.length > 0 ? new Date(allPoints[allPoints.length - 1].at).getTime() : Date.now();
    if (examDate.getTime() <= lastAt) {
      examDate = new Date(lastAt + 60_000);
    }
    const lastScore = clampScore(
      Number(allPoints.length > 0 ? allPoints[allPoints.length - 1].score : projectionExamDatePrediction.currentScore)
    );
    const predictedScore = clampScore(projectionExamDatePrediction.predictedScore);
    const curveGapMs = Math.max(60_000, examDate.getTime() - lastAt);
    const midAt = new Date(lastAt + Math.max(60_000, Math.floor(curveGapMs * 0.55)));
    const delta = predictedScore - lastScore;
    const curvedMidScore = clampScore(
      lastScore +
        delta * 0.72 +
        (delta < 0 ? -2 : delta > 0 ? 2 : 0)
    );
    projectionMidAtISO = midAt.toISOString();
    projectionExamAtISO = examDate.toISOString();
    allPoints.push({
      at: projectionMidAtISO,
      score: curvedMidScore,
      state: stateFromScore(curvedMidScore),
      eventType: "exam_predict_mid",
    } as any);
    allPoints.push({
      at: projectionExamAtISO,
      score: predictedScore,
      state: stateFromScore(predictedScore),
      eventType: "exam_predict",
    } as any);
  }

  const predictPoint = allPoints.find((p) => (p as any).eventType === "exam_predict");
  const timeScaleInputPoints = allPoints.filter(
    (p) => (p as any).eventType !== "exam_predict_mid"
  );
  const timeScale = buildSoftTimeScale(
    timeScaleInputPoints.map((p) => ({ at: p.at, eventType: (p as any).eventType }))
  );
  const timeScaleNodeByAt = new Map(
    timeScaleInputPoints.map((point, index) => [point.at, timeScale.nodes[index]])
  );
  const projectionStartAtISO = solidData.length > 0 ? solidData[solidData.length - 1].at : null;
  const projectionStartX =
    projectionStartAtISO ? (timeScaleNodeByAt.get(projectionStartAtISO)?.x ?? null) : null;
  const projectionExamX =
    projectionExamAtISO ? (timeScaleNodeByAt.get(projectionExamAtISO)?.x ?? null) : null;
  const chartData = allPoints.map((p, i) => {
    const isPredict = (p as any).eventType === "exam_predict";
    const isPredictMid = (p as any).eventType === "exam_predict_mid";
    const isProjectionPoint = isPredict || isPredictMid;
    let xPos = timeScaleNodeByAt.get(p.at)?.x ?? i * 24;
    if (
      isPredictMid &&
      projectionStartX !== null &&
      projectionExamX !== null &&
      projectionExamX > projectionStartX
    ) {
      xPos = projectionStartX + (projectionExamX - projectionStartX) * 0.55;
    }
    const solidLastIdx = solidData.length - 1;
    const isProjectionStart = !isProjectionPoint && i === solidLastIdx && Boolean(predictPoint);
    return {
      ...p,
      score: p.score,
      mainScore: isProjectionPoint ? null : p.score,
      idx: i,
      label: allPoints.length > 0 ? formatTimeLabel(p.at, allPoints) : "",
      xPos,
      isLatest: p.at === latestTestAt && (p as any).eventType === "test",
      projectionCurveScore: isProjectionPoint
        ? p.score
        : isProjectionStart
          ? p.score
          : null,
      ...(isPredict && projectionExamDatePrediction
        ? {
            predictedState: projectionExamDatePrediction.predictedState,
            scoreDelta: projectionExamDatePrediction.scoreDelta,
            daysUntilExam: projectionExamDatePrediction.daysUntilExam,
            hoursUntilExam: projectionExamDatePrediction.hoursUntilExam,
            minutesUntilExam: projectionExamDatePrediction.minutesUntilExam,
          }
        : {}),
    };
  });

  const hasData = solidData.length > 0;
  const latestSolidChartPoint = chartData
    .filter((p) => p.eventType !== "exam_predict" && p.eventType !== "exam_predict_mid")
    .at(-1);
  const currentScore = hasData
    ? Math.round(Number(latestSolidChartPoint?.score ?? solidData[solidData.length - 1].score))
    : null;

  // 현재 상태 색상 (점수 기반)
  const currentStateColor = currentScore === null
    ? "#6b7280"
    : currentScore >= 80
    ? "#22c55e"
    : currentScore >= 40
    ? "#d4a72c"
    : SOFT_DANGER_COLOR;

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
      return dataKey === "mainScore" && (eventType === "practice" || eventType === "test");
    });

    const eventEntry = activePayload.find(
      (entry: any) =>
        entry?.dataKey === "mainScore" &&
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

  const formatConfidenceXAxisTick = (value: number) => {
    const x = Number(value);
    if (
      projectionStartX !== null &&
      projectionExamX !== null &&
      projectionExamX > projectionStartX &&
      x > projectionStartX &&
      x < projectionExamX
    ) {
      const span = projectionExamX - projectionStartX;
      const distanceToExam = projectionExamX - x;
      if (distanceToExam > Math.max(4, span * 0.22)) return "";
      return "D-day";
    }
    return formatSoftRelativeTick(x, timeScale.nodes, timeScale.firstTs);
  };

  // 두 데이터셋을 합쳐서 XAxis 공유
  // chartData를 LineChart에 직접 사용 (mergedData 별칭 제거)

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="w-[calc(100vw-28px)] max-w-[1240px] sm:max-w-[1240px] max-h-[94vh] overflow-visible !p-4 sm:!p-5">
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
              {projectionExamDatePrediction && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5" style={{ background: `repeating-linear-gradient(90deg, ${PREDICT_COLOR} 0, ${PREDICT_COLOR} 4px, transparent 4px, transparent 7px)` }} />
                  시험일 예측
                </span>
              )}
              <span className="flex items-center gap-1.5 text-muted-foreground/50">
                <span className="inline-block w-3 h-3 rounded-full bg-gray-400" />
                연습 (호버 시만)
              </span>
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
                    padding={{ left: 4, right: 18 }}
                    tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => formatConfidenceXAxisTick(Number(value))}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 40, 80, 100]}
                    tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />

                  {/* 구간 경계선 */}
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

                  {/* 실선: 실제 안정도 흐름 */}
                  <Line
                    type="monotone"
                    dataKey="mainScore"
                    stroke={BRAND_COLOR}
                    strokeOpacity={0.9}
                    strokeWidth={3.4}
                    dot={<CustomDot eventLayerFocused={isEventLayerFocused} />}
                    activeDot={<CustomActiveDot />}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                  {/* 점선: 시험일 예측 */}
                  {predictPoint && (
                    <Line
                      type="monotone"
                      dataKey="projectionCurveScore"
                      stroke={PREDICT_COLOR}
                      strokeOpacity={0.76}
                      strokeWidth={2.2}
                      strokeDasharray="5 4"
                      dot={(props: any) =>
                        props?.payload?.eventType === "exam_predict" ? <CustomDot {...props} /> : <g />
                      }
                      activeDot={(props: any) =>
                        props?.payload?.eventType === "exam_predict" ? <CustomActiveDot {...props} /> : <g />
                      }
                      isAnimationActive={false}
                      connectNulls={true}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 시험일 예측 요약 (있을 경우) */}
            {projectionExamDatePrediction && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40 border border-border text-sm">
                <span className="text-muted-foreground text-xs">{formatExamCountdown(projectionExamDatePrediction.minutesUntilExam)} 예측</span>
                <span
                  className="font-bold text-base tabular-nums"
                  style={{
                    color:
                      projectionExamDatePrediction.predictedState === "green"
                        ? "#22c55e"
                        : projectionExamDatePrediction.predictedState === "yellow"
                          ? "#d4a72c"
                          : SOFT_DANGER_COLOR,
                  }}
                >
                  {projectionExamDatePrediction.predictedScore}점
                </span>
                {projectionExamDatePrediction.scoreDelta < 0 && (
                  <span className="text-rose-400 text-xs font-medium">{projectionExamDatePrediction.scoreDelta}점 예상 감소</span>
                )}
              </div>
            )}

            {/* 요약 통계 */}
            <div className="grid grid-cols-3 gap-3 mt-1">
              {[
                {
                  label: "연습 세션",
                  value: `${solidData
                    .filter(p => p.eventType === "practice")
                    .reduce((sum, p: any) => sum + (p.practiceSessionCount ?? 1), 0)}회`,
                },
                { label: "시험 횟수", value: `${solidData.filter(p => p.eventType === "test").length}회` },
                { label: "시험 성공률", value: (() => {
                  const tests = solidData.filter(p => p.eventType === "test");
                  if (tests.length === 0) return "-";
                  const success = tests.filter(p =>
                    (p as any).accuracyRate !== undefined
                      ? (p as any).accuracyRate >= SUCCESS_ACCURACY_THRESHOLD
                      : (p as any).isCorrect === true
                  ).length;
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
