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
import {
  buildSoftTimeScale,
  buildTrendScores,
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
const EVENT_LINE_COLOR = "#64748b"; // 실제 이벤트 연결선(보조)
const PREDICT_COLOR = "#94a3b8"; // 점선 예측 색상 (slate-400)

// 커스텀 점 렌더러
const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;

  if (payload.eventType === "test") {
    const isSuccess = payload.accuracyRate !== undefined
      ? payload.accuracyRate >= SUCCESS_ACCURACY_THRESHOLD
      : payload.isCorrect === true;
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
  if (payload.eventType === "exam_predict") {
    const stateColor = payload.predictedState === "green" ? "#22c55e" : payload.predictedState === "yellow" ? "#f59e0b" : "#ef4444";
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
    const color = isSuccess ? "#22c55e" : "#ef4444";
    return <circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={2} />;
  }
  if (payload.eventType === "exam_predict") {
    const stateColor = payload.predictedState === "green" ? "#22c55e" : payload.predictedState === "yellow" ? "#f59e0b" : "#ef4444";
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
    const practiceCount = d.practiceSessionCount ?? 1;
    const delta = typeof d.practiceDelta === "number" ? d.practiceDelta : null;
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[130px]">
        <div className="text-muted-foreground text-xs mb-1">
          {format(date, "yyyy.MM.dd HH:mm", { locale: ko })}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" />
          <span className="text-muted-foreground text-xs">연습 {practiceCount}회</span>
          <span className="font-semibold text-sm">{d.score}점</span>
        </div>
        {delta !== null && (
          <div className="text-xs text-muted-foreground mt-1">
            연속 연습 누적 {delta >= 0 ? `+${delta}` : delta}점
          </div>
        )}
      </div>
    );
  }

  if (d.eventType === "test") {
    const isSuccess = d.accuracyRate !== undefined
      ? d.accuracyRate >= SUCCESS_ACCURACY_THRESHOLD
      : d.isCorrect === true;
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
        {d.accuracyRate !== undefined && (
          <div className="text-xs text-muted-foreground">정답률 {d.accuracyRate}%</div>
        )}
        <div className="text-xs text-muted-foreground">안정도 {d.score}점</div>
      </div>
    );
  }

  if (d.eventType === "exam_predict") {
    const stateColor = d.predictedState === "green" ? "#22c55e" : d.predictedState === "yellow" ? "#f59e0b" : "#ef4444";
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
          <div className="text-xs text-red-400 mt-0.5">현재 대비 {d.scoreDelta}점</div>
        )}
      </div>
    );
  }

  // 현재
  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[130px]">
      <div className="text-muted-foreground text-xs mb-1">현재</div>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: BRAND_COLOR }} />
        <span className="font-semibold text-sm" style={{ color: BRAND_COLOR }}>안정도 {d.score}점</span>
      </div>
    </div>
  );
};

export function ConfidenceHistoryModal({ questionId, questionTitle, open, onClose, examDatePrediction }: Props) {
  const { data, isLoading } = trpc.confidence.getHistory.useQuery(
    { questionId: questionId! },
    { enabled: open && questionId !== null }
  );
  const { data: latestConfidence } = trpc.confidence.getByQuestion.useQuery(
    { questionId: questionId! },
    {
      enabled: open && questionId !== null && !examDatePrediction,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }
  );
  const effectiveExamDatePrediction =
    examDatePrediction ?? ((latestConfidence as any)?.examDatePrediction ?? null);

  const points = (data?.points ?? []) as HistoryPoint[];
  const pointsWithFallback: HistoryPoint[] = [...points];
  if (pointsWithFallback.length === 0 && effectiveExamDatePrediction) {
    const state =
      effectiveExamDatePrediction.currentScore >= 80
        ? "green"
        : effectiveExamDatePrediction.currentScore >= 40
          ? "yellow"
          : "red";
    pointsWithFallback.push({
      at: new Date().toISOString(),
      score: effectiveExamDatePrediction.currentScore,
      state,
      eventType: "now",
    } as any);
  }

  // 최신 시험 점 표시를 위해 isLatest 플래그 추가
  const testPoints = pointsWithFallback.filter(p => p.eventType === "test");
  const latestTestAt = testPoints.length > 0 ? testPoints[testPoints.length - 1].at : null;

  // 시험일 예측 포인트 추가 (현재 시점 이후에 점선으로 표시)
  const allPoints: HistoryPoint[] = [...pointsWithFallback];
  if (effectiveExamDatePrediction) {
    let examDate = new Date(effectiveExamDatePrediction.examAtISO);
    if (Number.isNaN(examDate.getTime())) {
      examDate = new Date(Date.now() + (effectiveExamDatePrediction.minutesUntilExam ?? effectiveExamDatePrediction.daysUntilExam * 24 * 60) * 60_000);
    }
    const lastAt = allPoints.length > 0 ? new Date(allPoints[allPoints.length - 1].at).getTime() : Date.now();
    if (examDate.getTime() <= lastAt) {
      examDate = new Date(lastAt + 60_000);
    }
    allPoints.push({
      at: examDate.toISOString(),
      score: effectiveExamDatePrediction.predictedScore,
      state: effectiveExamDatePrediction.predictedState,
      eventType: "exam_predict",
    } as any);
  }

  // 실선/점선 분리: solidScore = 실제 데이터, dashedScore = 예측 구간
  const solidData = allPoints.filter(p => (p as any).eventType !== "exam_predict");
  const lastSolidPoint = solidData[solidData.length - 1];
  const predictPoint = allPoints.find(p => (p as any).eventType === "exam_predict");

  // 시간축은 완만하게 압축: 추세를 우선하고, 시험일 예측 구간은 과도하게 길어지지 않게 축소
  const timeScale = buildSoftTimeScale(
    allPoints.map((p) => ({ at: p.at, eventType: (p as any).eventType }))
  );
  const trendScores = buildTrendScores(
    allPoints.map((p) => ((p as any).eventType === "exam_predict" ? null : p.score)),
    allPoints.map((p) => (p as any).eventType)
  );
  const chartData = allPoints.map((p, i) => {
    const isPredict = (p as any).eventType === "exam_predict";
    const isJunction = lastSolidPoint && p.at === lastSolidPoint.at && !isPredict;
    const xPos = timeScale.nodes[i]?.x ?? i * 24;
    return {
      ...p,
      idx: i,
      label: allPoints.length > 0 ? formatTimeLabel(p.at, allPoints) : "",
      xPos,
      isLatest: p.at === latestTestAt && (p as any).eventType === "test",
      solidScore: isPredict ? null : p.score,
      trendScore: isPredict ? null : trendScores[i],
      // 점선은 마지막 실선 포인트부터 예측 포인트까지
      dashedScore: isPredict ? p.score : (isJunction ? p.score : null),
      ...(isPredict && effectiveExamDatePrediction ? {
        predictedState: effectiveExamDatePrediction.predictedState,
        scoreDelta: effectiveExamDatePrediction.scoreDelta,
        daysUntilExam: effectiveExamDatePrediction.daysUntilExam,
        hoursUntilExam: effectiveExamDatePrediction.hoursUntilExam,
        minutesUntilExam: effectiveExamDatePrediction.minutesUntilExam,
      } : {}),
    };
  });

  const hasData = solidData.length > 0;
  const currentScore = hasData ? solidData[solidData.length - 1].score : null;

  // 현재 상태 색상 (점수 기반)
  const currentStateColor = currentScore === null
    ? "#6b7280"
    : currentScore >= 80
    ? "#22c55e"
    : currentScore >= 40
    ? "#f59e0b"
    : "#ef4444";

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
              {effectiveExamDatePrediction && (
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
                    padding={{ left: 4, right: 18 }}
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

                  {/* 실선: 실제 안정도 흐름 */}
                  <Line
                    type="monotone"
                    dataKey="trendScore"
                    stroke={BRAND_COLOR}
                    strokeOpacity={0.9}
                    strokeWidth={3.4}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="solidScore"
                    stroke={EVENT_LINE_COLOR}
                    strokeOpacity={0.5}
                    strokeWidth={1.35}
                    dot={<CustomDot />}
                    activeDot={<CustomActiveDot />}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                  {/* 점선: 시험일 예측 */}
                  {predictPoint && (
                    <Line
                      type="monotone"
                      dataKey="dashedScore"
                      stroke={PREDICT_COLOR}
                      strokeOpacity={0.72}
                      strokeWidth={1.7}
                      strokeDasharray="5 4"
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                      connectNulls={true}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 시험일 예측 요약 (있을 경우) */}
            {effectiveExamDatePrediction && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40 border border-border text-sm">
                <span className="text-muted-foreground text-xs">{formatExamCountdown(effectiveExamDatePrediction.minutesUntilExam)} 예측</span>
                <span
                  className="font-bold text-base tabular-nums"
                  style={{ color: effectiveExamDatePrediction.predictedState === "green" ? "#22c55e" : effectiveExamDatePrediction.predictedState === "yellow" ? "#f59e0b" : "#ef4444" }}
                >
                  {effectiveExamDatePrediction.predictedScore}점
                </span>
                {effectiveExamDatePrediction.scoreDelta < 0 && (
                  <span className="text-red-400 text-xs font-medium">{effectiveExamDatePrediction.scoreDelta}점 예상 감소</span>
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
