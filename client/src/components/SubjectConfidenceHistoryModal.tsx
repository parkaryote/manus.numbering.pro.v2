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
  buildSoftXAxisTicks,
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
const TOOLTIP_GAP_PX = 14;
const TOOLTIP_ESTIMATED_WIDTH_PX = 210;
const TOOLTIP_ESTIMATED_HEIGHT_PX = 140;

function getSafeTooltipPosition({
  chartX,
  chartY,
  offset,
}: {
  chartX: number;
  chartY: number;
  offset?: { left?: number; top?: number; width?: number; height?: number };
}): { x: number; y: number } {
  const left = Number(offset?.left ?? 0);
  const top = Number(offset?.top ?? 0);
  const width = Number(offset?.width ?? 0);
  const height = Number(offset?.height ?? 0);
  const right = width > 0 ? left + width : Number.POSITIVE_INFINITY;
  const bottom = height > 0 ? top + height : Number.POSITIVE_INFINITY;

  let x = chartX + TOOLTIP_GAP_PX;
  let y = chartY + TOOLTIP_GAP_PX;

  if (x + TOOLTIP_ESTIMATED_WIDTH_PX > right) {
    x = chartX - TOOLTIP_ESTIMATED_WIDTH_PX - TOOLTIP_GAP_PX;
  }
  if (y + TOOLTIP_ESTIMATED_HEIGHT_PX > bottom) {
    y = chartY - TOOLTIP_ESTIMATED_HEIGHT_PX - TOOLTIP_GAP_PX;
  }

  return {
    x: Math.max(left + 4, x),
    y: Math.max(top + 4, y),
  };
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

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isProjectionEventType(eventType?: string): boolean {
  return eventType === "exam_predict" || eventType === "exam_predict_mid";
}

function getSegmentLineScore(row: {
  eventType?: string;
  score?: number | null;
  mainScore?: number | null;
}): number | null {
  if (typeof row.mainScore === "number") return row.mainScore;
  if (isProjectionEventType(row.eventType)) return null;
  return typeof row.score === "number" ? row.score : null;
}

function getCurveAnchorScore(row: {
  score?: number | null;
}): number | null {
  return typeof row.score === "number" ? row.score : null;
}

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
    mainScore?: number | null;
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
    const previousScore = getCurveAnchorScore(previous);
    const currentScore = getCurveAnchorScore(current);

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
        const previousRetentionScore = getSegmentLineScore(previous);
        const currentRetentionScore = getSegmentLineScore(current);
        if (previousRetentionScore !== null) previous.retentionScore = previousRetentionScore;
        if (currentRetentionScore !== null) current.retentionScore = currentRetentionScore;
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
  if (payload.eventType === "exam_predict") {
    const stateColor =
      payload.predictedState === "green"
        ? "#22c55e"
        : payload.predictedState === "yellow"
          ? "#d4a72c"
          : SOFT_DANGER_COLOR;
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={8} fill={stateColor} fillOpacity={0.12} />
        <circle cx={cx} cy={cy} r={4.5} fill={stateColor} stroke="white" strokeWidth={1.5} />
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
  if (payload.eventType === "exam_predict") {
    const stateColor =
      payload.predictedState === "green"
        ? "#22c55e"
        : payload.predictedState === "yellow"
          ? "#d4a72c"
          : SOFT_DANGER_COLOR;
    return <circle cx={cx} cy={cy} r={7} fill={stateColor} stroke="white" strokeWidth={2} />;
  }
  if (payload.eventType === "exam_predict_mid") return null;
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

  if (d.eventType === "exam_predict") {
    const stateColor =
      d.predictedState === "green"
        ? "#22c55e"
        : d.predictedState === "yellow"
          ? "#d4a72c"
          : SOFT_DANGER_COLOR;
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[170px]">
        <div className="text-muted-foreground text-xs mb-1">{format(date, "yyyy.MM.dd HH:mm", { locale: ko })}</div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: stateColor }} />
          <span className="font-semibold text-sm" style={{ color: stateColor }}>
            시험일 예측 {Math.round(Number(d.score ?? 0))}점
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {formatExamCountdown(Number(d.minutesUntilExam ?? 0))}
        </div>
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
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | undefined>(undefined);
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
  const liveSubjectConfidenceQuery = trpc.confidence.getBySubject.useQuery(
    { subjectId: subjectId! },
    {
      enabled: open && subjectId !== null && !isDemo,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }
  );
  const demoSubjectConfidenceQuery = trpc.demo.confidenceBySubject.useQuery(
    { subjectId: subjectId! },
    {
      enabled: open && subjectId !== null && isDemo,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }
  );

  const historyData = isDemo ? demoHistoryQuery.data : liveHistoryQuery.data;
  const subjectConfidenceData = isDemo ? demoSubjectConfidenceQuery.data : liveSubjectConfidenceQuery.data;
  const isExamplePreview = Boolean(isDemo || (historyData as any)?.isExample);
  const previewText = previewLabel || (historyData as any)?.previewLabel || "예시 화면";
  const isLoading = isDemo
    ? demoHistoryQuery.isLoading || demoSubjectConfidenceQuery.isLoading
    : liveHistoryQuery.isLoading || liveSubjectConfidenceQuery.isLoading;
  const effectiveExamDatePrediction =
    ((subjectConfidenceData as any)?.examDatePrediction ?? null) as ExamDatePrediction | null;

  const normalizedNowMs = Date.now();
  const points = ((historyData?.points ?? []) as SubjectHistoryPoint[]).map((point) => ({
    ...point,
    at: normalizePointTimestamp(point.at, normalizedNowMs),
  }));
  const pointsWithFallback: SubjectHistoryPoint[] = [...points];
  if (pointsWithFallback.length === 0 && effectiveExamDatePrediction) {
    pointsWithFallback.push({
      at: new Date(normalizedNowMs).toISOString(),
      score: effectiveExamDatePrediction.currentScore,
      eventType: "now",
    });
  }

  const solidData: SubjectHistoryPoint[] = [...pointsWithFallback];
  const testPoints = solidData.filter((p) => p.eventType === "test");
  const latestTestAt = testPoints.length > 0 ? testPoints[testPoints.length - 1].at : null;

  const allPoints: SubjectHistoryPoint[] = [...solidData];
  let projectionMidAtISO: string | null = null;
  let projectionExamAtISO: string | null = null;
  if (effectiveExamDatePrediction) {
    let examDate = new Date(effectiveExamDatePrediction.examAtISO);
    if (Number.isNaN(examDate.getTime())) {
      examDate = new Date(
        Date.now() + (effectiveExamDatePrediction.minutesUntilExam ?? 0) * 60_000
      );
    }
    const lastAt =
      allPoints.length > 0 ? new Date(allPoints[allPoints.length - 1].at).getTime() : Date.now();
    if (examDate.getTime() <= lastAt) {
      examDate = new Date(lastAt + 60_000);
    }
    const lastScore = clampScore(
      Number(
        allPoints.length > 0
          ? allPoints[allPoints.length - 1].score
          : effectiveExamDatePrediction.currentScore
      )
    );
    const predictedScore = clampScore(effectiveExamDatePrediction.predictedScore);
    const curveGapMs = Math.max(60_000, examDate.getTime() - lastAt);
    const midAt = new Date(lastAt + Math.max(60_000, Math.floor(curveGapMs * 0.55)));
    const delta = predictedScore - lastScore;
    const curvedMidScore = clampScore(
      lastScore + delta * 0.72 + (delta < 0 ? -2 : delta > 0 ? 2 : 0)
    );
    projectionMidAtISO = midAt.toISOString();
    projectionExamAtISO = examDate.toISOString();
    allPoints.push({
      at: projectionMidAtISO,
      score: curvedMidScore,
      eventType: "exam_predict_mid",
    } as SubjectHistoryPoint);
    allPoints.push({
      at: projectionExamAtISO,
      score: predictedScore,
      eventType: "exam_predict",
    } as SubjectHistoryPoint);
  }

  const timeScaleInputPoints = allPoints.filter((p) => p.eventType !== "exam_predict_mid");
  const timeScale = buildSoftTimeScale(
    timeScaleInputPoints.map((p) => ({ at: p.at, eventType: p.eventType }))
  );
  const timeScaleNodeByAt = new Map(
    timeScaleInputPoints.map((point, index) => [point.at, timeScale.nodes[index]])
  );
  const projectionStartAtISO = solidData.length > 0 ? solidData[solidData.length - 1].at : null;
  const projectionStartX =
    projectionStartAtISO ? (timeScaleNodeByAt.get(projectionStartAtISO)?.x ?? null) : null;
  const projectionExamX =
    projectionExamAtISO ? (timeScaleNodeByAt.get(projectionExamAtISO)?.x ?? null) : null;

  const xAxisTicks = buildSoftXAxisTicks(timeScale.nodes, timeScale.firstTs, {
    maxTicks: 8,
    compactLabels: true,
  });

  const chartData = splitForgettingSeriesByNow(
    addSegmentLineScores(
      allPoints.map((p, i) => {
        const isPredict = p.eventType === "exam_predict";
        const isPredictMid = p.eventType === "exam_predict_mid";
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
        return {
          ...p,
          score: p.score,
          mainScore: isProjectionPoint ? null : p.score,
          idx: i,
          xPos,
          isLatest: p.at === latestTestAt && p.eventType === "test",
          ...(isPredict && effectiveExamDatePrediction
            ? {
                predictedState: effectiveExamDatePrediction.predictedState,
                scoreDelta: effectiveExamDatePrediction.scoreDelta,
                daysUntilExam: effectiveExamDatePrediction.daysUntilExam,
                hoursUntilExam: effectiveExamDatePrediction.hoursUntilExam,
                minutesUntilExam: effectiveExamDatePrediction.minutesUntilExam,
              }
            : {}),
        };
      })
    ),
    normalizedNowMs
  ).map((row) => {
    const atMs = new Date(row.at).getTime();
    const isFuture = Number.isFinite(atMs) && atMs > normalizedNowMs;
    if (!isFuture) return row;
    return {
      ...row,
      retentionScore: null,
    };
  });

  const hasData = solidData.length > 0;
  const latestCurrentChartPoint = chartData
    .filter((p) => {
      if (p.eventType === "exam_predict" || p.eventType === "exam_predict_mid") return false;
      const atMs = new Date(p.at).getTime();
      return !Number.isFinite(atMs) || atMs <= normalizedNowMs;
    })
    .at(-1);
  const latestNonProjectionPoint = chartData
    .filter((p) => p.eventType !== "exam_predict" && p.eventType !== "exam_predict_mid")
    .at(-1);
  const resolvedCurrentScore =
    latestCurrentChartPoint?.score ??
    latestNonProjectionPoint?.score ??
    (solidData.length > 0 ? solidData[solidData.length - 1].score : null);
  const graphCurrentScore =
    hasData && typeof resolvedCurrentScore === "number"
      ? Math.round(Number(resolvedCurrentScore))
      : null;
  const currentScore =
    typeof currentScoreOverride === "number" && Number.isFinite(currentScoreOverride)
      ? Math.round(currentScoreOverride)
      : graphCurrentScore;
  const currentStateColor = currentScore !== null ? getStateColor(currentScore) : "#6b7280";
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
    return formatSoftRelativeTick(x, timeScale.nodes, timeScale.firstTs, {
      compact: true,
    });
  };
  const handleChartMouseMove = (state: any) => {
    const activePayload = state?.activePayload ?? [];
    const chartX = Number(state?.chartX);
    const chartY = Number(state?.chartY);
    const activeX = Number(state?.activeCoordinate?.x);
    if (!Number.isFinite(chartX) || !Number.isFinite(chartY) || !Number.isFinite(activeX)) {
      setIsEventLayerFocused(false);
      setIsTooltipNearPoint(false);
      setTooltipPosition(undefined);
      return;
    }

    const hasEventLayerHover = activePayload.some((entry: any) => {
      const eventType = entry?.payload?.eventType;
      const dataKey = entry?.dataKey;
      return dataKey === "mainScore" && (eventType === "practice" || eventType === "test" || eventType === "forgetting");
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
      setTooltipPosition(undefined);
      return;
    }

    const distance = Math.hypot(chartX - activeX, chartY - activeY);
    const isNearPoint = distance <= TOOLTIP_POINT_HOVER_RADIUS_PX;
    setIsTooltipNearPoint(isNearPoint);
    setTooltipPosition(isNearPoint ? getSafeTooltipPosition({ chartX, chartY, offset: state?.offset }) : undefined);
    setIsEventLayerFocused(hasEventLayerHover && isNearPoint);
  };

  const handleChartMouseLeave = () => {
    setIsEventLayerFocused(false);
    setIsTooltipNearPoint(false);
    setTooltipPosition(undefined);
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
                    ticks={xAxisTicks}
                    interval="preserveStartEnd"
                    minTickGap={36}
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
                    position={tooltipPosition}
                    isAnimationActive={false}
                    wrapperStyle={{ zIndex: 90, pointerEvents: "none", transition: "none" }}
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
                    dot={(props: any) =>
                      props?.payload?.eventType === "exam_predict"
                        ? <CustomDot {...props} onSelectPoint={handleSelectTestPoint} />
                        : <g />
                    }
                    activeDot={(props: any) =>
                      props?.payload?.eventType === "exam_predict"
                        ? <CustomActiveDot {...props} onSelectPoint={handleSelectTestPoint} />
                        : <g />
                    }
                    isAnimationActive={true}
                    animationDuration={600}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="mainScore"
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

            {effectiveExamDatePrediction && (
              <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-muted/40 border border-border text-xs sm:text-sm">
                <span className="text-muted-foreground text-[11px] sm:text-xs">
                  {formatExamCountdown(effectiveExamDatePrediction.minutesUntilExam)} 예측
                </span>
                <span
                  className="font-bold text-sm sm:text-base tabular-nums"
                  style={{
                    color:
                      effectiveExamDatePrediction.predictedState === "green"
                        ? "#22c55e"
                        : effectiveExamDatePrediction.predictedState === "yellow"
                          ? "#d4a72c"
                          : SOFT_DANGER_COLOR,
                  }}
                >
                  {effectiveExamDatePrediction.predictedScore}점
                </span>
                {effectiveExamDatePrediction.scoreDelta < 0 && (
                  <span className="text-rose-400 text-xs font-medium">
                    ({effectiveExamDatePrediction.scoreDelta})
                  </span>
                )}
                {effectiveExamDatePrediction.scoreDelta > 0 && (
                  <span className="text-emerald-500 text-xs font-medium">
                    (+{effectiveExamDatePrediction.scoreDelta})
                  </span>
                )}
              </div>
            )}

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
