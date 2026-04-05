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

interface ExamDatePrediction {
  predictedScore: number;
  predictedState: "green" | "yellow" | "red";
  predictedLabel: string;
  daysUntilExam: number;
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

// 성공 기준: 시험 정답률 ≥ 80% (accuracyRate 기준)
const SUCCESS_ACCURACY_THRESHOLD = 80;

// 브랜드 컬러 (보라 계열) - 선에만 사용
const BRAND_COLOR = "#8b5cf6";
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
  if (payload.eventType === "exam_predict") {
    const stateColor = payload.predictedState === "green" ? "#22c55e" : payload.predictedState === "yellow" ? "#f59e0b" : "#ef4444";
    return (
      <g key={`dot-${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={10} fill={stateColor} fillOpacity={0.15} />
        <circle cx={cx} cy={cy} r={6} fill={stateColor} stroke="white" strokeWidth={2} strokeDasharray="2 1" />
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
        <div className="text-xs text-muted-foreground">안정도 {d.score}%</div>
      </div>
    );
  }

  if (d.eventType === "exam_predict") {
    const stateColor = d.predictedState === "green" ? "#22c55e" : d.predictedState === "yellow" ? "#f59e0b" : "#ef4444";
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm min-w-[160px]">
        <div className="text-muted-foreground text-xs mb-1.5">시험일 예측 (D-{d.daysUntilExam})</div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: stateColor }} />
          <span className="font-semibold text-sm" style={{ color: stateColor }}>
            예상 안정도 {d.score}%
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
        <span className="font-semibold text-sm" style={{ color: BRAND_COLOR }}>안정도 {d.score}%</span>
      </div>
    </div>
  );
};

export function ConfidenceHistoryModal({ questionId, questionTitle, open, onClose, examDatePrediction }: Props) {
  const { data, isLoading } = trpc.confidence.getHistory.useQuery(
    { questionId: questionId! },
    { enabled: open && questionId !== null }
  );

  const points = data?.points ?? [];

  // 최신 시험 점 표시를 위해 isLatest 플래그 추가
  const testPoints = points.filter(p => p.eventType === "test");
  const latestTestAt = testPoints.length > 0 ? testPoints[testPoints.length - 1].at : null;

  // 시험일 예측 포인트 추가 (현재 시점 이후에 점선으로 표시)
  const allPoints = [...points];
  if (examDatePrediction && points.length > 0) {
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + examDatePrediction.daysUntilExam);
    allPoints.push({
      at: examDate.toISOString(),
      score: examDatePrediction.predictedScore,
      state: examDatePrediction.predictedState,
      eventType: "exam_predict",
    } as any);
  }

  const chartData = allPoints.map((p, i) => ({
    ...p,
    idx: i,
    label: allPoints.length > 0 ? formatTimeLabel(p.at, allPoints) : "",
    isLatest: p.at === latestTestAt && p.eventType === "test",
    // 예측 포인트에 추가 정보 주입
    ...(p.eventType === "exam_predict" && examDatePrediction ? {
      predictedState: examDatePrediction.predictedState,
      scoreDelta: examDatePrediction.scoreDelta,
      daysUntilExam: examDatePrediction.daysUntilExam,
    } : {}),
  }));

  // 실선 데이터 (예측 제외)
  const solidData = chartData.filter(p => p.eventType !== "exam_predict");
  // 점선 데이터 (현재 → 예측): 현재 마지막 포인트 + 예측 포인트
  const lastSolidPoint = solidData[solidData.length - 1];
  const predictPoint = chartData.find(p => p.eventType === "exam_predict");
  const dashedData = lastSolidPoint && predictPoint
    ? [lastSolidPoint, predictPoint]
    : [];

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
  const mergedData = chartData;

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
              {examDatePrediction && (
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

            <div className="h-64 w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={mergedData}
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

                  {/* 실선: 실제 안정도 흐름 (예측 제외) */}
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={BRAND_COLOR}
                    strokeWidth={2.5}
                    dot={<CustomDot />}
                    activeDot={<CustomActiveDot />}
                    isAnimationActive={true}
                    animationDuration={600}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 시험일 예측 요약 (있을 경우) */}
            {examDatePrediction && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40 border border-border text-sm">
                <span className="text-muted-foreground text-xs">D-{examDatePrediction.daysUntilExam} 예측</span>
                <span
                  className="font-bold text-base tabular-nums"
                  style={{ color: examDatePrediction.predictedState === "green" ? "#22c55e" : examDatePrediction.predictedState === "yellow" ? "#f59e0b" : "#ef4444" }}
                >
                  {examDatePrediction.predictedScore}%
                </span>
                {examDatePrediction.scoreDelta < 0 && (
                  <span className="text-red-400 text-xs font-medium">{examDatePrediction.scoreDelta}점 예상 감소</span>
                )}
                <span className="text-muted-foreground text-xs ml-auto">
                  {examDatePrediction.canReachGreen ? "시험 전 안정 구간 도달 가능" : "추가 학습 필요"}
                </span>
              </div>
            )}

            {/* 요약 통계 */}
            <div className="grid grid-cols-3 gap-3 mt-1">
              {[
                { label: "연습 횟수", value: `${solidData.filter(p => p.eventType === "practice").length}회` },
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
