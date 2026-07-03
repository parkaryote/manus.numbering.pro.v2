import { format } from "date-fns";
import { ko } from "date-fns/locale";

export type SoftTimeScaleInputPoint = {
  at: string;
  eventType?: string;
};

export type SoftTimeScaleNode = {
  x: number;
  ts: number;
  elapsedMinutes: number;
  eventType?: string;
};

function toTimestamp(value: string, fallbackTs: number): number {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : fallbackTs;
}

function getSegmentSize(deltaMinutes: number, toEventType?: string): number {
  const bounded = Math.max(1, deltaMinutes);
  const base = 24;
  const soft = base + Math.log1p(bounded) * 17;
  const examCompressed =
    toEventType === "exam_predict" ? base + (soft - base) * 0.42 : soft;
  return Math.min(170, examCompressed);
}

function roundElapsedForLabel(minutes: number): number {
  if (minutes < 10) return Math.round(minutes);
  if (minutes < 60) return Math.round(minutes / 5) * 5;
  if (minutes < 24 * 60) return Math.round(minutes / 30) * 30;
  if (minutes < 7 * 24 * 60) return Math.round(minutes / (60 * 3)) * (60 * 3);
  return Math.round(minutes / (60 * 12)) * (60 * 12);
}

export function buildSoftTimeScale(points: SoftTimeScaleInputPoint[]) {
  if (points.length === 0) {
    return {
      nodes: [] as SoftTimeScaleNode[],
      firstTs: Date.now(),
      xDomainMin: 0,
      xDomainMax: 100,
    };
  }

  const firstTs = toTimestamp(points[0].at, Date.now());
  let x = 0;
  const nodes: SoftTimeScaleNode[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const ts = toTimestamp(points[i].at, i === 0 ? firstTs : nodes[i - 1].ts);
    if (i > 0) {
      const deltaMinutes = Math.max(1, (ts - nodes[i - 1].ts) / 60000);
      x += getSegmentSize(deltaMinutes, points[i].eventType);
    }
    nodes.push({
      x,
      ts,
      elapsedMinutes: Math.max(0, Math.round((ts - firstTs) / 60000)),
      eventType: points[i].eventType,
    });
  }

  const rawRange = Math.max(1, nodes[nodes.length - 1].x);
  const padding = Math.max(rawRange * 0.06, 18);

  return {
    nodes,
    firstTs,
    xDomainMin: 0,
    xDomainMax: rawRange + padding,
  };
}

export function estimateElapsedMinutesFromSoftX(
  xValue: number,
  nodes: SoftTimeScaleNode[]
): number {
  if (nodes.length === 0) return 0;
  if (xValue <= nodes[0].x) return nodes[0].elapsedMinutes;

  const lastNode = nodes[nodes.length - 1];
  if (xValue >= lastNode.x) return lastNode.elapsedMinutes;

  for (let i = 0; i < nodes.length - 1; i += 1) {
    const left = nodes[i];
    const right = nodes[i + 1];
    if (xValue < left.x || xValue > right.x) continue;
    const segment = Math.max(0.0001, right.x - left.x);
    const ratio = (xValue - left.x) / segment;
    return left.elapsedMinutes + (right.elapsedMinutes - left.elapsedMinutes) * ratio;
  }

  return lastNode.elapsedMinutes;
}

export function formatSoftRelativeTick(
  xValue: number,
  nodes: SoftTimeScaleNode[],
  firstTs: number,
  options?: {
    compact?: boolean;
    minuteStep?: number;
    minuteSnapTolerance?: number;
    hourStep?: number;
    hourSnapToleranceMinutes?: number;
    dayStep?: number;
  }
): string {
  const approxElapsed = estimateElapsedMinutesFromSoftX(xValue, nodes);
  let rounded = Math.max(0, roundElapsedForLabel(approxElapsed));
  if (rounded === 0 && approxElapsed > 0.25) {
    rounded = 1;
  }

  if (options?.compact) {
    if (rounded < 60) {
      const minuteStep = Math.max(5, options.minuteStep ?? 10);
      if (rounded % minuteStep !== 0) return "";
      const minuteSnapTolerance = Math.max(0.25, options.minuteSnapTolerance ?? 0.8);
      if (Math.abs(approxElapsed - rounded) > minuteSnapTolerance) return "";
    } else if (rounded < 24 * 60) {
      const hourStep = Math.max(1, options.hourStep ?? 1);
      const hourUnit = hourStep * 60;
      if (rounded % hourUnit !== 0) return "";
      const hourSnapToleranceMinutes = Math.max(
        2,
        options.hourSnapToleranceMinutes ?? Math.max(6, hourStep * 8)
      );
      if (Math.abs(approxElapsed - rounded) > hourSnapToleranceMinutes) return "";
    } else {
      const dayStep = Math.max(1, options.dayStep ?? 1);
      const dayUnit = dayStep * 24 * 60;
      if (rounded % dayUnit !== 0) return "";
    }
  }

  if (rounded < 60) return `+${rounded}분`;
  if (rounded < 24 * 60) return `+${Math.round(rounded / 60)}시간`;

  const days = Math.round(rounded / (24 * 60));
  if (days < 30) return `+${days}일`;
  return format(new Date(firstTs + rounded * 60000), "M/d", { locale: ko });
}

function dedupeSortedTicks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const output: number[] = [];
  for (const value of sorted) {
    if (output.length === 0 || Math.abs(output[output.length - 1] - value) > 0.001) {
      output.push(value);
    }
  }
  return output;
}

function downsampleTicks(values: number[], maxTicks: number): number[] {
  if (values.length <= maxTicks) return values;
  if (maxTicks <= 2) return [values[0], values[values.length - 1]];

  const output: number[] = [values[0]];
  const middleCount = maxTicks - 2;
  const totalMiddle = values.length - 2;
  for (let i = 1; i <= middleCount; i += 1) {
    const index = Math.round((i * totalMiddle) / (middleCount + 1));
    output.push(values[Math.min(values.length - 2, Math.max(1, index))]);
  }
  output.push(values[values.length - 1]);
  return dedupeSortedTicks(output);
}

export function buildSoftXAxisTicks(
  nodes: SoftTimeScaleNode[],
  firstTs: number,
  options?: {
    maxTicks?: number;
    compactLabels?: boolean;
  }
): number[] {
  if (nodes.length === 0) return [];

  const maxTicks = Math.max(4, options?.maxTicks ?? 8);
  const compactLabels = options?.compactLabels ?? true;
  const compactOptions = compactLabels ? { compact: true } : undefined;

  const anchors: number[] = [];
  const seenLabel = new Set<string>();

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const isEdge = i === 0 || i === nodes.length - 1;
    const label = formatSoftRelativeTick(node.x, nodes, firstTs, compactOptions);

    if (isEdge) {
      anchors.push(node.x);
      if (label) seenLabel.add(label);
      continue;
    }

    if (!label) continue;
    if (seenLabel.has(label)) continue;
    seenLabel.add(label);
    anchors.push(node.x);
  }

  return downsampleTicks(dedupeSortedTicks(anchors), maxTicks);
}

export function buildTrendScores(
  scores: Array<number | null>,
  eventTypes: Array<string | undefined>
): Array<number | null> {
  const output: Array<number | null> = [];
  let ema: number | null = null;

  for (let i = 0; i < scores.length; i += 1) {
    const score = scores[i];
    if (score === null || Number.isNaN(score)) {
      output.push(null);
      continue;
    }

    if (ema === null) {
      ema = score;
      output.push(score);
      continue;
    }

    const eventType = eventTypes[i];
    const alpha = eventType === "test" ? 0.46 : 0.28;
    ema = ema * (1 - alpha) + score * alpha;
    output.push(Math.max(0, Math.min(100, Number(ema.toFixed(2)))));
  }

  return output;
}
