import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Circle, Image as ImageIcon, Table2, Eye, EyeOff, Zap, StickyNote, Pencil, Repeat, Save, X, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { splitGraphemes, isPartialMatch, isHangul, isJamo, decomposeHangul } from "@/lib/hangul";
import { TableEditor, TableView, TableData, getBlankCells, gradeTable } from "@/components/TableEditor";
import { trackQuestionAttempt, trackPracticeComplete } from "@/lib/ga4Events";
import { DamageNumber } from "@/components/DamageNumber";
import { ConfidenceHistoryModal } from "@/components/ConfidenceHistoryModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONFIDENCE_THRESHOLDS, estimatePracticeConfidenceDelta } from "@shared/examConfidence";
import { buildNextAutoNumberingValue, getForcedPrefixByTemplateProgress, getLinePrefixHint } from "@/lib/autoNumbering";
import { getImageAttribution } from "@/lib/imageAttribution";

interface PracticeProps {
  questionId: number;
  isDemo?: boolean;
}

type InputLayoutPreference = "horizontal" | "vertical";

const JAMO_TO_KEYSTROKE: Record<string, string> = {
  "ㄱ": "r",
  "ㄲ": "r",
  "ㄴ": "s",
  "ㄷ": "e",
  "ㄸ": "e",
  "ㄹ": "f",
  "ㅁ": "a",
  "ㅂ": "q",
  "ㅃ": "q",
  "ㅅ": "t",
  "ㅆ": "t",
  "ㅇ": "d",
  "ㅈ": "w",
  "ㅉ": "w",
  "ㅊ": "c",
  "ㅋ": "z",
  "ㅌ": "x",
  "ㅍ": "v",
  "ㅎ": "g",
  "ㅏ": "k",
  "ㅐ": "o",
  "ㅑ": "i",
  "ㅒ": "o",
  "ㅓ": "j",
  "ㅔ": "p",
  "ㅕ": "u",
  "ㅖ": "p",
  "ㅗ": "h",
  "ㅘ": "hk",
  "ㅙ": "ho",
  "ㅚ": "hl",
  "ㅛ": "y",
  "ㅜ": "n",
  "ㅝ": "nj",
  "ㅞ": "np",
  "ㅟ": "nl",
  "ㅠ": "b",
  "ㅡ": "m",
  "ㅢ": "ml",
  "ㅣ": "l",
  "ㄳ": "rt",
  "ㄵ": "sw",
  "ㄶ": "sg",
  "ㄺ": "fr",
  "ㄻ": "fa",
  "ㄼ": "fq",
  "ㄽ": "ft",
  "ㄾ": "fx",
  "ㄿ": "fv",
  "ㅀ": "fg",
  "ㅄ": "qt",
};

const ALNUM_REGEX = /^[a-z0-9]$/i;
const AUTO_SEED_NUMBER_ONLY_REGEX = /^\s*\d{1,3}[.)]\s*$/;
const AUTO_SEED_BULLET_ONLY_REGEX = /^\s*(?:[-*•·●○◦▪▫▸▹►▶‣⁃※])\s*$/;

function scoreToConfidenceState(score: number): "green" | "yellow" | "red" {
  if (score >= CONFIDENCE_THRESHOLDS.green) return "green";
  if (score >= CONFIDENCE_THRESHOLDS.yellow) return "yellow";
  return "red";
}

function toTypingKeyUnit(char: string): string {
  if (!char) return "";
  if (ALNUM_REGEX.test(char)) return char.toLowerCase();

  if (isHangul(char)) {
    const d = decomposeHangul(char);
    if (!d) return char.toLowerCase();
    return `${JAMO_TO_KEYSTROKE[d.cho] ?? d.cho}${JAMO_TO_KEYSTROKE[d.jung] ?? d.jung}${
      d.jong ? JAMO_TO_KEYSTROKE[d.jong] ?? d.jong : ""
    }`.toLowerCase();
  }

  if (isJamo(char)) {
    return (JAMO_TO_KEYSTROKE[char] ?? char).toLowerCase();
  }

  return char.toLowerCase();
}

function toTypingKeySequence(text: string): string {
  return splitGraphemes(text)
    .map((char) => toTypingKeyUnit(char))
    .join("");
}

function toInitialKeySequence(text: string): string {
  return splitGraphemes(text)
    .map((char) => {
      if (isHangul(char)) {
        const d = decomposeHangul(char);
        if (!d) return "";
        return (JAMO_TO_KEYSTROKE[d.cho] ?? d.cho).charAt(0).toLowerCase();
      }
      if (isJamo(char)) {
        const key = JAMO_TO_KEYSTROKE[char] ?? char;
        return key.charAt(0).toLowerCase();
      }
      if (ALNUM_REGEX.test(char)) return char.toLowerCase();
      return "";
    })
    .join("");
}

function isLikelyInitialShortcutInput(text: string): boolean {
  const chars = splitGraphemes(text);
  if (chars.length === 0) return false;
  return chars.every((char) => ALNUM_REGEX.test(char) || isJamo(char));
}

function deleteCurrentLineAtCursor(
  value: string,
  selectionStart: number,
  selectionEnd: number
): { nextValue: string; nextCursor: number } {
  if (value.length === 0) return { nextValue: value, nextCursor: 0 };

  if (selectionStart !== selectionEnd) {
    return {
      nextValue: value.slice(0, selectionStart) + value.slice(selectionEnd),
      nextCursor: selectionStart,
    };
  }

  const cursor = selectionStart;
  const lineStart = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const rawLineEnd = value.indexOf("\n", cursor);
  const lineEnd = rawLineEnd === -1 ? value.length : rawLineEnd;

  let removeStart = lineStart;
  let removeEnd = lineEnd;

  if (lineStart === 0 && lineEnd < value.length) {
    removeEnd = lineEnd + 1;
  } else if (lineStart > 0 && lineEnd === value.length) {
    removeStart = lineStart - 1;
  } else if (lineStart > 0 && lineEnd < value.length) {
    removeEnd = lineEnd + 1;
  }

  return {
    nextValue: value.slice(0, removeStart) + value.slice(removeEnd),
    nextCursor: removeStart,
  };
}

function deleteWordBeforeCursor(
  value: string,
  selectionStart: number,
  selectionEnd: number
): { nextValue: string; nextCursor: number } {
  if (value.length === 0) return { nextValue: value, nextCursor: 0 };

  if (selectionStart !== selectionEnd) {
    return {
      nextValue: value.slice(0, selectionStart) + value.slice(selectionEnd),
      nextCursor: selectionStart,
    };
  }

  let cursor = selectionStart;
  while (cursor > 0 && /\s/.test(value[cursor - 1])) cursor--;
  while (cursor > 0 && !/\s/.test(value[cursor - 1])) cursor--;

  return {
    nextValue: value.slice(0, cursor) + value.slice(selectionEnd),
    nextCursor: cursor,
  };
}

function hashSeedToInt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandomFactory(seed: string): () => number {
  let a = hashSeedToInt(seed) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleBySeed<T>(items: T[], seed: string): T[] {
  if (items.length <= 1) return [...items];
  const result = [...items];
  const random = seededRandomFactory(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function Practice({ questionId, isDemo = false }: PracticeProps) {
  const [, setLocation] = useLocation();
  const SCORE_STATE_COLOR = {
    green: "#10b981",
    yellow: "#d4a72c",
    red: "#d66b78",
  } as const;
  const searchParams = new URLSearchParams(window.location.search);
  const isScrollNavMode = searchParams.get("scrollNav") !== "0";
  const isRandomNavMode = searchParams.get("random") === "1";
  const randomSeedParam = (searchParams.get("seed") || "").trim();
  const isDemoLinkedMode = !isDemo && searchParams.get("demo") === "1";
  const demoLinkedSubjectIdRaw = Number.parseInt(searchParams.get("demoSubjectId") || "", 10);
  const demoLinkedSubjectId =
    Number.isFinite(demoLinkedSubjectIdRaw) && demoLinkedSubjectIdRaw > 0
      ? demoLinkedSubjectIdRaw
      : null;
  const INPUT_DRAFT_KEY_PREFIX = "practice_input_draft_";
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollNavCooldownRef = useRef(0);
  const scrollNavDeltaRef = useRef(0);
  const scrollNavDeltaResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inputLayoutPreference, setInputLayoutPreference] = useState<InputLayoutPreference>(() => {
    try {
      const saved = localStorage.getItem("practice_input_layout_preference");
      if (saved === "horizontal" || saved === "vertical") return saved;
      if (saved === "split" || saved === "auto") return "horizontal";
      if (saved === "stacked") return "vertical";
    } catch {}
    return "vertical";
  });
  const [userInput, setUserInput] = useState("");
  const [imageLabelAnswers, setImageLabelAnswers] = useState<Record<number, string>>({});
  const [imageLoaded, setImageLoaded] = useState(false);
  const [revealedLabels, setRevealedLabels] = useState<Set<number>>(new Set()); // 클릭하여 공개된 라벨
  const [imageMatchedLabelIndices, setImageMatchedLabelIndices] = useState<Set<number>>(new Set());
  const lastLabelActionRef = useRef<'reveal' | 'hide' | null>(null);
  const revealedLabelsRef = useRef<Set<number>>(new Set()); // 마지막 라벨 클릭 행동
  const imageMatchedLabelRef = useRef<Set<number>>(new Set());
  const setRevealedLabelsRef = useRef<React.Dispatch<React.SetStateAction<Set<number>>> | null>(null);
  const imageLabelsLengthRef = useRef<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [currentContinuousStartAt, setCurrentContinuousStartAt] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isActive, setIsActive] = useState(true); // 측정 중 여부
  const [lastInputTime, setLastInputTime] = useState<number>(Date.now());
  const [isComposing, setIsComposing] = useState(false); // 한글 조합 중
  const [practiceNote, setPracticeNote] = useState(""); // 연습용 메모장
  const [notepadLines, setNotepadLines] = useState(50); // 메모장 줄 수
  const [imageScale, setImageScaleRaw] = useState(() => {
    const saved = localStorage.getItem('imageScale');
    if (!saved) return 60;
    const parsed = parseInt(saved, 10);
    if (!Number.isFinite(parsed)) return 60;
    return Math.max(30, Math.min(100, parsed));
  }); // 이미지 크기 비율 (%)
  const imageLayoutRowRef = useRef<HTMLDivElement>(null);
  const imageAnswerPanelRef = useRef<HTMLDivElement>(null);
  const imageElementRef = useRef<HTMLImageElement>(null);
  const imageNaturalSizeRef = useRef({ width: 0, height: 0 });
  const setImageScale = (val: number) => {
    const safeVal = Math.max(30, Math.min(100, Math.round(val)));
    setImageScaleRaw(safeVal);
    localStorage.setItem('imageScale', String(safeVal));
  };
  const [imageContainerHeight, setImageContainerHeight] = useState(400); // 이미지 컨테이너 높이
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const notepadRef = useRef<HTMLTextAreaElement>(null);
  const [hasInteracted, setHasInteracted] = useState(false); // 이미지 문제: 클릭 또는 입력 여부
  const [isFadingOut, setIsFadingOut] = useState(false); // fade out 애니메이션 상태
  const isResettingRef = useRef(false); // 초기화 진행 중 플래그 (compositionend 잔류 방지)
  const [practiceCount, setPracticeCount] = useState(0); // 현재 연습 횟수 (세션 동안만 유지)
  const [inputHistory, setInputHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showInactiveAlert, setShowInactiveAlert] = useState(false); // 입력 시간 알림
  const [currentCursorLineIndex, setCurrentCursorLineIndex] = useState(0); // 현재 커서 위치의 줄 인덱스
  const [lineIndicatorPulse, setLineIndicatorPulse] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showDamageNumber, setShowDamageNumber] = useState(false);
  const [damageValue, setDamageValue] = useState(0);
  const confidenceScoreForAnimationRef = useRef<number | null>(null);
  const [optimisticDisplayScore, setOptimisticDisplayScore] = useState<number | null>(null);
  // 답 가리기 상태: 'none' | 'all'
  // hiddenLines: 개별 줄 가리기/보이기 토글 (hideMode와 독립적으로 동작)
  const [hideMode, setHideMode] = useState<'none' | 'all'>('none');
  const [hiddenLines, setHiddenLines] = useState<Set<number>>(new Set());
  const [autoHideWrongLines, setAutoHideWrongLines] = useState<Set<number>>(new Set());
  // 학습 제안 상태
  const [showStudySuggestion, setShowStudySuggestion] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  // 메모 (암기법/설명 - 영구 저장, 연습장과 구분)
  const [memo, setMemo] = useState('');
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoSaved, setMemoSaved] = useState(false);
  // 줄 반복 연습 (체크박스 다중 선택 방식)
  const [repeatCheckedLines, setRepeatCheckedLines] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem(`focus_lines_${questionId}`);
      if (saved) return new Set(JSON.parse(saved) as number[]);
    } catch {}
    return new Set();
  });
  const [repeatCurrentIdx, setRepeatCurrentIdx] = useState(0); // 체크된 줄 중 현재 순서 (0-based)
  const [repeatCount, setRepeatCount] = useState(0); // 현재 줄 완료 횟수
  const [repeatTotalCount, setRepeatTotalCount] = useState(0); // 전체 완료 횟수
  const isRepeatMode = repeatCheckedLines.size > 0;
  // 안정도 그래프 모달
  const [showConfidenceHistory, setShowConfidenceHistory] = useState(false);
  // 연속 완료 카운트 (세션 내, 3회마다 백지시험 유도)
  const [sessionCompleteCount, setSessionCompleteCount] = useState(0);
  const [showTestNudge, setShowTestNudge] = useState(false);
  const autoHideCompletedLinesRef = useRef<Set<number>>(new Set());
  const autoHideViewedLinesRef = useRef<Set<number>>(new Set());
  const autoHidePreCompletedLinesRef = useRef<Set<number>>(new Set());
  const autoHideCompletionLockRef = useRef(0);
  const [showWarnZone, setShowWarnZone] = useState(false);
  const [scrollNavDirection, setScrollNavDirection] = useState<"prev" | "next" | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [jumpInput, setJumpInput] = useState("");
  const imageLayoutSeededQuestionRef = useRef<number | null>(null);
  const isRestoringDraftRef = useRef(false);
  const autoSeededQuestionRef = useRef<number | null>(null);
  // 문제 수정 모드
  const [editMode, setEditMode] = useState(false);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [editAutoNumbering, setEditAutoNumbering] = useState(true);
  const [editTableData, setEditTableData] = useState<TableData | null>(null);
  // 이미지 컨테이너 높이 추적 (메모장 높이 동기화)
  useEffect(() => {
    if (!imageContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        setImageContainerHeight(h);
        // 이미지 높이에 맞춰 메모장 줄 수 계산 (28px per line)
        const lines = Math.max(20, Math.ceil(h / 28));
        setNotepadLines(lines);
      }
    });
    observer.observe(imageContainerRef.current);
    return () => observer.disconnect();
  }, [imageLoaded, imageScale]);

  const answerDisplayRef = useRef<HTMLDivElement>(null); // 정답 표시 영역 ref
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inactiveAlertTimerRef = useRef<NodeJS.Timeout | null>(null); // 입력 시간 알림 타이머
  const lastInputRef = useRef<string>(""); // 마지막 입력값 추적 (모바일용)

  const { data: question, isLoading } = trpc.questions.getById.useQuery({ id: questionId });
  const { data: subject } = trpc.subjects.getById.useQuery(
    { id: question?.subjectId ?? 0 },
    { enabled: !!question?.subjectId }
  );
  // 인접 문제 네비게이션을 위한 같은 과목 문제 목록
  const { data: subjectQuestions } = trpc.questions.listBySubject.useQuery(
    { subjectId: question?.subjectId ?? 0 },
    { enabled: !!question?.subjectId && !isDemo }
  );
  const demoLinkedPreviewQuery = trpc.demo.questions.useQuery(
    { subjectId: demoLinkedSubjectId ?? 0 },
    { enabled: isDemoLinkedMode && !!demoLinkedSubjectId, refetchOnWindowFocus: false }
  );
  const effectiveRandomSeed = useMemo(() => {
    if (!isRandomNavMode) return "";
    if (randomSeedParam) return randomSeedParam;
    return `subject-${question?.subjectId ?? 0}`;
  }, [isRandomNavMode, question?.subjectId, randomSeedParam]);

  const filteredSubjectQuestions = useMemo(() => {
    if (!subjectQuestions) return undefined;
    if (!isDemoLinkedMode || !demoLinkedSubjectId) return subjectQuestions;
    if (!demoLinkedPreviewQuery.data) return [];
    const allowedSourceQuestionIds = new Set(
      demoLinkedPreviewQuery.data.map((q) => q.id)
    );
    return subjectQuestions.filter((q: any) =>
      allowedSourceQuestionIds.has(q.demoSourceQuestionId ?? -1)
    );
  }, [demoLinkedPreviewQuery.data, demoLinkedSubjectId, isDemoLinkedMode, subjectQuestions]);

  const orderedSubjectQuestions = useMemo(() => {
    if (!filteredSubjectQuestions) return undefined;
    if (!isRandomNavMode) return filteredSubjectQuestions;
    return shuffleBySeed(filteredSubjectQuestions, effectiveRandomSeed);
  }, [effectiveRandomSeed, filteredSubjectQuestions, isRandomNavMode]);

  const currentIndex = orderedSubjectQuestions?.findIndex((q) => q.id === questionId) ?? -1;
  const prevQuestion = currentIndex > 0 ? orderedSubjectQuestions?.[currentIndex - 1] : null;
  const nextQuestion = currentIndex >= 0 && orderedSubjectQuestions && currentIndex < orderedSubjectQuestions.length - 1
    ? orderedSubjectQuestions[currentIndex + 1]
    : null;
  const totalQuestions = orderedSubjectQuestions?.length ?? 0;
  const showToothMorphologySource = (subject?.name ?? "").includes("치아형태학");
  const { data: practiceCountData } = trpc.practice.countByQuestion.useQuery(
    { questionId },
    { enabled: !!questionId && !isDemo }
  );
  const { data: practiceSessionsData } = trpc.practice.getByQuestion.useQuery(
    { questionId },
    { enabled: !!questionId && !isDemo }
  );
  const { data: confidenceData } = trpc.confidence.getByQuestion.useQuery(
    { questionId },
    { enabled: !!questionId && !isDemo }
  );
  const imageAttribution = useMemo(
    () => getImageAttribution(question?.id, question?.imageUrl),
    [question?.id, question?.imageUrl]
  );
  const utils = trpc.useUtils();
  const createSession = trpc.practice.create.useMutation({
    onError: (error) => {
      // Silently ignore errors in demo mode
      if (!isDemo) {
        console.error('Failed to create practice session:', error);
      }
    },
  });
  const saveMemoMutation = trpc.questions.saveMemo.useMutation({
    onSuccess: () => {
      setMemoSaved(true);
      setMemoSaving(false);
      setTimeout(() => setMemoSaved(false), 2000);
      utils.questions.getById.invalidate({ id: questionId });
    },
    onError: (error) => {
      setMemoSaving(false);
      toast.error('메모 저장 실패: ' + error.message);
    },
  });
  const updateQuestionMutation = trpc.questions.update.useMutation({
    onSuccess: () => {
      toast.success('문제가 수정되었습니다');
      setEditMode(false);
      utils.questions.getById.invalidate({ id: questionId });
    },
    onError: (error) => {
      toast.error('수정 실패: ' + error.message);
    },
  });

  // 페이지 언마운트 또는 돌아가기 시 자동으로 연습 기록 저장 (1회만)
  const hasBeenSaved = useRef(false);
  const savePracticeSessionRef = useRef<() => Promise<void>>(async () => {});

  const practiceNavSearch = useMemo(() => {
    const params = new URLSearchParams();
    if (isScrollNavMode) params.set("scrollNav", "1");
    if (isRandomNavMode) {
      params.set("random", "1");
      if (effectiveRandomSeed) params.set("seed", effectiveRandomSeed);
    }
    if (isDemoLinkedMode && demoLinkedSubjectId) {
      params.set("demo", "1");
      params.set("demoSubjectId", String(demoLinkedSubjectId));
    }
    const raw = params.toString();
    return raw ? `?${raw}` : "";
  }, [demoLinkedSubjectId, effectiveRandomSeed, isDemoLinkedMode, isRandomNavMode, isScrollNavMode]);

  const navigateWithMorph = useCallback((targetQuestionId: number, forcedDirection?: "prev" | "next") => {
    if (!orderedSubjectQuestions || totalQuestions <= 0) return;
    if (isLeaving || targetQuestionId === questionId) return;

    const targetIndex = orderedSubjectQuestions.findIndex((q) => q.id === targetQuestionId);
    if (targetIndex < 0) return;

    const direction = forcedDirection ?? (targetIndex > currentIndex ? "next" : "prev");
    setScrollNavDirection(direction);
    setIsLeaving(true);
    void savePracticeSessionRef.current();
    setTimeout(() => {
      setLocation(`/practice/${targetQuestionId}${practiceNavSearch}`);
    }, 240);
  }, [currentIndex, isLeaving, orderedSubjectQuestions, practiceNavSearch, questionId, setLocation, totalQuestions]);

  const buildTestPath = useCallback(() => {
    if (!question) return "";
    const params = new URLSearchParams();
    params.set("autostart", "1");
    if (isDemoLinkedMode && demoLinkedSubjectId) {
      params.set("demo", "1");
      params.set("demoSubjectId", String(demoLinkedSubjectId));
    }
    return `/test/${question.id}?${params.toString()}`;
  }, [demoLinkedSubjectId, isDemoLinkedMode, question]);

  const jumpToQuestionByNumber = useCallback((rawValue: string) => {
    if (!orderedSubjectQuestions || totalQuestions <= 0) return;
    const parsed = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setJumpInput(currentIndex >= 0 ? String(currentIndex + 1) : "");
      return;
    }
    const clamped = Math.max(1, Math.min(totalQuestions, parsed));
    setJumpInput(String(clamped));
    const target = orderedSubjectQuestions[clamped - 1];
    if (target && target.id !== questionId) {
      navigateWithMorph(target.id);
    }
  }, [currentIndex, navigateWithMorph, orderedSubjectQuestions, questionId, totalQuestions]);

  // 문제별 애니메이션 기준 점수 초기화
  useEffect(() => {
    confidenceScoreForAnimationRef.current = null;
    setOptimisticDisplayScore(null);
  }, [questionId]);

  useEffect(() => {
    setIsLeaving(false);
    setScrollNavDirection(null);
  }, [questionId]);

  useEffect(() => {
    if (!orderedSubjectQuestions || currentIndex < 0) {
      setJumpInput("");
      return;
    }
    setJumpInput(String(currentIndex + 1));
  }, [currentIndex, questionId, orderedSubjectQuestions]);

  // 첫 로드 시 현재 안정도 점수를 애니메이션 기준값으로 설정
  useEffect(() => {
    if (isDemo) return;
    if (confidenceScoreForAnimationRef.current !== null) return;
    if (typeof confidenceData?.displayScore === "number") {
      confidenceScoreForAnimationRef.current = Math.round(confidenceData.displayScore);
      }
  }, [confidenceData?.displayScore, isDemo]);

  const displayedConfidenceScore = useMemo(() => {
    if (isDemo) return 0;
    if (optimisticDisplayScore !== null) return optimisticDisplayScore;
    return Math.round(confidenceData?.displayScore ?? 0);
  }, [confidenceData?.displayScore, isDemo, optimisticDisplayScore]);

  const displayedConfidenceState = useMemo(() => {
    if (displayedConfidenceScore >= CONFIDENCE_THRESHOLDS.green) return "green";
    if (displayedConfidenceScore >= CONFIDENCE_THRESHOLDS.yellow) return "yellow";
    return "red";
  }, [displayedConfidenceScore]);

  const appendOptimisticConfidenceHistoryPoint = useCallback((params: {
    score: number;
    eventType: "practice" | "test";
    practiceSessionCount?: number;
    practiceDelta?: number;
    isCorrect?: boolean;
    accuracyRate?: number;
    at?: string;
  }) => {
    if (!question || isDemo) return;
    type HistoryPointCache = {
      at: string;
      score: number;
      state: "green" | "yellow" | "red";
      eventType: "practice" | "test" | "now";
      isCorrect?: boolean;
      accuracyRate?: number;
      practiceSessionCount?: number;
      practiceDelta?: number;
    };

    const nextPoint: HistoryPointCache = {
      at: params.at ?? new Date().toISOString(),
      score: params.score,
      state: scoreToConfidenceState(params.score),
      eventType: params.eventType,
      ...(typeof params.practiceSessionCount === "number"
        ? { practiceSessionCount: params.practiceSessionCount }
        : {}),
      ...(typeof params.practiceDelta === "number" ? { practiceDelta: params.practiceDelta } : {}),
      ...(typeof params.isCorrect === "boolean" ? { isCorrect: params.isCorrect } : {}),
      ...(typeof params.accuracyRate === "number" ? { accuracyRate: params.accuracyRate } : {}),
    };

    utils.confidence.getHistory.setData({ questionId: question.id }, (prev) => {
      if (!prev) return prev;
      const safePoints = (prev?.points ?? []) as HistoryPointCache[];
      const withoutNow = safePoints.filter((point) => point.eventType !== "now");
      const nextPoints = [...withoutNow, nextPoint];

      return {
        ...prev,
        points: nextPoints,
      };
    });
  }, [isDemo, question?.id, utils]);

  // 이미지 문제: 상호작용 시 practiceCount를 최소 1로 설정
  useEffect(() => {
    if (hasInteracted && practiceCount === 0) {
      setPracticeCount(1);
    }
  }, [hasInteracted]);

  // 문제 이동 모드: 연습 박스에서 좌/우 스크롤(트랙패드 포함)로 이전/다음 문제 이동
  useEffect(() => {
    if (!isScrollNavMode || isDemo) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    const NAV_COOLDOWN_MS = 620;
    const NAV_MIN_DELTA = 10;
    const NAV_TRIGGER_DELTA = 80;
    const NAV_DELTA_RESET_MS = 420;

    const handleWheel = (event: WheelEvent) => {
      if (isLeaving) {
        event.preventDefault();
        return;
      }
      // 수평 스크롤이 우세할 때만 문제 이동으로 처리
      if (Math.abs(event.deltaX) < NAV_MIN_DELTA) return;
      if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;

      const targetEl = event.target as HTMLElement | null;
      const isTypingTarget = !!targetEl?.closest("textarea, input, [contenteditable='true']");
      if (isTypingTarget) return;

      // macOS 트랙패드 좌우 스와이프(브라우저 뒤/앞으로)와 충돌 방지:
      // 연습 화면의 수평 제스처는 항상 앱 내 네비게이션으로 우선 처리한다.
      if (event.cancelable) {
        event.preventDefault();
      }

      const now = Date.now();
      if (now - scrollNavCooldownRef.current < NAV_COOLDOWN_MS) return;

      scrollNavDeltaRef.current += event.deltaX;
      if (scrollNavDeltaResetTimerRef.current) {
        clearTimeout(scrollNavDeltaResetTimerRef.current);
      }
      scrollNavDeltaResetTimerRef.current = setTimeout(() => {
        scrollNavDeltaRef.current = 0;
      }, NAV_DELTA_RESET_MS);

      // 오른쪽으로 스크롤(+) => 다음 문제
      if (scrollNavDeltaRef.current > NAV_TRIGGER_DELTA && nextQuestion) {
        event.preventDefault();
        scrollNavDeltaRef.current = 0;
        scrollNavCooldownRef.current = now;
        navigateWithMorph(nextQuestion.id, "next");
        return;
      }

      // 왼쪽으로 스크롤(-) => 이전 문제
      if (scrollNavDeltaRef.current < -NAV_TRIGGER_DELTA && prevQuestion) {
        event.preventDefault();
        scrollNavDeltaRef.current = 0;
        scrollNavCooldownRef.current = now;
        navigateWithMorph(prevQuestion.id, "prev");
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      if (scrollNavDeltaResetTimerRef.current) {
        clearTimeout(scrollNavDeltaResetTimerRef.current);
        scrollNavDeltaResetTimerRef.current = null;
      }
      scrollNavDeltaRef.current = 0;
    };
  }, [isScrollNavMode, isDemo, prevQuestion, nextQuestion, isLeaving, navigateWithMorph]);

  // 모바일 sticky 입력창: 부모 main 요소의 overflow를 제어하여 Practice 내부에서 스크롤 처리
  useEffect(() => {
    // DashboardLayout의 <main> 요소를 찾아 overflow 제거
    const mainEl = document.querySelector('[data-slot="sidebar-inset"] > main') as HTMLElement | null;
    if (mainEl) {
      const prev = mainEl.style.overflow;
      mainEl.style.overflow = 'hidden';
      return () => {
        mainEl.style.overflow = prev;
      };
    }
  }, []);

  // 모바일 키보드 대응: visualViewport API로 키보드 올라올 때 레이아웃 조정
  useEffect(() => {
    const rootEl = document.getElementById('root') as HTMLElement | null;
    if (!rootEl || !window.visualViewport) return;

    const handleViewportResize = () => {
      const vv = window.visualViewport!;
      // visualViewport 높이를 root에 적용하여 키보드 공간 확보
      rootEl.style.height = `${vv.height}px`;
      rootEl.style.position = 'fixed';
      rootEl.style.top = `${vv.offsetTop}px`;
      rootEl.style.left = `${vv.offsetLeft}px`;
      rootEl.style.width = `${vv.width}px`;
    };

    window.visualViewport.addEventListener('resize', handleViewportResize);
    window.visualViewport.addEventListener('scroll', handleViewportResize);
    handleViewportResize();

    return () => {
      window.visualViewport!.removeEventListener('resize', handleViewportResize);
      window.visualViewport!.removeEventListener('scroll', handleViewportResize);
      // 언마운트 시 원래대로 복원
      rootEl.style.height = '';
      rootEl.style.position = '';
      rootEl.style.top = '';
      rootEl.style.left = '';
      rootEl.style.width = '';
    };
  }, []);

  // 새로운 문제로 이동할 때 hasBeenSaved 초기화
  useEffect(() => {
    hasBeenSaved.current = false;
    autoSeededQuestionRef.current = null;
    tablePartialSavedRatioRef.current = 0;
    autoHideCompletedLinesRef.current = new Set();
    autoHideViewedLinesRef.current = new Set();
    autoHidePreCompletedLinesRef.current = new Set();
    autoHideCompletionLockRef.current = 0;
    setHideMode("none");
    setHiddenLines(new Set());
    setAutoHideWrongLines(new Set());
    setStartTime(null);
    setCurrentContinuousStartAt(null);
    setIsLeaving(false);
    setHasInteracted(false);
    // 반복 연습 상태도 초기화
    setRepeatCheckedLines(new Set());
    setRepeatCurrentIdx(0);
    setRepeatCount(0);
    setRepeatTotalCount(0);

    // 문제별 입력 드래프트 복원 (스크롤/버튼 이동 시 사용자 입력 유지)
    isRestoringDraftRef.current = true;
    let restored = "";
    try {
      restored = sessionStorage.getItem(`${INPUT_DRAFT_KEY_PREFIX}${questionId}`) || "";
    } catch {}
    setUserInput(restored);
    lastInputRef.current = restored;
    setInputHistory([restored]);
    setHistoryIndex(0);
    setCurrentCursorLineIndex(Math.max(0, restored.split("\n").length - 1));
    if (textareaRef.current) {
      textareaRef.current.value = restored;
      textareaRef.current.setSelectionRange(restored.length, restored.length);
    }
    setTimeout(() => {
      isRestoringDraftRef.current = false;
    }, 0);
  }, [questionId]);

  // 현재 문제 입력값을 자동 저장 (비어있으면 삭제)
  useEffect(() => {
    if (isRestoringDraftRef.current) return;
    try {
      const key = `${INPUT_DRAFT_KEY_PREFIX}${questionId}`;
      if (userInput.trim().length === 0) {
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, userInput);
      }
    } catch {}
  }, [questionId, userInput]);

  const targetText = (question?.answer || "").replace(/\s+$/g, "");
  const targetVisualLineCount = useMemo(() => {
    const lines = targetText.split("\n");
    while (lines.length > 1 && lines[lines.length - 1]?.trim() === "") {
      lines.pop();
    }
    return Math.max(1, lines.length);
  }, [targetText]);
  const answerPanelMinHeightPx = useMemo(() => {
    const estimatedAnswerLineHeight = 34;
    const verticalPadding = 24;
    const raw = targetVisualLineCount * estimatedAnswerLineHeight + verticalPadding;
    const min = memoOpen ? 260 : 140;
    const max = memoOpen ? 560 : 460;
    return Math.min(Math.max(raw, min), max);
  }, [targetVisualLineCount, memoOpen]);
  const inputPanelMinHeightPx = useMemo(() => {
    const estimatedInputLineHeight = 34;
    const verticalPadding = 24;
    const raw = targetVisualLineCount * estimatedInputLineHeight + verticalPadding;
    return Math.min(Math.max(raw, 200), 420);
  }, [targetVisualLineCount]);
  const imageLabels = question?.imageLabels ? JSON.parse(question.imageLabels) : [];
  const isImageQuestion = !!question?.imageUrl && imageLabels.length > 0;
  const imageAnswerEntries = useMemo(() => {
    if (!isImageQuestion) return [] as Array<{ index: number; answer: string }>;
    return imageLabels
      .map((label: any, index: number) => ({
        index,
        answer: String(label?.answer ?? "").trim(),
      }))
      .filter((row) => row.answer.length > 0);
  }, [imageLabels, isImageQuestion]);
  const useHorizontalImageLayout = isImageQuestion && inputLayoutPreference === "horizontal";
  const useVerticalImageLayout = isImageQuestion && inputLayoutPreference === "vertical";

  useEffect(() => {
    imageMatchedLabelRef.current = imageMatchedLabelIndices;
  }, [imageMatchedLabelIndices]);

  const applyImageFitScale = useCallback(() => {
    if (!isImageQuestion) return;

    const naturalWidth = imageNaturalSizeRef.current.width;
    const naturalHeight = imageNaturalSizeRef.current.height;
    if (!naturalWidth || !naturalHeight) return;

    const rowEl = imageLayoutRowRef.current;
    const answerEl = imageAnswerPanelRef.current;
    if (!rowEl) return;

    const rowRect = rowEl.getBoundingClientRect();
    const answerRect = answerEl?.getBoundingClientRect();
    const gapPx = 10;
    const reserved = useHorizontalImageLayout ? Math.max(0, answerRect?.width ?? rowRect.width * 0.42) : 0;
    const availableWidth = Math.max(240, rowRect.width - reserved - gapPx);
    const panelHeight = window.innerHeight * (isDemo ? 0.72 : 0.64);
    const targetScaleByWidth = Math.min(100, (availableWidth / naturalWidth) * 100);
    const targetScaleByHeight = Math.min(100, (panelHeight / naturalHeight) * 100);
    const candidate = Math.floor(Math.max(30, Math.min(targetScaleByWidth, targetScaleByHeight)));
    setImageScale(Math.max(30, Math.min(100, candidate)));
  }, [isDemo, isImageQuestion, useHorizontalImageLayout]);

  useEffect(() => {
    if (!isImageQuestion) return;
    const handleResize = () => {
      window.requestAnimationFrame(() => {
        applyImageFitScale();
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [applyImageFitScale, isImageQuestion]);

  useEffect(() => {
    if (isImageQuestion && questionId) {
      imageNaturalSizeRef.current = { width: 0, height: 0 };
      setImageLoaded(false);
      setImageMatchedLabelIndices(new Set());
    }
  }, [questionId, isImageQuestion]);

  useEffect(() => {
    if (!isImageQuestion || !question?.id) return;
    if (imageLayoutSeededQuestionRef.current === question.id) return;
    imageLayoutSeededQuestionRef.current = question.id;
    setInputLayoutPreference("horizontal");
  }, [isImageQuestion, question?.id]);

  useEffect(() => {
    if (!isImageQuestion || !imageLoaded) return;
    window.requestAnimationFrame(() => {
      applyImageFitScale();
    });
  }, [applyImageFitScale, imageLoaded, isImageQuestion, useHorizontalImageLayout, useVerticalImageLayout, memoOpen]);

  useEffect(() => {
    try {
      localStorage.setItem("practice_input_layout_preference", inputLayoutPreference);
    } catch {}
  }, [inputLayoutPreference]);

  // 메모 초기화: question 로드 시 DB에서 가져오기
  useEffect(() => {
    if (question?.memo) {
      setMemo(question.memo);
    } else {
      setMemo('');
    }
  }, [question?.id, question?.memo]);

  // 메모 저장 핸들러
  const handleSaveMemo = () => {
    if (!question || isDemo) return;
    setMemoSaving(true);
    saveMemoMutation.mutate({ id: question.id, memo: memo || null });
  };

  // 집중 연습 선택 상태 localStorage 저장
  useEffect(() => {
    try {
      localStorage.setItem(`focus_lines_${questionId}`, JSON.stringify(Array.from(repeatCheckedLines)));
    } catch {}
  }, [repeatCheckedLines, questionId]);

  // 줄 체크박스 토글
  const toggleRepeatLine = (lineIdx: number) => {
    setRepeatCheckedLines(prev => {
      const next = new Set(prev);
      if (next.has(lineIdx)) {
        next.delete(lineIdx);
      } else {
        next.add(lineIdx);
      }
      return next;
    });
    setRepeatCurrentIdx(0);
    setRepeatCount(0);
  };

  // 줄 반복 연습 종료
  const stopRepeatMode = () => {
    setRepeatCheckedLines(new Set());
    setRepeatCurrentIdx(0);
    setRepeatCount(0);
    setRepeatTotalCount(0);
    // 입력창 전체 정답으로 복원
    setUserInput('');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  // 체크된 줄 목록
  const repeatLinesSorted = useMemo(() => {
    return Array.from(repeatCheckedLines).sort((a, b) => a - b);
  }, [repeatCheckedLines]);

  // 현재 반복 중인 줄의 대상 텍스트
  const currentRepeatTarget = useMemo(() => {
    if (!isRepeatMode || repeatLinesSorted.length === 0) return null;
    const lineIdx = repeatLinesSorted[repeatCurrentIdx % repeatLinesSorted.length];
    return { lineIdx, text: targetText.split('\n')[lineIdx] || '' };
  }, [isRepeatMode, repeatLinesSorted, repeatCurrentIdx, targetText]);

  // stale closure 방지: 항상 최신 반복 연습 상태를 ref에 동기화
  const repeatStateRef = useRef({ isRepeatMode, repeatLinesSorted, repeatCurrentIdx, targetText });
  useEffect(() => {
    repeatStateRef.current = { isRepeatMode, repeatLinesSorted, repeatCurrentIdx, targetText };
  }, [isRepeatMode, repeatLinesSorted, repeatCurrentIdx, targetText]);

  // 문제 수정 모드 시작
  const startEditMode = () => {
    if (!question) return;
    setEditQuestion(question.question);
    setEditAnswer(question.answer || '');
    setEditAutoNumbering((question.autoNumbering ?? 1) === 1);
    if (question.tableData) {
      try {
        const parsed = JSON.parse(question.tableData) as TableData;
        setEditTableData(parsed);
      } catch {
        setEditTableData(null);
      }
    } else {
      setEditTableData(null);
    }
    setEditMode(true);
  };

  // 문제 수정 저장
  const handleSaveEdit = () => {
    if (!question || isDemo) return;
    if (isTableQuestion) {
      if (!editTableData) {
        toast.error("표를 작성하세요");
        return;
      }
      const blankCount = editTableData.cells.flat().filter((c) => c.isBlank && !c.isMerged).length;
      if (blankCount === 0) {
        toast.error("연습 셀을 1개 이상 지정하세요");
        return;
      }
      updateQuestionMutation.mutate({
        id: question.id,
        question: editQuestion,
        tableData: JSON.stringify(editTableData),
      });
      return;
    }
    updateQuestionMutation.mutate({
      id: question.id,
      question: editQuestion,
      answer: editAnswer,
      autoNumbering: editAutoNumbering ? 1 : 0,
    });
  };

  const toggleHideAll = useCallback(() => {
    if (isImageQuestion && imageLabelsLengthRef.current > 0) {
      const totalLabels = imageLabelsLengthRef.current;
      const allRevealed = revealedLabelsRef.current.size >= totalLabels;
      if (allRevealed) {
        const hidden = new Set<number>();
        revealedLabelsRef.current = hidden;
        setRevealedLabels(hidden);
        lastLabelActionRef.current = "reveal";
      } else {
        const shown = new Set<number>(Array.from({ length: totalLabels }, (_, i) => i));
        revealedLabelsRef.current = shown;
        setRevealedLabels(shown);
        lastLabelActionRef.current = "hide";
      }
      return;
    }
    setHideMode((prev) => {
      const next = prev === "all" ? "none" : "all";
      if (next === "all") {
        const sourceInput = lastInputRef.current ?? userInput;
        autoHidePreCompletedLinesRef.current = collectCompletedTargetLineIndices(
          sourceInput,
          repeatStateRef.current.targetText
        );
      } else {
        autoHidePreCompletedLinesRef.current = new Set();
      }
      return next;
    });
    setHiddenLines(new Set());
    setAutoHideWrongLines(new Set());
    autoHideCompletedLinesRef.current = new Set();
    autoHideViewedLinesRef.current = new Set();
    autoHideCompletionLockRef.current = 0;
  }, [isImageQuestion, userInput]);

  const handleImagePracticeNoteChange = useCallback((value: string) => {
    setPracticeNote(value);
    if (!hasInteracted && value.trim().length > 0) setHasInteracted(true);
    const now = Date.now();
    if (!startTime) setStartTime(now);
    setLastInputTime(now);
    if (!isActive) {
      setIsActive(true);
      setCurrentContinuousStartAt(now);
    }
  }, [hasInteracted, isActive, startTime]);

  // 메모장에 미리 줄바꿈 채워넣기 (줄이 그어진 연습장처럼 어디서나 클릭 시 바로 입력 가능)
  useEffect(() => {
    if (!isImageQuestion || isDemo) return;
    // practiceNote가 비어있을 때만 초기화
    if (practiceNote === "") {
      setPracticeNote("\n".repeat(notepadLines));
    }
  }, [isDemo, isImageQuestion, notepadLines, practiceNote]);
  const tableData: TableData | null = question?.tableData ? JSON.parse(question.tableData) : null;
  const isTableQuestion = !!tableData;
  const shouldAutoSeedPracticeNumbering =
    !isTableQuestion &&
    !isImageQuestion &&
    question?.autoNumbering === 1;
  const firstTemplateLineForSeed = useMemo(() => {
    const lines = targetText.split("\n");
    return lines.find((line) => line.trim().length > 0) ?? lines[0] ?? "";
  }, [targetText]);
  const getPracticeInputSeed = useCallback((templateLine?: string) => {
    if (!shouldAutoSeedPracticeNumbering) return "";
    const candidates = [templateLine, firstTemplateLineForSeed];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const hint = getLinePrefixHint(candidate);
      if (hint?.prefix) return hint.prefix;
    }
    return "";
  }, [firstTemplateLineForSeed, shouldAutoSeedPracticeNumbering]);
  const isListPrefixOnlyDraft = useCallback((value: string) => {
    const normalized = value.replace(/\r\n/g, "\n");
    const nonEmptyLines = normalized
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);
    if (nonEmptyLines.length === 0) return false;
    return nonEmptyLines.every((line) => {
      const trimmed = line.trim();
      return AUTO_SEED_NUMBER_ONLY_REGEX.test(trimmed) || AUTO_SEED_BULLET_ONLY_REGEX.test(trimmed);
    });
  }, []);
  const useHorizontalInputLayout =
    !isImageQuestion &&
    !isTableQuestion &&
    inputLayoutPreference === "horizontal";
  const isImageMaskActive =
    isImageQuestion &&
    imageLabels.length > 0 &&
    revealedLabels.size < imageLabels.length;
  const contentBottomPaddingClass = isImageQuestion
    ? "pb-6"
    : useHorizontalInputLayout
    ? "pb-28"
    : "pb-72";
  const answerPanelMaxHeight = memoOpen
    ? "58vh"
    : useHorizontalInputLayout
    ? "74vh"
    : "62vh";
  const horizontalInputMinHeightPx = useHorizontalInputLayout
    ? Math.max(inputPanelMinHeightPx, 360)
    : inputPanelMinHeightPx;
  const [tableAnswers, setTableAnswers] = useState<Record<string, string>>({});
  const [tableResults, setTableResults] = useState<Record<string, boolean> | null>(null);
  const [tablePracticeCount, setTablePracticeCount] = useState(0);
  // 표 문제 하단 입력창 연습 모드
  const [tableActiveCellIdx, setTableActiveCellIdx] = useState(0); // 현재 입력 중인 셀 인덱스
  const [tableCompletedCells, setTableCompletedCells] = useState<Set<string>>(new Set());
  const [tableCheckedCells, setTableCheckedCells] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`focus_cells_${questionId}`);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch {}
    return new Set();
  });
  const [tableCellInput, setTableCellInput] = useState(''); // 하단 입력창 현재 입력값
  const [isTableComposing, setIsTableComposing] = useState(false); // 표 입력창 한글 조합 중 여부
  const [tableCellSubmittedResult, setTableCellSubmittedResult] = useState<'correct' | 'wrong' | 'typing' | null>(null);
  const [tableWrongCells, setTableWrongCells] = useState<Set<string>>(new Set());

  // 표 문제 집중 연습 선택 상태 localStorage 저장
  useEffect(() => {
    try {
      localStorage.setItem(`focus_cells_${questionId}`, JSON.stringify(Array.from(tableCheckedCells)));
    } catch {}
  }, [tableCheckedCells, questionId]);
  const tableCellInputRef = useRef<HTMLTextAreaElement>(null);
  const tableInputResettingRef = useRef(false);
  const tablePartialSavedRatioRef = useRef(0);

  useEffect(() => {
    if (!question?.id || !shouldAutoSeedPracticeNumbering) return;
    if (autoSeededQuestionRef.current === question.id) return;
    const hasMeaningfulDraft = userInput.trim().length > 0 && !isListPrefixOnlyDraft(userInput);
    if (hasMeaningfulDraft) {
      autoSeededQuestionRef.current = question.id;
      return;
    }

    const seeded = getPracticeInputSeed();
    autoSeededQuestionRef.current = question.id;
    setUserInput(seeded);
    lastInputRef.current = seeded;
    setInputHistory([seeded]);
    setHistoryIndex(0);
    setCurrentCursorLineIndex(0);

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.value = seeded;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(seeded.length, seeded.length);
    });
  }, [getPracticeInputSeed, isListPrefixOnlyDraft, question?.id, shouldAutoSeedPracticeNumbering, userInput]);
  


  const AUTO_NUMBER_LINE_PREFIX_REGEX = /^\s*\d{1,3}\s*[.)]\s*/;
  const BULLET_LINE_PREFIX_REGEX = /^\s*(?:[-*•·●○◦▪▫▸▹►▶‣⁃※])\s*/;
  type ListPrefixInfo = {
    kind: "number" | "bullet" | null;
    prefix: string;
    body: string;
  };
  const getListPrefixInfo = (line: string): ListPrefixInfo => {
    const numberMatch = line.match(AUTO_NUMBER_LINE_PREFIX_REGEX);
    if (numberMatch) {
      const prefix = numberMatch[0] ?? "";
      return {
        kind: "number",
        prefix,
        body: line.slice(prefix.length),
      };
    }
    const bulletMatch = line.match(BULLET_LINE_PREFIX_REGEX);
    if (bulletMatch) {
      const prefix = bulletMatch[0] ?? "";
      return {
        kind: "bullet",
        prefix,
        body: line.slice(prefix.length),
      };
    }
    return {
      kind: null,
      prefix: "",
      body: line,
    };
  };
  const stripLineNumberPrefix = (line: string) =>
    line.replace(AUTO_NUMBER_LINE_PREFIX_REGEX, "").trim();
  const stripBulletPrefix = (line: string) =>
    line.replace(BULLET_LINE_PREFIX_REGEX, "").trim();
  const normalizeLineForComparison = (line: string) => {
    const lineWithoutNumber =
      question?.autoNumbering === 1 ? stripLineNumberPrefix(line) : line.trim();
    const lineWithoutListPrefix = stripBulletPrefix(lineWithoutNumber);
    return lineWithoutListPrefix.replace(/\s+/g, "");
  };
  const normalizeLineForTypingCompare = (line: string) =>
    toTypingKeySequence(normalizeLineForComparison(line));
  // Normalize text: remove spaces/newlines and (auto-numbering question only) leading line numbers
  const normalizeText = (text: string) =>
    text
      .split("\n")
      .map((line) => normalizeLineForComparison(line))
      .join("");
  const normalizeTextForTypingCompare = (text: string) =>
    text
      .split("\n")
      .map((line) => normalizeLineForTypingCompare(line))
      .join("");
  const isInitialShortcutComplete = (input: string, target: string) => {
    const normalizedInput = normalizeText(input);
    const normalizedTarget = normalizeText(target);
    if (!normalizedInput || !normalizedTarget) return false;
    if (!isLikelyInitialShortcutInput(normalizedInput)) return false;
    if (!/[가-힣]/.test(normalizedTarget)) return false;
    const userInitials = toInitialKeySequence(normalizedInput);
    const targetInitials = toInitialKeySequence(normalizedTarget);
    return targetInitials.length > 0 && userInitials === targetInitials;
  };
  // 띄어쓰기/줄바꿈을 무시하고 정답 완주 여부를 판정 (한글 조합 허용)
  const isNormalizedComplete = (input: string, target: string) => {
    const normalizedInput = normalizeText(input);
    const normalizedTarget = normalizeText(target);
    if (normalizedTarget.length === 0) return false;
    const targetChars = splitGraphemes(normalizedTarget);
    const userChars = splitGraphemes(normalizedInput);
    if (userChars.length !== targetChars.length) return false;
    for (let i = 0; i < targetChars.length; i++) {
      const r = isPartialMatch(userChars[i], targetChars[i], targetChars[i + 1]);
      if (r !== "complete" && r !== "partial_complete") return false;
    }

    return true;
  };
  const isTypingEquivalentComplete = (input: string, target: string) => {
    if (isNormalizedComplete(input, target)) return true;

    const typingInput = normalizeTextForTypingCompare(input);
    const typingTarget = normalizeTextForTypingCompare(target);
    if (typingTarget.length > 0 && typingInput === typingTarget) return true;

    if (isInitialShortcutComplete(input, target)) return true;
    return false;
  };
  const buildLineComparePair = (userLineRaw: string, targetLineRaw: string) => {
    const targetPrefixInfo = getListPrefixInfo(targetLineRaw);
    const userPrefixInfo = getListPrefixInfo(userLineRaw);
    const shouldSkipTargetPrefixForCompare =
      targetPrefixInfo.kind !== null && userPrefixInfo.kind === null;

    return {
      userLineForCompare: userLineRaw,
      targetLineForCompare: shouldSkipTargetPrefixForCompare
        ? targetPrefixInfo.body
        : targetLineRaw,
    };
  };
  const normalizeLinePairForComparison = (userLineRaw: string, targetLineRaw: string) => {
    const { userLineForCompare, targetLineForCompare } = buildLineComparePair(
      userLineRaw,
      targetLineRaw
    );
    return {
      user: userLineForCompare.replace(/\s+/g, ""),
      target: targetLineForCompare.replace(/\s+/g, ""),
    };
  };
  const normalizeLinePairForTypingCompare = (userLineRaw: string, targetLineRaw: string) => {
    const normalized = normalizeLinePairForComparison(userLineRaw, targetLineRaw);
    return {
      user: toTypingKeySequence(normalized.user),
      target: toTypingKeySequence(normalized.target),
    };
  };
  const isLinePairNormalizedComplete = (userLineRaw: string, targetLineRaw: string) => {
    const normalized = normalizeLinePairForComparison(userLineRaw, targetLineRaw);
    if (!normalized.target) return false;
    const targetChars = splitGraphemes(normalized.target);
    const userChars = splitGraphemes(normalized.user);
    if (userChars.length < targetChars.length) return false;
    for (let i = 0; i < targetChars.length; i++) {
      const r = isPartialMatch(userChars[i], targetChars[i], targetChars[i + 1]);
      if (r !== "complete" && r !== "partial_complete") return false;
    }
    return true;
  };
  const isLinePairTypingEquivalentComplete = (userLineRaw: string, targetLineRaw: string) => {
    if (isLinePairNormalizedComplete(userLineRaw, targetLineRaw)) return true;

    const typingNormalized = normalizeLinePairForTypingCompare(userLineRaw, targetLineRaw);
    if (typingNormalized.target.length > 0 && typingNormalized.user.startsWith(typingNormalized.target)) {
      return true;
    }

    const comparePair = buildLineComparePair(userLineRaw, targetLineRaw);
    if (isInitialShortcutComplete(comparePair.userLineForCompare, comparePair.targetLineForCompare)) {
      return true;
    }

    return false;
  };
  const isTypingEquivalentCompleteByLineFlow = (input: string, target: string) => {
    const userLines = input.split("\n");
    const targetLines = target.split("\n");
    let carryOverKeys = "";
    let hasMeaningfulTarget = false;

    for (let lineIdx = 0; lineIdx < targetLines.length; lineIdx++) {
      const targetLineRaw = targetLines[lineIdx] ?? "";
      const pair = buildLineComparePair(userLines[lineIdx] ?? "", targetLineRaw);
      const targetTyping = toTypingKeySequence(pair.targetLineForCompare.replace(/\s+/g, ""));
      if (targetTyping.length === 0) continue;
      hasMeaningfulTarget = true;

      let userTyping = toTypingKeySequence(pair.userLineForCompare.replace(/\s+/g, ""));
      if (carryOverKeys.length > 0) {
        userTyping = `${carryOverKeys}${userTyping}`;
      }
      if (!userTyping.startsWith(targetTyping)) return false;
      carryOverKeys = userTyping.slice(targetTyping.length);
    }

    return hasMeaningfulTarget;
  };
  const findCompletedSentenceIndex = (
    input: string,
    target: string,
    options?: {
      preferredUserLineIndex?: number;
      excludeTargetLineIndices?: Set<number>;
    }
  ): number => {
    const targetLines = target.split("\n");
    const userLines = input.split("\n");
    const excludedTargetLineIndices = options?.excludeTargetLineIndices ?? new Set<number>();
    const preferredUserLineIndex = options?.preferredUserLineIndex ?? -1;

    const candidateTargetIndices: number[] = [];
    for (let ti = 0; ti < targetLines.length; ti++) {
      if (excludedTargetLineIndices.has(ti)) continue;
      if (normalizeLineForComparison(targetLines[ti] ?? "").length === 0) continue;
      candidateTargetIndices.push(ti);
    }

    if (candidateTargetIndices.length === 0) return -1;

    const tryMatchUserLine = (userLine: string, preferredTargetLineIndex?: number): number => {
      if (normalizeLineForComparison(userLine).length === 0) return -1;

      if (
        typeof preferredTargetLineIndex === "number" &&
        preferredTargetLineIndex >= 0 &&
        !excludedTargetLineIndices.has(preferredTargetLineIndex) &&
        normalizeLineForComparison(targetLines[preferredTargetLineIndex] ?? "").length > 0 &&
        isLinePairTypingEquivalentComplete(userLine, targetLines[preferredTargetLineIndex] ?? "")
      ) {
        return preferredTargetLineIndex;
      }

      for (const ti of candidateTargetIndices) {
        if (isLinePairTypingEquivalentComplete(userLine, targetLines[ti] ?? "")) {
          return ti;
        }
      }

      return -1;
    };

    if (preferredUserLineIndex >= 0 && preferredUserLineIndex < userLines.length) {
      const preferredMatched = tryMatchUserLine(
        userLines[preferredUserLineIndex] ?? "",
        preferredUserLineIndex
      );
      if (preferredMatched >= 0) return preferredMatched;
    }

    for (let ui = userLines.length - 1; ui >= 0; ui--) {
      if (ui === preferredUserLineIndex) continue;
      const userLine = userLines[ui] ?? "";
      const matched = tryMatchUserLine(userLine, ui);
      if (matched >= 0) return matched;
    }

    return -1;
  };

  const markLineViewedInAutoHide = (lineIdx: number) => {
    if (hideMode !== "all") return;
    const next = new Set(autoHideViewedLinesRef.current);
    next.add(lineIdx);
    autoHideViewedLinesRef.current = next;
  };

  const collectCompletedTargetLineIndices = (
    input: string,
    target: string,
    options?: {
      excludeTargetLineIndices?: Set<number>;
    }
  ): Set<number> => {
    const excludedTargetLineIndices = options?.excludeTargetLineIndices ?? new Set<number>();
    const completed = new Set<number>();
    const targetLines = target.split("\n");
    const userLines = input.split("\n");

    for (let ti = 0; ti < targetLines.length; ti++) {
      if (excludedTargetLineIndices.has(ti)) continue;
      const targetLine = targetLines[ti] ?? "";
      if (normalizeLineForComparison(targetLine).length === 0) continue;
      for (let ui = 0; ui < userLines.length; ui++) {
        const userLine = userLines[ui] ?? "";
        if (isLinePairTypingEquivalentComplete(userLine, targetLine)) {
          completed.add(ti);
          break;
        }
      }
    }

    return completed;
  };

  const getAutoHideExcludedLineIndices = () => {
    const merged = new Set<number>(autoHideCompletedLinesRef.current);
    autoHidePreCompletedLinesRef.current.forEach((idx) => merged.add(idx));
    return merged;
  };

  const seedPracticeInput = (seeded: string) => {
    isResettingRef.current = true;
    setIsComposing(false);
    setUserInput(seeded);
    lastInputRef.current = seeded;
    setInputHistory([seeded]);
    setHistoryIndex(0);
    setCurrentCursorLineIndex(0);
    const now = Date.now();
    setLastInputTime(now);
    if (!isActive) setIsActive(true);
    if (!startTime) setStartTime(now);
    setCurrentContinuousStartAt(now);

    if (textareaRef.current) {
      textareaRef.current.value = seeded;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(seeded.length, seeded.length);
    }

    requestAnimationFrame(() => {
      isResettingRef.current = false;
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(seeded.length, seeded.length);
      }
    });
  };

  const applySentencePracticeReward = (params: {
    typedLength: number;
    completionRatio: number;
    wasBlind: boolean;
  }) => {
    const { typedLength, completionRatio, wasBlind } = params;
    setPracticeCount((prev) => prev + 1);

    if (question && !isDemo) {
      const baselineScore =
        confidenceScoreForAnimationRef.current ??
        Math.round(confidenceData?.displayScore ?? 0);
      const minutesUntilExam = (confidenceData as any)?.examDatePrediction?.minutesUntilExam;
      const daysUntilExam = (confidenceData as any)?.examDatePrediction?.daysUntilExam;
      const estimatedHoursUntilExam =
        typeof minutesUntilExam === "number"
          ? minutesUntilExam / 60
          : typeof daysUntilExam === "number"
            ? daysUntilExam * 24
            : null;

      const baseDelta = estimatePracticeConfidenceDelta({
        currentScore: baselineScore,
        sessionPracticeCount: sessionCompleteCount + 1,
        totalPracticeCount: (practiceCountData?.count || 0) + practiceCount + 1,
        hoursUntilExam: estimatedHoursUntilExam,
      });
      const ratioWeight = Math.max(0.35, Math.min(1.25, 0.45 + completionRatio * 1.05));
      const visibilityWeight = wasBlind ? 1 : 0.42;
      const scaledDelta = Math.round(baseDelta * ratioWeight * visibilityWeight);
      const estimatedDelta = Math.max(wasBlind ? 2 : 1, scaledDelta);

      const optimisticScore = Math.max(0, Math.min(100, baselineScore + estimatedDelta));
      confidenceScoreForAnimationRef.current = optimisticScore;
      setOptimisticDisplayScore(optimisticScore);
      appendOptimisticConfidenceHistoryPoint({
        eventType: "practice",
        score: optimisticScore,
        practiceSessionCount: (practiceCountData?.count || 0) + practiceCount + 1,
        practiceDelta: estimatedDelta,
      });
      setShowDamageNumber(false);
      requestAnimationFrame(() => {
        setDamageValue(estimatedDelta);
        setShowDamageNumber(true);
      });

      (async () => {
        try {
          const durationWeight = Math.max(
            0.16,
            Math.min(1.1, (wasBlind ? 0.95 : 0.35) * (0.42 + completionRatio * 1.08))
          );
          const duration = Math.max(1, Math.round(Math.max(elapsedTime, 1) * durationWeight));
          const timeInMinutes = duration / 60;
          const typingSpeed = timeInMinutes > 0 ? Math.round(Math.max(typedLength, 1) / timeInMinutes) : 0;
          await createSession.mutateAsync({
            questionId: question.id,
            duration,
            typingSpeed,
            accuracy: wasBlind ? 100 : 84,
            errorCount: wasBlind ? 0 : 1,
          });
          await Promise.all([
            utils.confidence.getByQuestion.invalidate({ questionId: question.id }),
            utils.confidence.getHistory.invalidate({ questionId: question.id }),
            utils.practice.countByQuestion.invalidate({ questionId: question.id }),
          ]);
          const [latestConfidence] = await Promise.all([
            utils.confidence.getByQuestion.fetch({ questionId: question.id }),
            utils.confidence.getHistory.fetch({ questionId: question.id }),
          ]);
          const latestScore = Math.round(latestConfidence?.displayScore ?? optimisticScore);
          confidenceScoreForAnimationRef.current = latestScore;
          setOptimisticDisplayScore(latestScore);
        } catch (error) {
          console.error("문장 단위 연습 기록 저장 실패:", error);
        }
      })();
    }

    if (isDemo && question) {
      const storageKey = `demo_practice_count_${question.id}`;
      const currentCount = parseInt(localStorage.getItem(storageKey) || "0", 10);
      localStorage.setItem(storageKey, String(currentCount + 1));
    }
  };

  const movePracticeCursorToLine = (baseInputValue: string, lineIdx: number) => {
    const safeLineIdx = Math.max(0, lineIdx);
    const targetLines = repeatStateRef.current.targetText.split("\n");
    const lines = baseInputValue.replace(/\r\n/g, "\n").split("\n");

    while (lines.length <= safeLineIdx) {
      lines.push("");
    }

    const hintPrefix = getLinePrefixHint(targetLines[safeLineIdx] ?? "")?.prefix;
    if (hintPrefix && lines[safeLineIdx].trim().length === 0) {
      lines[safeLineIdx] = hintPrefix;
    }

    const nextValue = lines.join("\n");
    const lineStartOffset = lines
      .slice(0, safeLineIdx)
      .reduce((sum, line) => sum + line.length + 1, 0);
    const nextCursor = lineStartOffset + (lines[safeLineIdx]?.length ?? 0);

    if (nextValue !== baseInputValue) {
      setUserInput(nextValue);
      lastInputRef.current = nextValue;
      setInputHistory((prev) => {
        const newHistory = prev.slice(0, historyIndex + 1);
        if (newHistory[newHistory.length - 1] !== nextValue) {
          newHistory.push(nextValue);
          if (newHistory.length > 50) newHistory.shift();
        }
        return newHistory;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 49));
    }

    setCurrentCursorLineIndex(safeLineIdx);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      if (nextValue !== baseInputValue) {
        textareaRef.current.value = nextValue;
      }
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleAutoHideSentenceCompletion = (
    completedSentenceIndex: number,
    inputValue: string,
    preferredUserLineIndex?: number
  ) => {
    if (completedSentenceIndex < 0) return;
    const now = Date.now();
    if (now - autoHideCompletionLockRef.current < 160) return;
    autoHideCompletionLockRef.current = now;

    const targetLines = repeatStateRef.current.targetText.split("\n");
    const normalizedLengths = targetLines.map((line) => normalizeLineForComparison(line).length);
    const nonEmptyIndices = normalizedLengths
      .map((len, idx) => (len > 0 ? idx : -1))
      .filter((idx) => idx >= 0);
    if (!nonEmptyIndices.includes(completedSentenceIndex)) return;

    const completedSet = new Set(autoHideCompletedLinesRef.current);
    if (completedSet.has(completedSentenceIndex)) return;
    const preCompletedSet = autoHidePreCompletedLinesRef.current;
    if (preCompletedSet.has(completedSentenceIndex)) return;

    const wasBlind = !autoHideViewedLinesRef.current.has(completedSentenceIndex);
    completedSet.add(completedSentenceIndex);
    autoHideCompletedLinesRef.current = completedSet;
    setAutoHideWrongLines((prev) => {
      if (!prev.has(completedSentenceIndex)) return prev;
      const next = new Set(prev);
      next.delete(completedSentenceIndex);
      return next;
    });
    const resolvedSet = new Set<number>(preCompletedSet);
    completedSet.forEach((idx) => resolvedSet.add(idx));

    setHiddenLines((prev) => {
      const next = new Set(prev);
      next.add(completedSentenceIndex);
      return next;
    });

    const totalChars = Math.max(
      1,
      nonEmptyIndices.reduce((sum, idx) => sum + Math.max(1, normalizedLengths[idx]), 0)
    );
    const lineChars = Math.max(1, normalizedLengths[completedSentenceIndex] || 1);
    const completionRatio = lineChars / totalChars;

    applySentencePracticeReward({
      typedLength: inputValue.length,
      completionRatio,
      wasBlind,
    });

    const isCycleComplete = nonEmptyIndices.every((idx) => resolvedSet.has(idx));
    if (isCycleComplete) {
      const nextSessionCount = sessionCompleteCount + 1;
      setSessionCompleteCount(nextSessionCount);
      if (nextSessionCount === 3) {
        setShowTestNudge(true);
      }

      const keepAutoHide = nextSessionCount >= 3;
      setHideMode(keepAutoHide ? "all" : "none");
      setHiddenLines(new Set());
      setAutoHideWrongLines(new Set());
      autoHideCompletedLinesRef.current = new Set();
      autoHideViewedLinesRef.current = new Set();
      autoHidePreCompletedLinesRef.current = new Set();

      const firstLineIdx = nonEmptyIndices[0] ?? 0;
      const firstLine = targetLines[firstLineIdx] ?? "";
      const seeded = keepAutoHide ? getPracticeInputSeed(firstLine) : getPracticeInputSeed();
      seedPracticeInput(seeded);
      return;
    }

    const unresolved = nonEmptyIndices.filter((idx) => !resolvedSet.has(idx));
    const nextLineIdx =
      unresolved.find((idx) => idx > completedSentenceIndex) ??
      unresolved.find((idx) => idx !== preferredUserLineIndex) ??
      unresolved[0] ??
      completedSentenceIndex;
    movePracticeCursorToLine(inputValue, nextLineIdx);
  };

  const handleAutoHideEnterSubmission = (
    inputValue: string,
    cursorLineIndex: number
  ) => {
    const targetLines = repeatStateRef.current.targetText.split("\n");
    const excluded = getAutoHideExcludedLineIndices();
    const unresolved = targetLines
      .map((line, idx) =>
        !excluded.has(idx) && normalizeLineForComparison(line).length > 0 ? idx : -1
      )
      .filter((idx) => idx >= 0);

    if (unresolved.length === 0) {
      return;
    }

    const clampedCursor = Math.max(0, cursorLineIndex);
    const skippedBeforeCursor = unresolved.filter((idx) => idx < clampedCursor);
    if (skippedBeforeCursor.length > 0) {
      setAutoHideWrongLines((prev) => {
        const next = new Set(prev);
        skippedBeforeCursor.forEach((idx) => next.add(idx));
        return next;
      });
    }

    const currentTargetIdx = unresolved.includes(clampedCursor)
      ? clampedCursor
      : unresolved.find((idx) => idx > clampedCursor) ?? unresolved[0];
    if (currentTargetIdx === undefined) return;

    const userLines = inputValue.split("\n");
    const userLine = userLines[currentTargetIdx] ?? userLines[clampedCursor] ?? "";
    const targetLine = targetLines[currentTargetIdx] ?? "";
    const isCompleted = isLinePairTypingEquivalentComplete(userLine, targetLine);

    if (isCompleted) {
      handleAutoHideSentenceCompletion(currentTargetIdx, inputValue, clampedCursor);
      return;
    }

    setAutoHideWrongLines((prev) => {
      const next = new Set(prev);
      next.add(currentTargetIdx);
      return next;
    });

    const nextUnresolved =
      unresolved.find((idx) => idx > currentTargetIdx) ?? unresolved[0] ?? currentTargetIdx;
    movePracticeCursorToLine(inputValue, nextUnresolved);
  };

  // 표 모드: 코어 함수들 (컨포넌트 레벨)
  const tableNorm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const tableBlankCells = tableData ? getBlankCells(tableData) : [];
  const tableActiveCellKey = tableBlankCells[tableActiveCellIdx] ?? null;
  const tableTargetCells = tableCheckedCells.size > 0
    ? tableBlankCells.filter(k => tableCheckedCells.has(k))
    : tableBlankCells;

  const clearTableInput = (focus: boolean = true) => {
    tableInputResettingRef.current = true;
    setIsTableComposing(false);
    setTableCellInput('');
    setTableCellSubmittedResult(null);

    const inputEl = tableCellInputRef.current;
    if (inputEl) {
      inputEl.blur();
      inputEl.value = '';
      inputEl.setSelectionRange(0, 0);
    }

    setTimeout(() => {
      const nextInputEl = tableCellInputRef.current;
      if (nextInputEl) {
        nextInputEl.value = '';
        if (focus) {
          nextInputEl.focus();
          nextInputEl.setSelectionRange(0, 0);
        }
      }
      tableInputResettingRef.current = false;
    }, 40);
  };

  const tableMoveToCell = (direction: 'next' | 'prev') => {
    if (!tableActiveCellKey || tableTargetCells.length === 0) return;
    const currentTargetIdx = tableTargetCells.indexOf(tableActiveCellKey);
    if (currentTargetIdx < 0) return;
    const nextTargetIdx = direction === 'next'
      ? (currentTargetIdx + 1) % tableTargetCells.length
      : (currentTargetIdx - 1 + tableTargetCells.length) % tableTargetCells.length;
    const nextKey = tableTargetCells[nextTargetIdx];
    const nextBlankIdx = tableBlankCells.indexOf(nextKey);
    setTableActiveCellIdx(nextBlankIdx >= 0 ? nextBlankIdx : 0);
    clearTableInput(true);
  };

  const tableMoveVertical = (direction: 'up' | 'down') => {
    if (!tableActiveCellKey || tableTargetCells.length === 0) return;
    const [rowRaw, colRaw] = tableActiveCellKey.split('-');
    const currentRow = Number(rowRaw);
    const currentCol = Number(colRaw);
    if (!Number.isFinite(currentRow) || !Number.isFinite(currentCol)) return;

    const candidates = tableTargetCells
      .map((key) => {
        const [rRaw, cRaw] = key.split('-');
        return { key, row: Number(rRaw), col: Number(cRaw) };
      })
      .filter((pos) => (direction === 'up' ? pos.row < currentRow : pos.row > currentRow))
      .sort((a, b) => {
        const da = Math.abs(a.row - currentRow);
        const db = Math.abs(b.row - currentRow);
        if (da !== db) return da - db;
        return Math.abs(a.col - currentCol) - Math.abs(b.col - currentCol);
      });

    const nextKey = candidates.length > 0 ? candidates[0].key : null;
    if (!nextKey) return;
    const nextBlankIdx = tableBlankCells.indexOf(nextKey);
    if (nextBlankIdx < 0) return;
    setTableActiveCellIdx(nextBlankIdx);
    clearTableInput(true);
  };

  const tableCorrectAnswerRef = useRef<((n?: number) => void) | null>(null);
  const isTableInputCorrect = (input: string, target: string) => {
    return isTypingEquivalentComplete(input, target);
  };

  const completeCurrentTableCell = (cellKey: string) => {
    setTableCellSubmittedResult('correct');
    setTableWrongCells(prev => {
      if (!prev.has(cellKey)) return prev;
      const next = new Set(prev);
      next.delete(cellKey);
      return next;
    });

    const nextCompleted = new Set(tableCompletedCells);
    nextCompleted.add(cellKey);
    setTableCompletedCells(nextCompleted);

    const allDone = tableTargetCells.every(k => nextCompleted.has(k));
    if (allDone) {
      setTimeout(() => {
        tableCorrectAnswerRef.current?.(tableTargetCells.length);
        setTimeout(() => {
          setTableCompletedCells(new Set());
          setTableActiveCellIdx(0);
          setTableWrongCells(new Set());
          clearTableInput(true);
        }, 320);
      }, 90);
    } else {
      setTimeout(() => {
        tableMoveToCell('next');
      }, 110);
    }
  };

  const tableSubmitCurrentCell = () => {
    if (!tableActiveCellKey || !tableData) return;
    const ri = parseInt(tableActiveCellKey.split('-')[0]);
    const ci = parseInt(tableActiveCellKey.split('-')[1]);
    const cell = tableData.cells[ri]?.[ci];
    if (!cell) return;
    const isCorrect = isTableInputCorrect(tableCellInput, cell.content);
    if (isCorrect) {
      completeCurrentTableCell(tableActiveCellKey);
    } else {
      // 입력 도중 즉시 오답 상태(빨간 셀)로 전환하지 않는다.
      setTableCellSubmittedResult(tableCellInput.trim().length > 0 ? 'typing' : null);
    }
  };

  const handleTableInputChange = (value: string) => {
    if (tableInputResettingRef.current) return;
    setTableCellInput(value);
    if (!startTime) setStartTime(Date.now());
    setLastInputTime(Date.now());
    setIsActive(true);
    
    // 입력 중에는 자동 셀 이동/초기화를 하지 않고 상태만 표시한다.
    if (tableActiveCellKey && tableData) {
      const ri = parseInt(tableActiveCellKey.split('-')[0]);
      const ci = parseInt(tableActiveCellKey.split('-')[1]);
      const cell = tableData.cells[ri]?.[ci];
      if (cell) {
        const allComplete = isTableInputCorrect(value, cell.content);
        setTableCellSubmittedResult(
          value.trim().length === 0 ? null : allComplete ? 'correct' : 'typing'
        );
      }
    } else {
      setTableCellSubmittedResult(value.trim().length > 0 ? 'typing' : null);
    }
  };

  const handleTableKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isTableComposing || (e.nativeEvent as any)?.isComposing) return;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      tableMoveVertical(e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if ((e.key === 'Tab' || e.code === 'Tab') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleHideAll();
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (question) {
        const testPath = buildTestPath();
        if (testPath) setLocation(testPath);
      }
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      tableSubmitCurrentCell();
    }
  };

  const getTableCompletionRatio = (): number => {
    if (!isTableQuestion || !tableData || tableTargetCells.length === 0) return 0;

    const getCellTargetChars = (key: string): string[] => {
      const [r, c] = key.split("-").map(Number);
      const content = tableData.cells[r]?.[c]?.content ?? "";
      return splitGraphemes(content.replace(/\s+/g, ""));
    };

    let totalChars = 0;
    for (const key of tableTargetCells) {
      totalChars += getCellTargetChars(key).length;
    }
    if (totalChars <= 0) return 0;

    let completedChars = 0;
    for (const key of tableTargetCells) {
      if (!tableCompletedCells.has(key)) continue;
      completedChars += getCellTargetChars(key).length;
    }

    if (
      tableActiveCellKey &&
      tableTargetCells.includes(tableActiveCellKey) &&
      !tableCompletedCells.has(tableActiveCellKey) &&
      tableCellInput.trim().length > 0
    ) {
      const targetChars = getCellTargetChars(tableActiveCellKey);
      const userChars = splitGraphemes(tableCellInput.replace(/\s+/g, ""));
      let matched = 0;

      for (let i = 0; i < userChars.length && i < targetChars.length; i++) {
        const match = isPartialMatch(userChars[i], targetChars[i], targetChars[i + 1]);
        if (match === "complete" || match === "partial_complete") {
          matched = i + 1;
        } else if (match === "partial") {
          break;
        } else {
          break;
        }
      }

      completedChars += matched;
    }

    return Math.max(0, Math.min(1, completedChars / totalChars));
  };

  const savePracticeSession = async () => {
    if (isDemo || !question || !isTableQuestion || !tableData || hasBeenSaved.current) return;

    const rawRatio = getTableCompletionRatio();
    const ratio = Math.max(0, Math.min(0.98, rawRatio));
    if (ratio < 0.08) return;
    if (ratio <= tablePartialSavedRatioRef.current + 0.04) return;

    const totalChars = Math.max(
      1,
      tableTargetCells.reduce((sum, key) => {
        const [r, c] = key.split("-").map(Number);
        const content = tableData.cells[r]?.[c]?.content ?? "";
        return sum + splitGraphemes(content.replace(/\s+/g, "")).length;
      }, 0)
    );
    const nowMs = Date.now();
    const elapsedSec = startTime
      ? Math.max(1, Math.round((nowMs - startTime) / 1000))
      : Math.max(1, elapsedTime);
    const duration = Math.max(1, Math.round(elapsedSec * Math.max(0.25, ratio)));
    const typedChars = Math.max(1, Math.round(Math.max(totalChars, 20) * Math.max(0.1, ratio)));
    const typingSpeed = Math.max(1, Math.round(typedChars / (duration / 60)));
    const accuracy = Math.max(1, Math.min(99, Math.round(ratio * 100)));
    const errorCount = Math.max(0, Math.round((1 - ratio) * totalChars));

    try {
      await createSession.mutateAsync({
        questionId: question.id,
        duration,
        typingSpeed,
        accuracy,
        errorCount,
      });
      hasBeenSaved.current = true;
      tablePartialSavedRatioRef.current = ratio;
      await Promise.all([
        utils.confidence.getByQuestion.invalidate({ questionId: question.id }),
        utils.confidence.getHistory.invalidate({ questionId: question.id }),
        utils.practice.countByQuestion.invalidate({ questionId: question.id }),
      ]);
    } catch (error) {
      console.error("표 부분 연습 기록 저장 실패:", error);
    }
  };

  useEffect(() => {
    savePracticeSessionRef.current = savePracticeSession;
  }, [savePracticeSession]);

  // Auto-start on mount
  useEffect(() => {
    if (question && !startTime) {
      const now = Date.now();
      setStartTime(now);
      setCurrentContinuousStartAt(now);
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(0, 0);
        textareaRef.current.focus();
      }
    }
  }, [question]);

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isActive && startTime) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isActive, startTime]);

   // Inactivity detection with alert
  useEffect(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (inactiveAlertTimerRef.current) clearTimeout(inactiveAlertTimerRef.current);

    if (isActive) {
      inactiveAlertTimerRef.current = setTimeout(() => {
        setShowInactiveAlert(true);
      }, 60000);
      
      inactivityTimerRef.current = setTimeout(() => {
        setIsActive(false);
        setCurrentContinuousStartAt(null);
      }, 60000);
    }

    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      if (inactiveAlertTimerRef.current) clearTimeout(inactiveAlertTimerRef.current);
    };
  }, [lastInputTime, isActive]);;

  // Global keyboard event listener for ESC and Ctrl+Enter

  // setRevealedLabels와 imageLabels.length를 항상 최신 ref에 저장
  useEffect(() => {
    setRevealedLabelsRef.current = setRevealedLabels;
  }, [setRevealedLabels]);
  
  useEffect(() => {
    imageLabelsLengthRef.current = imageLabels.length;
  }, [imageLabels]);

  useEffect(() => {
    const isTabKey = (e: KeyboardEvent) =>
      e.key === "Tab" || e.code === "Tab" || (e as KeyboardEvent & { keyCode?: number }).keyCode === 9;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isTabKey(e) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const targetEl = e.target as HTMLElement | null;
        const handledByLocalInput = !!targetEl?.closest(
          'textarea[data-practice-input="main"], textarea[data-practice-input="table"]'
        );
        if (handledByLocalInput) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        toggleHideAll();
        return;
      }

      if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (question) {
          e.preventDefault();
          const testPath = buildTestPath();
          if (testPath) setLocation(testPath);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        handleGoBack();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [buildTestPath, imageLabels.length, isImageQuestion, question, setLocation, toggleHideAll]);

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false);
    // 초기화 진행 중이면 compositionend 무시 (잔류 글자 방지)
    if (isResettingRef.current) {
      e.currentTarget.value = '';
      return;
    }
    // 조합 완료 후 입력값 처리
    const newValue = e.currentTarget.value;
    const cursorPos = e.currentTarget.selectionStart ?? newValue.length;
    const lineIndex = newValue.substring(0, cursorPos).split('\n').length - 1;
    setCurrentCursorLineIndex(Math.max(0, lineIndex));
    setUserInput(newValue);
    setLastInputTime(Date.now());
    lastInputRef.current = newValue;
    
    // 히스토리에 현재 입력 상태 기록
    setInputHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      if (newHistory[newHistory.length - 1] !== newValue) {
        newHistory.push(newValue);
        if (newHistory.length > 50) {
          newHistory.shift();
        }
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));

    // Resume if was inactive
    if (!isActive) {
      const now = Date.now();
      setIsActive(true);
      setCurrentContinuousStartAt(now);
      if (!startTime) {
        setStartTime(now);
      }
    }
    
    // Hide inactive alert
    if (showInactiveAlert) {
      setShowInactiveAlert(false);
    }

    // Auto-complete when normalized text matches
    const normalized = normalizeTextForTypingCompare(newValue);
    
    // 반복 연습 모드: ref를 통해 항상 최신 상태 사용 (stale closure 방지)
    const { isRepeatMode: rm, repeatLinesSorted: rls, repeatCurrentIdx: rci, targetText: tt } = repeatStateRef.current;
    if (rm && rls.length > 0) {
      const lineIdx = rls[rci % rls.length];
      const currentLineText = tt.split('\n')[lineIdx] || '';
      const normalizedRepeatTarget = normalizeTextForTypingCompare(currentLineText);
      if (normalizedRepeatTarget.length > 0 && normalized === normalizedRepeatTarget) {
        const nextIdx = rci + 1;
        const isLastLine = nextIdx >= rls.length;
        setRepeatCount(prev => prev + 1);
        setRepeatTotalCount(prev => prev + 1);
        // 선택된 문장 전체 사이클 완료 시 practiceCount 증가 + DB 저장
        if (isLastLine && question && !isDemo) {
          setPracticeCount(prev => prev + 1);
          createSession.mutate({
            questionId: question.id,
            duration: Math.max(elapsedTime, 1),
            typingSpeed: 0,
            accuracy: 100,
            errorCount: 0,
          });
        } else if (isLastLine && isDemo && question) {
          setPracticeCount(prev => prev + 1);
          const storageKey = `demo_practice_count_${question.id}`;
          const currentCount = parseInt(localStorage.getItem(storageKey) || '0', 10);
          localStorage.setItem(storageKey, String(currentCount + 1));
        }
        const newIdx = isLastLine ? 0 : nextIdx;
        setRepeatCurrentIdx(newIdx);
        repeatStateRef.current = { ...repeatStateRef.current, repeatCurrentIdx: newIdx };
        // 입력창 즉시 초기화 (auto-numbering 문제는 1. 재시드)
        const nextRepeatLineIdx = rls[newIdx] ?? lineIdx;
        const nextRepeatLineText = tt.split('\n')[nextRepeatLineIdx] || "";
        const seeded = getPracticeInputSeed(nextRepeatLineText);
        setUserInput(seeded);
        lastInputRef.current = seeded;
        if (textareaRef.current) {
          textareaRef.current.value = seeded;
          textareaRef.current.setSelectionRange(seeded.length, seeded.length);
        }
        return;
      }
      return;
    }
    
    // 텍스트 모드: 정답 자동 감지 (isPartialMatch 기반)
    if (!isTableQuestion && !isImageQuestion) {
      const currentTargetText = repeatStateRef.current.targetText;
      const targetLines = currentTargetText.split('\n');
      const userLines = newValue.split('\n');
      let allLinesComplete = true;
      for (let li = 0; li < targetLines.length; li++) {
        const targetLine = targetLines[li] ?? '';
        const userLine = userLines[li] ?? '';
        if (normalizeLineForComparison(targetLine).length === 0) continue;
        if (!isLinePairNormalizedComplete(userLine, targetLine)) {
          allLinesComplete = false;
          break;
        }
      }
      if (allLinesComplete && targetLines.some(l => normalizeLineForComparison(l).length > 0)) {
        handleCorrectAnswer(newValue.length);
        return;
      }
      // fallback: 줄 경계와 무관하게 공백 무시 완주도 인정
      if (isTypingEquivalentCompleteByLineFlow(newValue, currentTargetText)) {
        handleCorrectAnswer(newValue.length);
        return;
      }
    }

    // 듷포트 실시간 이동: 사용자 입력의 현재 줄 번호에 따라 스크롤
    if (question?.autoNumbering === 1 && answerDisplayRef.current) {
      const currentLineIndex = newValue.split('\n').length - 1;
      const lineHeight = 28; // 대략적인 줄 높이 (px)
      const scrollTarget = currentLineIndex * lineHeight;
      answerDisplayRef.current.scrollTo({
        top: scrollTarget,
        behavior: 'smooth'
      });
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const cursorPos = textarea.selectionStart;
    const value = textarea.value;
    
    // 현재 커서 위치의 줄 인덱스 계산
    const lineIndex = value.substring(0, cursorPos).split('\n').length - 1;
    setCurrentCursorLineIndex(lineIndex);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    // 현재 커서 위치의 줄 인덱스 계산
    const lineIndex = newValue.substring(0, cursorPos).split('\n').length - 1;
    setCurrentCursorLineIndex(lineIndex);
    
    setUserInput(newValue);
    setLastInputTime(Date.now());
    lastInputRef.current = newValue;

    // 히스토리에 현재 입력 상태 기록
    setInputHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      if (newHistory[newHistory.length - 1] !== newValue) {
        newHistory.push(newValue);
        if (newHistory.length > 50) {
          newHistory.shift();
        }
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));

    // Resume if was inactive
    if (!isActive) {
      const now = Date.now();
      setIsActive(true);
      setCurrentContinuousStartAt(now);
      if (!startTime) {
        setStartTime(now);
      }
    }
    
    // Hide inactive alert
    if (showInactiveAlert) {
      setShowInactiveAlert(false);
    }

    // Auto-complete when normalized text matches
    const normalized = normalizeTextForTypingCompare(newValue);
    
    // 반복 연습 모드: ref를 통해 항상 최신 상태 사용 (stale closure 방지)
    const { isRepeatMode: rm2, repeatLinesSorted: rls2, repeatCurrentIdx: rci2, targetText: tt2 } = repeatStateRef.current;
    if (rm2 && rls2.length > 0) {
      const lineIdx2 = rls2[rci2 % rls2.length];
      const currentLineText2 = tt2.split('\n')[lineIdx2] || '';
      const normalizedRepeatTarget = normalizeTextForTypingCompare(currentLineText2);
      if (normalizedRepeatTarget.length > 0 && normalized === normalizedRepeatTarget) {
        const nextIdx2 = rci2 + 1;
        const isLastLine2 = nextIdx2 >= rls2.length;
        setRepeatCount(prev => prev + 1);
        setRepeatTotalCount(prev => prev + 1);
        // 선택된 문장 전체 사이클 완료 시 practiceCount 증가 + DB 저장
        if (isLastLine2 && question && !isDemo) {
          setPracticeCount(prev => prev + 1);
          createSession.mutate({
            questionId: question.id,
            duration: Math.max(elapsedTime, 1),
            typingSpeed: 0,
            accuracy: 100,
            errorCount: 0,
          });
        } else if (isLastLine2 && isDemo && question) {
          setPracticeCount(prev => prev + 1);
          const storageKey = `demo_practice_count_${question.id}`;
          const currentCount = parseInt(localStorage.getItem(storageKey) || '0', 10);
          localStorage.setItem(storageKey, String(currentCount + 1));
        }
        const newIdx2 = isLastLine2 ? 0 : nextIdx2;
        setRepeatCurrentIdx(newIdx2);
        repeatStateRef.current = { ...repeatStateRef.current, repeatCurrentIdx: newIdx2 };
        // 입력창 즉시 초기화 (auto-numbering 문제는 1. 재시드)
        const nextRepeatLineIdx2 = rls2[newIdx2] ?? lineIdx2;
        const nextRepeatLineText2 = tt2.split('\n')[nextRepeatLineIdx2] || "";
        const seeded = getPracticeInputSeed(nextRepeatLineText2);
        setUserInput(seeded);
        lastInputRef.current = seeded;
        if (textareaRef.current) {
          textareaRef.current.value = seeded;
          textareaRef.current.setSelectionRange(seeded.length, seeded.length);
        }
        return;
      }
      return;
    }
     // 텍스트 모드: 정답 자동 감지 (isPartialMatch 기반)
    if (!isTableQuestion && !isImageQuestion) {
      const currentTargetText = repeatStateRef.current.targetText;
      const targetLines = currentTargetText.split('\n');
      const userLines = newValue.split('\n');
      let allLinesComplete = true;
      for (let li = 0; li < targetLines.length; li++) {
        const targetLine = targetLines[li] ?? '';
        const userLine = userLines[li] ?? '';
        if (normalizeLineForComparison(targetLine).length === 0) continue;
        if (!isLinePairNormalizedComplete(userLine, targetLine)) {
          allLinesComplete = false;
          break;
        }
      }
      if (allLinesComplete && targetLines.some(l => normalizeLineForComparison(l).length > 0)) {
        handleCorrectAnswer(newValue.length);
        return;
      }
      // fallback: 줄 경계와 무관하게 공백 무시 완주도 인정
      if (isTypingEquivalentCompleteByLineFlow(newValue, currentTargetText)) {
        handleCorrectAnswer(newValue.length);
        return;
      }
    }

    // 듷포트 실시간 이동: 사용자 입력의 현재 줄 번호에 따라 스크롤
    if (question?.autoNumbering === 1 && answerDisplayRef.current) {
      const currentLineIndex = newValue.split('\n').length - 1;
      const lineHeight = 28; // 대략적인 줄 높이 (px)
      const scrollTarget = currentLineIndex * lineHeight;
      answerDisplayRef.current.scrollTo({
        top: scrollTarget,
        behavior: 'smooth'
      });
    }
  };

  // 띄어쓰기 입력 시 강제 리렌더링을 위한 트리거
  const renderTrigger = useMemo(() => {
    return userInput[userInput.length - 1] === ' ' ? Date.now() : null;
  }, [userInput]);

  const practiceCountDisplay = useMemo(() => {
    return practiceCount;
  }, [practiceCount]);
  const formatPracticeDateTime = useCallback((value: number | Date | string | null | undefined) => {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }, []);
  const latestCompletedPracticeAt = useMemo(() => {
    if (!practiceSessionsData || practiceSessionsData.length === 0) return null;
    let latestMs = -1;
    for (const session of practiceSessionsData as Array<{ completedAt?: Date | string | null }>) {
      const value = session?.completedAt;
      if (!value) continue;
      const ms = new Date(value).getTime();
      if (!Number.isNaN(ms) && ms > latestMs) latestMs = ms;
    }
    return latestMs > 0 ? latestMs : null;
  }, [practiceSessionsData]);
  const currentPracticeTitle = useMemo(() => {
    if (isActive && currentContinuousStartAt) {
      const at = formatPracticeDateTime(currentContinuousStartAt);
      if (at) return `${isRandomNavMode ? "랜덤" : "연속"} 진행 시작: ${at}`;
    }
    return `현재 진행 중인 ${isRandomNavMode ? "랜덤" : "연속"} 연습 세션이 없습니다.`;
  }, [isActive, currentContinuousStartAt, formatPracticeDateTime, isRandomNavMode]);
  const cumulativePracticeTitle = useMemo(() => {
    const at = formatPracticeDateTime(latestCompletedPracticeAt);
    if (at) return `가장 최근 연습 완료: ${at}`;
    return "이전 연습 기록이 없습니다.";
  }, [latestCompletedPracticeAt, formatPracticeDateTime]);

  // 학습 제안 로직: 연습 횟수에 따라 시험 추천
  const totalPracticeCount = (practiceCountData?.count || 0) + practiceCount;
  const studySuggestion = useMemo(() => {
    const conf = confidenceData?.displayScore ?? 0;
    // sessionCompleteCount: 현재 세션에서 완료한 연습 횟수 (페이지 진입 후 새로 연습한 횟수)
    const session = sessionCompleteCount;
    const total = totalPracticeCount;
    
    // 현재 세션에서 3회 미만 연습: 배너 표시 안 함
    if (session < 3) return null;
    
    // 안정도 80점 이상 + 세션 3회 이상 연습: 완벽 암기
    if (conf >= 80) return { type: 'mastered' as const, message: '완벽하게 암기했어요. 시험으로 확인해볼까요?' };
    
    // 세션 3회 달성: 안정도 무관하게 백지시험 제안
    if (session === 3) {
      return { type: 'test_ready' as const, message: `3번 연습했어요! 이제 백지시험으로 확인해보세요.` };
    }
    
    // 세션 3회 이상 + 안정도 50점 이상: 시험 추천
    if (conf >= 50) {
      const messages = [
        `${total}번 돌렸어요. 백지복습 한 번 가볼까요?`,
        `지금이 시험 타이밍이에요.`,
        `손에 익었어요. 안 보고 한 번 확인해볼까요?`,
      ];
      const msg = messages[(session - 3) % messages.length];
      return { type: 'test_ready' as const, message: msg };
    }
    
    // 세션 5회 이상 + 안정도 낙음: 답 가리고 연습 추천
    if (session >= 5 && conf < 50) return { type: 'hide_practice' as const, message: '슬슬 안 보고 해볼 차례' };
    
    // 세션 3회 이상: 답 가리기 유도
    if (session >= 3 && session < 5) return { type: 'hide_practice' as const, message: `${session}번 했으면… 이제 눈 감고 가야지 😏` };
    
    return null;
  }, [sessionCompleteCount, totalPracticeCount, confidenceData?.displayScore]);

  const getCurrentNotepadLineRange = useCallback((value: string, cursor: number) => {
    const safeCursor = Math.max(0, Math.min(cursor, value.length));
    const lineStart = value.lastIndexOf("\n", Math.max(0, safeCursor - 1)) + 1;
    const nextNewline = value.indexOf("\n", safeCursor);
    const lineEnd = nextNewline === -1 ? value.length : nextNewline;
    return { lineStart, lineEnd };
  }, []);

  const findMatchingImageLabelIndex = useCallback((lineText: string) => {
    const sanitizedLine = lineText
      .replace(/^\s*\d{1,3}\s*[.)]\s*/, "")
      .replace(/^\s*(?:[-*•·●○◦▪▫▸▹►▶‣⁃※])\s*/, "");
    const normalizedLine = normalizeLineForComparison(sanitizedLine);
    if (!normalizedLine) return null;
    const used = imageMatchedLabelRef.current;
    for (const entry of imageAnswerEntries) {
      if (used.has(entry.index)) continue;
      if (
        isLinePairTypingEquivalentComplete(sanitizedLine, entry.answer) ||
        isLinePairTypingEquivalentComplete(lineText, entry.answer)
      ) {
        return entry.index;
      }
    }
    return null;
  }, [imageAnswerEntries, isLinePairTypingEquivalentComplete, normalizeLineForComparison]);

  const handleImagePracticeKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isImageQuestion) return;

    if ((e.key === "Tab" || e.code === "Tab") && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleHideAll();
      return;
    }

    if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (question) {
        const testPath = buildTestPath();
        if (testPath) setLocation(testPath);
      }
      return;
    }

    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
      return;
    }
    if ((e.nativeEvent as any).isComposing || isComposing) return;

    const textarea = e.currentTarget;
    const value = textarea.value;
    const cursor = textarea.selectionStart ?? value.length;
    const { lineStart, lineEnd } = getCurrentNotepadLineRange(value, cursor);
    const currentLineRaw = value.slice(lineStart, lineEnd);
    const matchedLabelIndex = findMatchingImageLabelIndex(currentLineRaw);
    if (matchedLabelIndex === null) return;

    e.preventDefault();
    e.stopPropagation();

    const nextValue = `${value.slice(0, cursor)}\n${value.slice(cursor)}`;
    handleImagePracticeNoteChange(nextValue);
    setTimeout(() => {
      if (!notepadRef.current) return;
      const nextCursor = cursor + 1;
      notepadRef.current.focus();
      notepadRef.current.setSelectionRange(nextCursor, nextCursor);
    }, 0);

    const nextMatched = new Set(imageMatchedLabelRef.current);
    nextMatched.add(matchedLabelIndex);
    imageMatchedLabelRef.current = nextMatched;
    setImageMatchedLabelIndices(nextMatched);

    const nextRevealed = new Set(revealedLabelsRef.current);
    const wasBlind = !nextRevealed.has(matchedLabelIndex);
    nextRevealed.add(matchedLabelIndex);
    revealedLabelsRef.current = nextRevealed;
    setRevealedLabels(nextRevealed);

    const totalMeaningfulAnswers = Math.max(1, imageAnswerEntries.length);
    applySentencePracticeReward({
      typedLength: normalizeLineForComparison(currentLineRaw).length,
      completionRatio: 1 / totalMeaningfulAnswers,
      wasBlind,
    });

    if (nextMatched.size >= totalMeaningfulAnswers) {
      // 한 사이클 완주 시 다음 회독을 위해 라벨 단위 누적만 초기화
      imageMatchedLabelRef.current = new Set();
      setImageMatchedLabelIndices(new Set());
    }
  }, [
    applySentencePracticeReward,
    buildTestPath,
    findMatchingImageLabelIndex,
    getCurrentNotepadLineRange,
    handleImagePracticeNoteChange,
    imageAnswerEntries.length,
    isComposing,
    isImageQuestion,
    normalizeLineForComparison,
    question,
    setLocation,
    toggleHideAll,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const keyLower = e.key.toLowerCase();
    const hasPrimaryModifier = e.ctrlKey || e.metaKey;
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

    const pushHistoryValue = (nextValue: string) => {
      const newHistory = inputHistory.slice(0, historyIndex + 1);
      if (newHistory[newHistory.length - 1] !== nextValue) {
        newHistory.push(nextValue);
        if (newHistory.length > 50) {
          newHistory.shift();
        }
      }
      setInputHistory(newHistory);
      setHistoryIndex(Math.max(0, newHistory.length - 1));
    };

    if ((e.key === "Tab" || e.code === "Tab") && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleHideAll();
      return;
    }

    // Cmd/Ctrl+Z: Undo
    if (hasPrimaryModifier && !e.shiftKey && !e.altKey && keyLower === "z") {
      e.preventDefault();
      e.stopPropagation();
      
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setUserInput(inputHistory[newIndex]);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(inputHistory[newIndex].length, inputHistory[newIndex].length);
          }
        }, 0);
      }
      return;
    }
    
    // Redo:
    // - Mac: Cmd+Shift+Z
    // - Windows/Linux: Ctrl+Shift+Z 또는 Ctrl+Y
    const isRedoShortcut =
      (hasPrimaryModifier && e.shiftKey && !e.altKey && keyLower === "z") ||
      (!isMac && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && keyLower === "y");
    if (isRedoShortcut) {
      e.preventDefault();
      e.stopPropagation();
      
      if (historyIndex < inputHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setUserInput(inputHistory[newIndex]);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(inputHistory[newIndex].length, inputHistory[newIndex].length);
          }
        }, 0);
      }
      return;
    }
    
    // Shift+Enter: 시험 모드 진입
    if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (question) {
        const testPath = buildTestPath();
        if (testPath) setLocation(testPath);
      }
      return;
    }

    // Enter: autoNumbering 문제에서는 다음 번호 자동 삽입
    if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (
        !isTableQuestion &&
        !isImageQuestion &&
        hideMode === "all" &&
        !(e.nativeEvent as any).isComposing &&
        !isComposing
      ) {
        e.preventDefault();
        e.stopPropagation();
        const textarea = e.currentTarget;
        const selectionStart = textarea.selectionStart ?? textarea.value.length;
        const cursorLineIndex = textarea.value.slice(0, selectionStart).split("\n").length - 1;
        handleAutoHideEnterSubmission(textarea.value, cursorLineIndex);
        return;
      }

      const isTextAutoNumbering =
        !isTableQuestion &&
        !isImageQuestion &&
        question?.autoNumbering === 1;

      if (
        isTextAutoNumbering &&
        !(e.nativeEvent as any).isComposing &&
        !isComposing
      ) {
        e.preventDefault();
        e.stopPropagation();

        const textarea = e.currentTarget;
        const selectionStart = textarea.selectionStart ?? 0;
        const selectionEnd = textarea.selectionEnd ?? selectionStart;
        const rawValue = textarea.value;
        const cursorLineIndex = rawValue.slice(0, selectionStart).split('\n').length - 1;
        const targetLines = targetText.split('\n');
        const templateNextLine = targetLines[Math.min(cursorLineIndex + 1, Math.max(0, targetLines.length - 1))] ?? "";
        const templateForcedPrefix =
          getForcedPrefixByTemplateProgress(rawValue, selectionStart, targetText) ??
          getLinePrefixHint(templateNextLine)?.prefix;
        const autoNumberingOptions = {
          preserveEmptyListLine: true,
          ...(typeof templateForcedPrefix === "string" ? { forcedPrefix: templateForcedPrefix } : {}),
        };

        const { nextValue, nextCursor } = buildNextAutoNumberingValue(
          rawValue,
          selectionStart,
          selectionEnd,
          autoNumberingOptions
        );

        setUserInput(nextValue);
        setLastInputTime(Date.now());
        lastInputRef.current = nextValue;

        const lineIndex = nextValue.slice(0, nextCursor).split('\n').length - 1;
        setCurrentCursorLineIndex(Math.max(0, lineIndex));

        setInputHistory(prev => {
          const newHistory = prev.slice(0, historyIndex + 1);
          if (newHistory[newHistory.length - 1] !== nextValue) {
            newHistory.push(nextValue);
            if (newHistory.length > 50) {
              newHistory.shift();
            }
          }
          return newHistory;
        });
        setHistoryIndex(prev => Math.min(prev + 1, 49));

        if (!isActive) {
          const now = Date.now();
          setIsActive(true);
          setCurrentContinuousStartAt(now);
          if (!startTime) {
            setStartTime(now);
          }
        }

        if (showInactiveAlert) {
          setShowInactiveAlert(false);
        }

        if (answerDisplayRef.current) {
          const lineHeight = 28;
          answerDisplayRef.current.scrollTo({
            top: Math.max(0, lineIndex) * lineHeight,
            behavior: 'smooth'
          });
        }

        requestAnimationFrame(() => {
          textarea.value = nextValue;
          textarea.setSelectionRange(nextCursor, nextCursor);
        });
        return;
      }

      // 기본 Enter 동작 허용 (줄바꿈)
      return;
    }
    
    // Shift+Backspace: 현재 커서 줄 삭제 (Mac에서는 Option+Shift+Backspace도 동작)
    if (e.key === "Backspace" && e.shiftKey && !hasPrimaryModifier) {
      e.preventDefault();
      e.stopPropagation();
      
      const textarea = e.currentTarget;
      const composing = e.nativeEvent.isComposing || isComposing;

      const applyDeleteLine = () => {
        const currentValue = textarea.value;
        const selectionStart = textarea.selectionStart ?? currentValue.length;
        const selectionEnd = textarea.selectionEnd ?? selectionStart;
        const { nextValue, nextCursor } = deleteCurrentLineAtCursor(
          currentValue,
          selectionStart,
          selectionEnd
        );

        setUserInput(nextValue);
        setLastInputTime(Date.now());
        lastInputRef.current = nextValue;
        pushHistoryValue(nextValue);

        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(nextCursor, nextCursor);
        });
      };

      if (composing) {
        textarea.blur();
        setTimeout(applyDeleteLine, 10);
      } else {
        applyDeleteLine();
      }
      return;
    }
    
    // Alt/Option+Backspace: 현재 커서 기준 이전 단어 삭제
    if (e.key === "Backspace" && e.altKey && !e.shiftKey && !hasPrimaryModifier) {
      e.preventDefault();
      e.stopPropagation();
      
      const textarea = e.currentTarget;
      const composing = e.nativeEvent.isComposing || isComposing;

      const applyDeleteWord = () => {
        const currentValue = textarea.value;
        const selectionStart = textarea.selectionStart ?? currentValue.length;
        const selectionEnd = textarea.selectionEnd ?? selectionStart;
        const { nextValue, nextCursor } = deleteWordBeforeCursor(
          currentValue,
          selectionStart,
          selectionEnd
        );

        setUserInput(nextValue);
        setLastInputTime(Date.now());
        lastInputRef.current = nextValue;
        pushHistoryValue(nextValue);

        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(nextCursor, nextCursor);
        });
      };

      if (composing) {
        textarea.blur();
        setTimeout(applyDeleteWord, 10);
      } else {
        applyDeleteWord();
      }
      return;
    }
  };



  const handleComplete = async () => {
    if (!question || elapsedTime === 0) return;

    // handleCorrectAnswer를 호출하여 채점 + 입력 초기화 + 애니메이션 처리
    handleCorrectAnswer(userInput.length);

    // 세션 완료 카운트 증가, 3회 이후 백지시험 유도
    setSessionCompleteCount(prev => {
      const next = prev + 1;
      if (next >= 3) {
        setShowTestNudge(true);
      }
      return next;
    });
  };

  // 돌아가기 버튼 클릭 핸들러
  const handleGoBack = async () => {
    const basePath = `/questions/${question?.subjectId || 1}`;
    const targetPath =
      isDemoLinkedMode && demoLinkedSubjectId
        ? `${basePath}?demo=1&demoSubjectId=${demoLinkedSubjectId}`
        : basePath;

    if (isDemo) {
      // 데모 모드: 현재 연습만 초기화하고 돌아가기 (누적 연습은 이미 실시간으로 저장됨)
      if (!isLeaving) {
        setIsLeaving(true);
        setTimeout(() => setLocation(targetPath), 180);
      }
      return;
    }
    
    if (!hasBeenSaved.current) {
      try {
        await savePracticeSession();
      } catch (error) {
        console.error('연습 기록 저장 실패:', error);
      }
    }
    if (!isLeaving) {
      setIsLeaving(true);
      setTimeout(() => setLocation(targetPath), 180);
    }
  };

  // 정답 일치 시 글자 색상 fade out 및 입력 천천히 초기화
  const handleCorrectAnswer = (currentInputLength?: number) => {
    if (isResettingRef.current || isFadingOut) return;
    setPracticeCount(prev => prev + 1);
    const nextSessionCount = sessionCompleteCount + 1;
    const shouldKeepAutoHide = nextSessionCount >= 3;
    autoHideCompletedLinesRef.current = new Set();
    autoHideViewedLinesRef.current = new Set();
    autoHidePreCompletedLinesRef.current = new Set();
    autoHideCompletionLockRef.current = 0;
    setAutoHideWrongLines(new Set());
    setSessionCompleteCount(nextSessionCount);
    if (nextSessionCount === 3) {
      setShowTestNudge(true);
    }
    if (shouldKeepAutoHide) {
      setHideMode("all");
      setHiddenLines(new Set());
    }
    
    // 페이드아웃 애니메이션을 즉시 시작 (네트워크 요청 기다리지 않음)
    // 0.15초 delay 후 글자 색상 fade out 시작
    setTimeout(() => {
      setIsFadingOut(true);
    }, 150);
    // 0.4초 후 입력창 초기화 및 fade out 해제 + 증감 애니메이션 즉시 표시
    setTimeout(() => {
      isResettingRef.current = true; // 초기화 시작 플래그
      setIsComposing(false); // 한글 조합 강제 종료
      const seeded = getPracticeInputSeed();
      setUserInput(seeded);
      lastInputRef.current = seeded;
      setInputHistory([seeded]);
      setStartTime(null);
      setCurrentContinuousStartAt(null);
      if (textareaRef.current) {
        // blur → value 초기화 → focus: 조합 중인 IME 세션을 완전히 종료
        textareaRef.current.blur();
        textareaRef.current.value = seeded;
        textareaRef.current.setSelectionRange(seeded.length, seeded.length);
      }
      setCurrentCursorLineIndex(0); // 커서 줄 인덱스 첫 줄로 리셋
      setTimeout(() => {
        setIsFadingOut(false);
        isResettingRef.current = false; // 초기화 완료
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(seeded.length, seeded.length); // 커서를 입력 끝으로
        }
      }, 50);
    }, 400);
    
    // 점수/애니메이션은 즉시 반영하고, 서버 동기화는 백그라운드로 처리
    if (question && !isDemo) {
      const baselineScore =
        confidenceScoreForAnimationRef.current ??
        Math.round(confidenceData?.displayScore ?? 0);
      const minutesUntilExam = (confidenceData as any)?.examDatePrediction?.minutesUntilExam;
      const daysUntilExam = (confidenceData as any)?.examDatePrediction?.daysUntilExam;
      const estimatedHoursUntilExam =
        typeof minutesUntilExam === "number"
          ? minutesUntilExam / 60
          : typeof daysUntilExam === "number"
            ? daysUntilExam * 24
            : null;

      const estimatedDelta = estimatePracticeConfidenceDelta({
        currentScore: baselineScore,
        sessionPracticeCount: sessionCompleteCount + 1,
        totalPracticeCount: (practiceCountData?.count || 0) + practiceCount + 1,
        hoursUntilExam: estimatedHoursUntilExam,
      });

      const optimisticScore = Math.max(0, Math.min(100, baselineScore + estimatedDelta));
      confidenceScoreForAnimationRef.current = optimisticScore;
      setOptimisticDisplayScore(optimisticScore);
      appendOptimisticConfidenceHistoryPoint({
        eventType: "practice",
        score: optimisticScore,
        practiceSessionCount: (practiceCountData?.count || 0) + practiceCount + 1,
        practiceDelta: estimatedDelta,
      });
      setShowDamageNumber(false);
      requestAnimationFrame(() => {
        setDamageValue(estimatedDelta);
        setShowDamageNumber(true);
      });

      (async () => {
        try {
          const timeInMinutes = elapsedTime / 60;
          const speed = timeInMinutes > 0 ? Math.round(userInput.length / timeInMinutes) : 0;
          await createSession.mutateAsync({
            questionId: question.id,
            duration: Math.max(elapsedTime, 1),
            typingSpeed: speed,
            accuracy: 100,
            errorCount: 0,
          });
          await Promise.all([
            utils.confidence.getByQuestion.invalidate({ questionId: question.id }),
            utils.confidence.getHistory.invalidate({ questionId: question.id }),
            utils.practice.countByQuestion.invalidate({ questionId: question.id }),
          ]);

          // 실제 반영값을 직접 fetch해서 최신 점수/그래프 동기화
          const [latestConfidence] = await Promise.all([
            utils.confidence.getByQuestion.fetch({ questionId: question.id }),
            utils.confidence.getHistory.fetch({ questionId: question.id }),
          ]);
          const latestScore = Math.round(latestConfidence?.displayScore ?? optimisticScore);
          confidenceScoreForAnimationRef.current = latestScore;
          setOptimisticDisplayScore(latestScore);
        } catch (error) {
          console.error('연습 기록 저장 실패:', error);
        }
      })();
    }
    
    // GA4 이벤트 추적
    if (question) {
      const questionType = question.imageUrl && question.imageLabels ? 'image' : 
                          (question.answer?.includes('|') ? 'table' : 'text');
      trackQuestionAttempt(
        question.id,
        question.subjectId,
        questionType as 'text' | 'image' | 'table',
        true,
        elapsedTime
      );
    }
    
    // 데모 모드: 누적 연습도 동시 증가
    if (isDemo && question) {
      const storageKey = `demo_practice_count_${question.id}`;
      const currentCount = parseInt(localStorage.getItem(storageKey) || "0", 10);
      localStorage.setItem(storageKey, String(currentCount + 1));
    }
  };

  // tableCorrectAnswerRef에 handleCorrectAnswer 연결
  tableCorrectAnswerRef.current = handleCorrectAnswer;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };



  // 한컴타자연습 스타일 채점 로직 (줄 단위 비교):
  // 1. 사용자 입력의 N번째 줄 → 정답의 N번째 줄과 비교
  // 2. 조합 중인 글자도 정답의 일부이면 검은색
  // 3. 종성 예약: 다음 글자의 초성과 일치하면 정답
  // 4. 언더바는 글자가 완성된 후에만 이동
  const completionInfo = useMemo(() => {
    // 줄 단위로 분리
    const userLines = userInput.split('\n');
    const targetLines = targetText.split('\n');
    
    // 반복 모드: 사용자 입력을 현재 체크된 줄의 target과 비교
    const repeatState = repeatStateRef.current;
    const isInRepeatMode = repeatState.isRepeatMode && repeatState.repeatLinesSorted.length > 0;
    const currentRepeatLineIdx = isInRepeatMode
      ? repeatState.repeatLinesSorted[repeatState.repeatCurrentIdx % repeatState.repeatLinesSorted.length]
      : -1;
    
    // 각 줄별 채점 정보
    const lineResults: Array<{
      targetChars: string[];
      charStates: Array<'complete' | 'partial' | 'wrong' | 'pending'>;
      completedCount: number;
    }> = [];
    
    // 엔터 없이 입력 시 초과 키 입력을 다음 줄로 이월하기 위한 변수
    let carryOverKeys = "";
    
    for (let lineIdx = 0; lineIdx < targetLines.length; lineIdx++) {
      // 반복 모드: 현재 체크된 줄에만 사용자 입력을 매핑
      let userLine = '';
      if (isInRepeatMode) {
        if (lineIdx === currentRepeatLineIdx) {
          userLine = userLines[0] || ''; // 입력창의 첫 줄을 현재 체크된 줄에 매핑
        }
        // 다른 줄은 빈 문자열 (채점 안 함)
      } else {
        userLine = userLines[lineIdx] || '';
      }
      const targetLine = targetLines[lineIdx] || '';

      const targetPrefixInfo = getListPrefixInfo(targetLine);
      const userPrefixInfo = getListPrefixInfo(userLine);
      const shouldSkipTargetPrefixForCompare =
        targetPrefixInfo.kind !== null && userPrefixInfo.kind === null;
      const targetCompareLine = shouldSkipTargetPrefixForCompare
        ? targetPrefixInfo.body
        : targetLine;

      const targetChars = splitGraphemes(targetCompareLine.replace(/\s+/g, ''));
      const targetKeyUnits = targetChars.map((char) => toTypingKeyUnit(char));
      let userKeySequence = toTypingKeySequence(userLine.replace(/\s+/g, ''));

      // 이전 줄에서 이월된 초과 키 입력을 현재 줄 앞에 추가
      if (!isInRepeatMode && carryOverKeys.length > 0) {
        userKeySequence = `${carryOverKeys}${userKeySequence}`;
        carryOverKeys = "";
      }

      const charStates: Array<'complete' | 'partial' | 'wrong' | 'pending'> = targetChars.map(() => 'pending');
      let completedCount = 0;
      let keyCursor = 0;

      for (let i = 0; i < targetChars.length; i++) {
        if (keyCursor >= userKeySequence.length) break;
        const targetUnit = targetKeyUnits[i];
        const remainingUser = userKeySequence.slice(keyCursor);

        if (remainingUser.length >= targetUnit.length && remainingUser.slice(0, targetUnit.length) === targetUnit) {
          charStates[i] = 'complete';
          completedCount = i + 1;
          keyCursor += targetUnit.length;
          continue;
        }

        if (targetUnit.startsWith(remainingUser)) {
          charStates[i] = 'partial';
          keyCursor = userKeySequence.length;
          break;
        }

        charStates[i] = 'wrong';
        break;
      }

      // 현재 줄을 정확히 완주했고 초과 입력이 있으면 다음 줄로 이월
      const targetKeyLength = targetKeyUnits.reduce((sum, unit) => sum + unit.length, 0);
      if (
        completedCount >= targetChars.length &&
        userKeySequence.length > targetKeyLength &&
        !isInRepeatMode &&
        lineIdx < targetLines.length - 1
      ) {
        carryOverKeys = userKeySequence.slice(targetKeyLength);
      }

      const skippedPrefixCharCount = shouldSkipTargetPrefixForCompare
        ? splitGraphemes(targetPrefixInfo.prefix.replace(/\s+/g, '')).length
        : 0;
      const displayCharStates: Array<'complete' | 'partial' | 'wrong' | 'pending'> =
        skippedPrefixCharCount > 0
          ? [
              ...Array.from({ length: skippedPrefixCharCount }, () => 'pending' as const),
              ...charStates,
            ]
          : charStates;

      lineResults.push({
        targetChars,
        charStates: displayCharStates,
        completedCount,
      });
    }
    
    // 현재 입력 중인 줄 인덱스
    // 반복 모드에서는 현재 체크된 줄 인덱스를 사용
    let currentLineIndex = isInRepeatMode ? currentRepeatLineIdx : currentCursorLineIndex;
    
    // 엔터 없이도 다음 줄 자동 인식:
    // 현재 줄의 모든 글자가 완성(completedCount === targetChars.length)이면
    // 다음 줄의 첫 글자에 언더바를 표시하기 위해 activeLineIdx를 다음 줄로 이동
    if (!isInRepeatMode && hideMode !== "all" && currentLineIndex < targetLines.length - 1) {
      const currentResult = lineResults[currentLineIndex];
      if (currentResult && currentResult.completedCount >= currentResult.targetChars.length && currentResult.targetChars.length > 0) {
        // 현재 줄 입력 완료 → 다음 줄로 이동
        currentLineIndex = currentLineIndex + 1;
      }
    }
    
    return { lineResults, currentLineIndex, userLines, targetLines };
  }, [userInput, targetText, renderTrigger, currentCursorLineIndex, repeatCheckedLines, repeatCurrentIdx, hideMode]);
  const activePracticeLineNumber = Math.max(1, completionInfo.currentLineIndex + 1);

  useEffect(() => {
    setLineIndicatorPulse(true);
    const timer = setTimeout(() => setLineIndicatorPulse(false), 900);
    return () => clearTimeout(timer);
  }, [activePracticeLineNumber]);

  // 실시간 단어 뷰: 줄 단위 opacity 계산
  const calculateLineOpacity = useMemo(() => {
    const lines = targetText.split('\n');
    const rs = repeatStateRef.current;
    const inRepeat = rs.isRepeatMode && rs.repeatLinesSorted.length > 0;
    const repeatLineIdx = inRepeat
      ? rs.repeatLinesSorted[rs.repeatCurrentIdx % rs.repeatLinesSorted.length]
      : -1;
    
    // completionInfo의 currentLineIndex를 사용 (다음 줄 자동 인식 반영)
    const activeIdx = completionInfo.currentLineIndex;
    
    // 각 줄의 opacity 계산
    return lines.map((_, lineIndex) => {
      if (inRepeat) {
        // 반복 모드: 현재 체크된 줄만 진하게
        return lineIndex === repeatLineIdx ? 1 : 0.4;
      }
      // 현재 활성 줄만 opacity 1 (진한 회색)
      if (lineIndex === activeIdx) {
        return 1;
      } else {
        return 0.4;
      }
    });
  }, [completionInfo, targetText, repeatCheckedLines, repeatCurrentIdx]);

  // 한컴타자연습 스타일 렌더링 (줄 단위 비교)
  const renderTextWithFeedback = useMemo(() => {
    const { lineResults, currentLineIndex: activeLineIdx } = completionInfo;
    // 전체 정답을 항상 표시 (반복 모드에서도 동일)
    const targetLines = targetText.split('\n');
    
    return targetLines.map((line, lineIdx) => {
      const actualLineIdx = lineIdx;
      const lineResult = lineResults[lineIdx];
      const lineOpacity = calculateLineOpacity[lineIdx] || 1;
      const isActiveLine = lineIdx === activeLineIdx;
      
      // 이미 올바르게 완주한 문장은 Tab 전체 가리기/해제와 무관하게 계속 보이도록 유지
      const isLineCompleted =
        !!lineResult &&
        lineResult.targetChars.length > 0 &&
        lineResult.completedCount >= lineResult.targetChars.length;
      // 답 가리기 체크: 전체 가리기 모드이면서 개별 보이기(hiddenLines에 없음)가 아닌 경우
      // 또는 개별 가리기(hiddenLines에 있음)인 경우
      const isLineHidden =
        !isLineCompleted &&
        ((hideMode === 'all' && !hiddenLines.has(lineIdx)) || (hideMode === 'none' && hiddenLines.has(lineIdx)));
      
      if (isLineHidden) {
        // 가려진 줄: 클릭하면 해당 줄만 보이기
          const revealLine = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setHiddenLines(prev => {
              const next = new Set(prev);
              const isCurrentlyRevealed = next.has(lineIdx);
              if (isCurrentlyRevealed) {
                next.delete(lineIdx);
              } else {
                next.add(lineIdx);
                markLineViewedInAutoHide(lineIdx);
              }
              return next;
            });
          };
        const isPracticeWrongLine = autoHideWrongLines.has(lineIdx);
        return (
          <div
            key={`line-${lineIdx}`}
            className="block cursor-pointer select-none group my-0.5"
            onClick={revealLine}
            onMouseDown={(e) => e.preventDefault()} // 포커스 이동 방지
          >
            <span
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-sm transition-colors ${
                isPracticeWrongLine
                  ? "border border-rose-300 bg-rose-100 text-rose-700"
                  : isActiveLine
                    ? "border border-primary/30 bg-primary/10 text-primary"
                    : "bg-muted/60 text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
              }`}
            >
              <EyeOff className="h-3 w-3" />
              {isPracticeWrongLine
                ? `${lineIdx + 1}번째 줄 (오답)`
                : isActiveLine
                  ? `${lineIdx + 1}번째 줄 (현재 연습 중)`
                  : `${lineIdx + 1}번째 줄 (클릭하여 보기)`}
            </span>
          </div>
        );
      }
      
      const chars = splitGraphemes(line);
      let charIdx = 0; // 띄어쓰기 제외한 글자 인덱스
      
      const renderedChars = chars.map((char, charIndex) => {
        // 띄어쓰기는 그대로 표시
        if (/\s/.test(char)) {
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-muted-foreground" style={{ opacity: lineOpacity }}>
              {char}
            </span>
          );
        }
        
        const currentCharIdx = charIdx;
        charIdx++;
        
        if (!lineResult) {
          // 이 줄에 대한 입력이 없음
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-gray-400 relative font-semibold text-xl" style={{ opacity: lineOpacity }}>
              {char}
            </span>
          );
        }
        
        const charState = lineResult.charStates[currentCharIdx] ?? 'pending';

        if (charState === 'complete') {
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-foreground relative font-semibold text-xl" style={{ opacity: 1 }}>
              {char}
            </span>
          );
        } else if (charState === 'partial') {
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-gray-600 relative font-semibold text-xl" style={{ opacity: 1 }}>
              {char}
            </span>
          );
        } else if (charState === 'wrong') {
          return (
            <span
              key={`${lineIdx}-${charIndex}`}
              className="relative font-semibold text-xl"
              style={{ opacity: 1, color: "var(--status-danger)" }}
            >
              {char}
            </span>
          );
        } else {
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-gray-400 relative font-semibold text-xl" style={{ opacity: lineOpacity }}>
              {char}
            </span>
          );
        }
      });
      
      // 줄 끝에 줄바꿈 추가 (마지막 줄 제외)
      // 첫 줄은 진한 회색 글씨, 나머지는 연한 회색 줄로 fade out
      const lineClass = "text-foreground";
      
      // 체크된 줄 상태
      const isChecked = repeatCheckedLines.has(actualLineIdx);
      const isCurrentRepeat = isRepeatMode && currentRepeatTarget?.lineIdx === actualLineIdx;
      // 집중 연습 선택 가능 여부: 2줄 이상
      const canSelectLine = targetLines.length > 1;
      // 문장 클릭: 항상 해당 줄 개별 가리기/보이기 토글 가능 (hideMode 무관)
      // - 가려진 줄 클릭 → 보이기
      // - 보이는 줄 클릭 → 가리기 (답 가리기 모드일 때) 또는 집중 연습 선택 (일반 모드)

      // 클릭 핸들러
      const handleLineClick = (e: React.MouseEvent) => {
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        if (hideMode === 'all' || hiddenLines.has(lineIdx)) {
          // 답 가리기 모드이거나 이미 가려진 줄: 개별 토글
          setHiddenLines(prev => {
            const next = new Set(prev);
            const isCurrentlyRevealed = next.has(lineIdx);
            if (isCurrentlyRevealed) {
              next.delete(lineIdx);
            } else {
              next.add(lineIdx);
              markLineViewedInAutoHide(lineIdx);
            }
            return next;
          });
        } else if (canSelectLine) {
          // 일반 모드: 집중 연습 선택
          toggleRepeatLine(actualLineIdx);
        }
        setTimeout(() => textareaRef.current?.focus(), 10);
      };

      // 마지막 시험 오답 줄 여부
      const isWrongLine =
        ((confidenceData as any)?.lastTestWrongLines?.includes(lineIdx) ?? false) ||
        autoHideWrongLines.has(lineIdx);

      const lineStyle: React.CSSProperties = {
        display: 'block',
        position: 'relative',
        paddingLeft: canSelectLine ? '10px' : '0',
        cursor: canSelectLine ? 'pointer' : 'default',
        userSelect: 'text',
        borderLeft: isChecked
          ? '3px solid oklch(0.55 0.2 290)'
          : isCurrentRepeat
          ? '3px solid oklch(0.55 0.2 290)'
          : isWrongLine
          ? '3px solid var(--status-danger-soft-border)'
          : canSelectLine
          ? '3px solid transparent'
          : 'none',
        backgroundColor: isCurrentRepeat
          ? 'oklch(0.55 0.2 290 / 0.12)'
          : isChecked
          ? 'oklch(0.55 0.2 290 / 0.07)'
          : isWrongLine
          ? 'var(--status-danger-soft-bg)'
          : 'transparent',
        borderRadius: '2px',
        marginLeft: '0',
        paddingRight: '4px',
        transition: 'background-color 0.15s, border-color 0.15s',
      };

      if (lineIdx < targetLines.length - 1) {
        return (
          <span
            key={`line-${lineIdx}`}
            className={`${lineClass} group/line`}
            style={lineStyle}
            onClick={handleLineClick}
            onMouseDown={canSelectLine ? (e) => {
              // 텍스트 선택 허용, 단 단순 클릭은 preventDefault 안 함
            } : undefined}
            title={canSelectLine ? (isChecked ? '클릭하여 집중 연습 해제' : '클릭하여 집중 연습 선택') : undefined}
          >
            {renderedChars}
            <span aria-hidden="true" className="text-muted-foreground select-none">{"\n"}</span>
          </span>
        );
      }
      
      return (
        <span
          key={`line-${lineIdx}`}
          className={`${lineClass} group/line`}
          style={lineStyle}
          onClick={handleLineClick}
          title={canSelectLine ? (isChecked ? '클릭하여 집중 연습 해제' : '클릭하여 집중 연습 선택') : undefined}
        >
          {renderedChars}
        </span>
      );
    });
  }, [userInput, targetText, completionInfo, isFadingOut, calculateLineOpacity, hideMode, hiddenLines, repeatCheckedLines, currentRepeatTarget, isRepeatMode, toggleRepeatLine, confidenceData, autoHideWrongLines]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation(`/`)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          돌아가기
        </Button>
        <Card className="shadow-elegant">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">로딩 중...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation(`/`)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          돌아가기
        </Button>
        <Card className="shadow-elegant">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">문제를 찾을 수 없습니다</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col flex-1 min-h-0 h-full w-full overflow-y-hidden overflow-x-visible overscroll-x-none transition-all duration-300 ease-out ${
      isLeaving
        ? `opacity-0 ${scrollNavDirection === "next" ? "-translate-x-8 -rotate-[0.2deg]" : scrollNavDirection === "prev" ? "translate-x-8 rotate-[0.2deg]" : "translate-x-2"} scale-[0.988] blur-[1px] pointer-events-none`
        : "opacity-100 translate-x-0 rotate-0 scale-100 blur-0"
    }`}>
      <DamageNumber
        value={damageValue}
        show={showDamageNumber}
        onComplete={() => setShowDamageNumber(false)}
      />
      {/* 스크롤 가능한 콘텐츠 영역 */}
      <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto overflow-x-visible overscroll-x-none ${isImageQuestion ? 'space-y-2' : 'space-y-4'} ${contentBottomPaddingClass} px-2 py-4 sm:px-3 lg:px-4`}>
      <div className="relative mx-auto w-full max-w-[1360px]">
      <div className="relative z-20 mx-auto w-full max-w-[1360px]">
      {isImageQuestion ? (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={handleGoBack} className="gap-1.5 h-8 px-2 shrink-0">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">돌아가기</span>
          </Button>
          <div className="flex items-center gap-2 min-w-0 flex-nowrap">
            <div className="flex items-center gap-1 shrink-0 text-xs">
              <span className="font-bold tabular-nums text-sm">{practiceCountDisplay}</span>
              <span className="text-muted-foreground" title={currentPracticeTitle}>현재</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="font-bold tabular-nums text-sm">{isDemo && question ? parseInt(localStorage.getItem(`demo_practice_count_${question.id}`) || "0", 10) : (practiceCountData?.count || 0)}</span>
              <span className="text-muted-foreground" title={cumulativePracticeTitle}>누적</span>
            </div>
            {!isDemo && confidenceData && <div className="h-4 w-px bg-border shrink-0" />}
            {!isDemo && confidenceData && (
              <button
                className="flex items-center gap-1 hover:opacity-70 transition-opacity cursor-pointer shrink-0"
                title="안정도 변화 그래프 보기"
                onClick={() => setShowConfidenceHistory(true)}
              >
                <span
                  className="font-bold tabular-nums text-sm"
                  style={{
                    color:
                      displayedConfidenceState === "green"
                        ? SCORE_STATE_COLOR.green
                        : displayedConfidenceState === "yellow"
                          ? SCORE_STATE_COLOR.yellow
                          : SCORE_STATE_COLOR.red,
                  }}
                >
                  {displayedConfidenceScore}점
                </span>
                <span className="text-xs text-muted-foreground">안정도</span>
              </button>
            )}
            {!isDemo && (confidenceData as any)?.examDatePrediction && (() => {
              const pred = (confidenceData as any).examDatePrediction;
              const stateColor = pred.predictedState === 'green'
                ? SCORE_STATE_COLOR.green
                : pred.predictedState === 'yellow'
                  ? SCORE_STATE_COLOR.yellow
                  : SCORE_STATE_COLOR.red;
              const minutesToExam = typeof pred.minutesUntilExam === "number"
                ? pred.minutesUntilExam
                : (typeof pred.daysUntilExam === "number" ? pred.daysUntilExam * 24 * 60 : 0);
              const days = Math.floor(minutesToExam / (60 * 24));
              const hours = Math.floor((minutesToExam % (60 * 24)) / 60);
              const mins = Math.max(0, minutesToExam % 60);
              const remainingLabel = days > 0
                ? `D-${days} · ${hours}시간 후`
                : hours > 0
                  ? `D-Day · ${hours}시간 ${mins}분 후`
                  : `D-Day · ${mins}분 후`;
              return (
                <>
                  <div className="h-4 w-px bg-border shrink-0" />
                  <div className="flex items-center gap-1 shrink-0 text-xs">
                    <span className="text-muted-foreground">{remainingLabel}</span>
                    <span className="font-semibold" style={{ color: stateColor }}>{pred.predictedScore}점</span>
                  </div>
                </>
              );
            })()}
            <div className="h-4 w-px bg-border shrink-0" />
            <div className="flex items-center gap-1 shrink-0">
              <Circle
                className={`h-2.5 w-2.5 ${
                  isActive
                    ? "fill-green-500 text-green-500"
                    : "fill-rose-500 text-rose-500 dark:fill-rose-400 dark:text-rose-400"
                }`}
              />
              <span className={`text-[10px] font-medium whitespace-nowrap ${isActive ? 'text-green-600 dark:text-green-400' : 'text-rose-500 dark:text-rose-400'}`}>
                {isActive ? '측정중' : '중단됨'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* 텍스트/표 문제: 상단 통계 바 */
        <div className="flex items-center justify-between gap-2 min-w-0">
          {/* 왼쪽: 돌아가기 */}
          <Button variant="ghost" size="sm" onClick={handleGoBack} className="gap-1.5 h-8 px-2 shrink-0">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">돌아가기</span>
          </Button>

          {/* 오른쪽: 통계 + 측정 상태 */}
          <div className="flex items-center gap-2 min-w-0 flex-nowrap">
            {/* 현재/누적 연습 */}
            <div className="flex items-center gap-1 shrink-0 text-xs">
              <span className="font-bold tabular-nums text-sm">{practiceCountDisplay}</span>
              <span className="text-muted-foreground" title={currentPracticeTitle}>현재</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="font-bold tabular-nums text-sm">{isDemo && question ? parseInt(localStorage.getItem(`demo_practice_count_${question.id}`) || "0", 10) : (practiceCountData?.count || 0)}</span>
              <span className="text-muted-foreground" title={cumulativePracticeTitle}>누적</span>
            </div>

            {/* 구분선 */}
            {!isDemo && confidenceData && <div className="h-4 w-px bg-border shrink-0" />}

            {/* 안정도 */}
            {!isDemo && confidenceData && (
              <button
                className="flex items-center gap-1 hover:opacity-70 transition-opacity cursor-pointer shrink-0"
                title="안정도 변화 그래프 보기"
                onClick={() => setShowConfidenceHistory(true)}
              >
                <span
                  className="font-bold tabular-nums text-sm"
                  style={{
                    color:
                      displayedConfidenceState === "green"
                        ? SCORE_STATE_COLOR.green
                        : displayedConfidenceState === "yellow"
                          ? SCORE_STATE_COLOR.yellow
                          : SCORE_STATE_COLOR.red,
                  }}
                >
                  {displayedConfidenceScore}점
                </span>
                <span className="text-xs text-muted-foreground">안정도</span>
              </button>
            )}

            {/* 시험일 예측 */}
            {!isDemo && (confidenceData as any)?.examDatePrediction && (() => {
              const pred = (confidenceData as any).examDatePrediction;
              const stateColor = pred.predictedState === 'green'
                ? SCORE_STATE_COLOR.green
                : pred.predictedState === 'yellow'
                  ? SCORE_STATE_COLOR.yellow
                  : SCORE_STATE_COLOR.red;
              const minutesToExam = typeof pred.minutesUntilExam === "number"
                ? pred.minutesUntilExam
                : (typeof pred.daysUntilExam === "number" ? pred.daysUntilExam * 24 * 60 : 0);
              const days = Math.floor(minutesToExam / (60 * 24));
              const hours = Math.floor((minutesToExam % (60 * 24)) / 60);
              const mins = Math.max(0, minutesToExam % 60);
              const remainingLabel = days > 0
                ? `D-${days} · ${hours}시간 후`
                : hours > 0
                  ? `D-Day · ${hours}시간 ${mins}분 후`
                  : `D-Day · ${mins}분 후`;
              return (
                <>
                  <div className="h-4 w-px bg-border shrink-0" />
                  <div className="flex items-center gap-1 shrink-0 text-xs">
                    <span className="text-muted-foreground">{remainingLabel}</span>
                    <span className="font-semibold" style={{ color: stateColor }}>{pred.predictedScore}점</span>
                    {pred.scoreDelta !== 0 && (
                      <span className={pred.scoreDelta < 0 ? "text-rose-400 font-medium" : "text-emerald-500 font-medium"}>
                        ({pred.scoreDelta > 0 ? `+${pred.scoreDelta}` : pred.scoreDelta})
                      </span>
                    )}
                  </div>
                </>
              );
            })()}

            {/* 구분선 */}
            <div className="h-4 w-px bg-border shrink-0" />

            {/* 측정 상태 표시 */}
            <div className="flex items-center gap-1 shrink-0">
              <div className="relative w-4 h-4 flex items-center justify-center flex-shrink-0">
                <div className={`h-2 w-2 rounded-full z-10 relative ${isActive ? 'bg-green-500' : 'bg-rose-500 dark:bg-rose-400'}`} />
                {isActive ? (
                  <div className="absolute inset-0 rounded-full bg-green-500/30 animate-ping" style={{animationDuration: '1.5s'}} />
                ) : (
                  <div className="absolute inset-0 rounded-full bg-rose-500/20 dark:bg-rose-400/20 animate-pulse" style={{animationDuration: '2s'}} />
                )}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${isActive ? 'text-green-600 dark:text-green-400' : 'text-rose-500 dark:text-rose-400'}`}>
                {isActive ? '측정중' : '중단됨'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 학습 제안 배너 */}
      {studySuggestion && !isImageQuestion && (
        <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg text-sm ${
          studySuggestion.type === 'mastered' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20' :
          studySuggestion.type === 'test_ready' ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20' :
          studySuggestion.type === 'hide_practice' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20' :
          'bg-muted/50 text-muted-foreground border border-border'
        }`}>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 flex-shrink-0" />
            <span>{studySuggestion.message}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {(studySuggestion.type === 'test_ready' || studySuggestion.type === 'mastered') && question && (
              <div className="flex flex-col items-center gap-0.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => {
                    const testPath = buildTestPath();
                    if (testPath) setLocation(testPath);
                  }}
                >
                  <Zap className="h-3 w-3" />
                  시험 시작
                </Button>
              </div>
            )}
            {studySuggestion.type === 'hide_practice' && (
              <div className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-0.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => setHideMode('all')}
                  >
                    <EyeOff className="h-3 w-3" />
                    답 가리기
                  </Button>
                </div>
                {question && (
                  <div className="flex flex-col items-center gap-0.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                      onClick={() => {
                        const testPath = buildTestPath();
                        if (testPath) setLocation(testPath);
                      }}
                    >
                      <Zap className="h-3 w-3" />
                      시험 시작
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {!isDemo && orderedSubjectQuestions && orderedSubjectQuestions.length > 1 && (
        <div className="mb-2 flex items-center justify-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-2 py-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
            {prevQuestion ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 xl:hidden"
                onClick={() => navigateWithMorph(prevQuestion.id, "prev")}
                aria-label="이전 문제"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : (
              <span className="h-7 w-7 xl:hidden" aria-hidden="true" />
            )}
            <span className="text-xs font-semibold tabular-nums">
              {Math.max(1, currentIndex + 1)} / {totalQuestions}
            </span>
            <span className="hidden sm:inline text-[10px] text-muted-foreground">문제 이동</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="h-6 w-12 rounded-md border border-border bg-background px-1.5 text-center text-xs font-medium tabular-nums outline-none focus:border-primary"
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => jumpToQuestionByNumber(jumpInput)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                jumpToQuestionByNumber(jumpInput);
              }}
              aria-label="문제 번호 이동"
            />
            <span className="text-[10px] text-muted-foreground">/ {totalQuestions}</span>
            {nextQuestion ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 xl:hidden"
                onClick={() => navigateWithMorph(nextQuestion.id, "next")}
                aria-label="다음 문제"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <span className="h-7 w-7 xl:hidden" aria-hidden="true" />
            )}
          </div>
        </div>
      )}

      <div
        className={`relative ${
          !isDemo && orderedSubjectQuestions && orderedSubjectQuestions.length > 1
            ? "xl:px-14"
            : ""
        }`}
      >
      <Card className={isImageQuestion ? 'shadow-none border-0' : 'shadow-elegant'}>
        <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2 flex-wrap">
                  <CardTitle className="max-w-full whitespace-pre-line break-words leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
                    {question.question}
                  </CardTitle>
                  {!isDemo && confidenceData?.badges && (
                    <div className="ml-1 flex items-center gap-1">
                      {confidenceData.badges.lastTestWrong && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-rose-100 text-rose-700 dark:bg-rose-950/35 dark:text-rose-300">
                          오답
                        </span>
                      )}
                      {confidenceData.badges.frequentlyWrong && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                          자주틀림
                        </span>
                      )}
                      {confidenceData.badges.hasWarnZone && (
                        <div className="relative">
                          <button
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 cursor-pointer transition-colors"
                            onClick={() => setShowWarnZone(v => !v)}
                          >
                            ⚠️ 주의구간 {showWarnZone ? '▲' : '▼'}
                          </button>
                          {showWarnZone && (
                            <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-yellow-200 dark:border-yellow-700/40 bg-white dark:bg-zinc-900 shadow-lg p-3">
                              <p className="text-xs text-muted-foreground mb-2">시험에서 2회 이상 오답이 발생한 구간</p>
                              {confidenceData?.warnZoneLines && confidenceData.warnZoneLines.length > 0 ? (
                                <ul className="space-y-1.5">
                                  {confidenceData.warnZoneLines.map((wz: { lineIndex: number; wrongCount: number }) => (
                                    <li key={wz.lineIndex} className="flex items-center justify-between px-2 py-1.5 rounded bg-yellow-50 dark:bg-yellow-900/20">
                                      <span className="text-xs font-medium text-yellow-800 dark:text-yellow-300">{wz.lineIndex}번째 줄</span>
                                      <span className="text-xs font-bold text-rose-500 dark:text-rose-400">{wz.wrongCount}회 오답</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">데이터 없음</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {isTableQuestion && (
                  <CardDescription>
                    셀 클릭으로 이동
                  </CardDescription>
                )}
              </div>
              <div className="flex max-w-full shrink-0 flex-wrap items-start justify-end gap-1.5">
                {!isTableQuestion && (
                  <div className="inline-flex shrink-0 items-center rounded-md border border-border bg-muted/40 p-0.5">
                    <button
                      type="button"
                      className={`h-6 min-w-[2.7rem] shrink-0 whitespace-nowrap rounded px-2 text-[11px] leading-none font-medium transition-colors ${
                        inputLayoutPreference === "horizontal" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setInputLayoutPreference("horizontal")}
                    >
                      가로
                    </button>
                    <button
                      type="button"
                      className={`h-6 min-w-[2.7rem] shrink-0 whitespace-nowrap rounded px-2 text-[11px] leading-none font-medium transition-colors ${
                        inputLayoutPreference === "vertical" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setInputLayoutPreference("vertical")}
                    >
                      세로
                    </button>
                  </div>
                )}
                <div className="flex flex-col items-center gap-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 gap-1.5 text-xs ${hideMode === 'all' || isImageMaskActive ? 'bg-amber-500/10 text-amber-600' : ''}`}
                    onClick={toggleHideAll}
                  >
                    {hideMode === 'all' || isImageMaskActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {hideMode === 'all' || isImageMaskActive ? '답 보기' : '답 가리기'}
                  </Button>
                  <span className="text-[10px] text-muted-foreground/70 leading-none">Tab</span>
                </div>
                {question && (
                  <div className="flex flex-col items-center gap-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => {
                        const testPath = buildTestPath();
                        if (testPath) setLocation(testPath);
                      }}
                    >
                      <Zap className="h-3.5 w-3.5" />
                      시험 시작
                    </Button>
                    <span className="text-[10px] text-muted-foreground/70 leading-none">Shift+Enter</span>
                  </div>
                )}
                {!isDemo && question && (
                  <div className="flex flex-col items-center gap-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 gap-1.5 text-xs ${memoOpen ? 'bg-blue-500/10 text-blue-600' : ''}`}
                      onClick={() => {
                        if (isTableQuestion) {
                          toast.info("표 문제 메모 기능은 개발 중입니다.");
                          return;
                        }
                        setMemoOpen(!memoOpen);
                      }}
                    >
                      <StickyNote className="h-3.5 w-3.5" />
                      메모
                    </Button>
                    <span className="text-[10px] text-muted-foreground/50 leading-none opacity-0">·</span>
                  </div>
                )}
                {!isDemo && question && (
                  <div className="flex flex-col items-center gap-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 gap-1.5 text-xs ${editMode ? 'bg-orange-500/10 text-orange-600' : ''}`}
                      onClick={() => {
                        if (isImageQuestion) {
                          setLocation(`/questions/${question.subjectId}`);
                          return;
                        }
                        editMode ? setEditMode(false) : startEditMode();
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      수정
                    </Button>
                    <span className="text-[10px] text-muted-foreground/50 leading-none opacity-0">·</span>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
        <CardContent className={isImageQuestion ? 'p-0 space-y-2' : isTableQuestion ? 'space-y-4' : 'space-y-6'}>
          {/* 메모 패널 - 정답 표시 영역과 2단 레이아웃으로 표시됨 (memoOpen 시) */}

          {/* 인라인 문제 편집 모드 */}
          {editMode && !isImageQuestion && (
            <div className="rounded-lg border-2 border-orange-300 bg-orange-50/50 dark:bg-orange-950/20 dark:border-orange-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-orange-600" />
                  <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">문제 수정</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-orange-300 text-orange-700 hover:bg-orange-100"
                    onClick={handleSaveEdit}
                    disabled={updateQuestionMutation.isPending}
                  >
                    <Check className="h-3 w-3" />
                    {updateQuestionMutation.isPending ? '저장 중...' : '저장'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => setEditMode(false)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {isTableQuestion ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-1 block">질문</label>
                    <Textarea
                      value={editQuestion}
                      onChange={(e) => setEditQuestion(e.target.value)}
                      rows={2}
                      className="border-orange-200 dark:border-orange-700 bg-white dark:bg-orange-950/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-1 block">표 작성</label>
                    <TableEditor
                      initialData={editTableData || undefined}
                      onChange={(data) => setEditTableData(data)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-1 block">질문</label>
                    <Textarea
                      value={editQuestion}
                      onChange={(e) => setEditQuestion(e.target.value)}
                      rows={3}
                      className="border-orange-200 dark:border-orange-700 bg-white dark:bg-orange-950/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-1 block">답안</label>
                    <Textarea
                      value={editAnswer}
                      onChange={(e) => setEditAnswer(e.target.value)}
                      rows={6}
                      className="border-orange-200 dark:border-orange-700 bg-white dark:bg-orange-950/30 font-mono"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="practice-edit-auto-numbering"
                      checked={editAutoNumbering}
                      onChange={(e) => setEditAutoNumbering(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                    />
                    <label htmlFor="practice-edit-auto-numbering" className="text-xs text-orange-700 dark:text-orange-400 cursor-pointer">
                      엔터 기준으로 답안 번호 자동 생성
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 줄 반복 연습 상태 배지 */}
          {isRepeatMode && !isImageQuestion && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-100/60 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700">
              <Repeat className="h-3.5 w-3.5 text-purple-600 shrink-0" />
              <span className="text-xs font-semibold text-purple-700 dark:text-purple-400">
                반복 연습 중
              </span>
              <span className="text-xs text-purple-600 dark:text-purple-400">
                {repeatCheckedLines.size}줄 선택
              </span>
              {currentRepeatTarget && (
                <span className="text-xs text-purple-500 dark:text-purple-400 truncate max-w-[200px]">
                  → {currentRepeatTarget.lineIdx + 1}번째 줄 ({repeatCount}회 / 사이클 {Math.floor(repeatTotalCount / Math.max(1, repeatCheckedLines.size))}회)
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs ml-auto text-purple-600 hover:text-purple-800 hover:bg-purple-200"
                onClick={stopRepeatMode}
              >
                종료
              </Button>
            </div>
          )}

          {isTableQuestion && tableData ? (
            /* Table question - 코어 함수는 컨포넌트 레벨에 정의됨 */
            <div>
              <TableView
                tableData={tableData}
                hideAnswer={hideMode === "all"}
                activeCellKey={tableActiveCellKey}
                completedCells={tableCompletedCells}
                checkedCells={tableCheckedCells}
                partialInput={tableCellInput}
                cellSubmittedResult={tableCellSubmittedResult}
                wrongCells={tableWrongCells}
                onCellCheck={(key) => {
                  setTableCheckedCells(prev => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  });
                }}
                onCellActivate={(key) => {
                  const idx = tableBlankCells.indexOf(key);
                  if (idx >= 0) {
                    setTableActiveCellIdx(idx);
                    clearTableInput(true);
                  }
                }}
              />
              <style>{`
                @keyframes shake {
                  0%, 100% { transform: translateX(0); }
                  20% { transform: translateX(-6px); }
                  40% { transform: translateX(6px); }
                  60% { transform: translateX(-4px); }
                  80% { transform: translateX(4px); }
                }
              `}</style>
              {showToothMorphologySource && (
                <p className="mt-2 text-[10px] text-muted-foreground/45 text-right select-none">
                  출처: 『치아형태학』, 이승표, 수문사 (2016)
                </p>
              )}
            </div>
          ) : isImageQuestion ? (
            /* Image question with label boxes - resizable 2 column layout */
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  라벨 연습 진행 {Math.min(imageMatchedLabelIndices.size, imageAnswerEntries.length)} / {imageAnswerEntries.length || imageLabels.length}
                </span>
                <span>Enter: 한 줄 채점 · Tab: 답 가리기 · Shift+Enter: 시험 시작</span>
              </div>
              {/* Image layout row */}
              <div
                ref={imageLayoutRowRef}
                className={
                  useHorizontalImageLayout
                    ? "grid grid-cols-[minmax(0,1.2fr)_minmax(280px,1fr)] items-stretch gap-3"
                    : "flex flex-col gap-3"
                }
                style={{ alignItems: useHorizontalImageLayout ? "stretch" : "flex-start" }}
              >
                {/* Left: Image with labels */}
                <div
                  className="relative min-w-0"
                  style={{
                    width: useHorizontalImageLayout ? `${imageScale}%` : `${Math.min(100, imageScale + 10)}%`,
                    minWidth: useHorizontalImageLayout ? "200px" : "240px",
                    maxWidth: "100%",
                  }}
                >
                  {/* Size control - floating overlay on top-right of image */}
                  <div className="absolute top-1 right-1 z-10 flex items-center gap-1 bg-background/80 backdrop-blur-sm rounded px-1.5 py-0.5 border border-border/50">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => setImageScale(Math.max(30, imageScale - 10))}
                        className="px-1.5 py-0.5 text-[10px] rounded hover:bg-muted transition-colors"
                        title="줄이기"
                      >−</button>
                      <span className="text-[10px] font-mono w-8 text-center">{imageScale}%</span>
                      <button
                        onClick={() => setImageScale(Math.min(100, imageScale + 10))}
                        className="px-1.5 py-0.5 text-[10px] rounded hover:bg-muted transition-colors"
                        title="늘이기"
                      >+</button>
                    </div>
                    <button
                      onClick={applyImageFitScale}
                      className="px-1.5 py-0.5 text-[10px] rounded hover:bg-muted transition-colors"
                    >맞춤</button>
                  </div>
                    <div className="relative w-full rounded-lg border-2 border-border overflow-hidden" ref={imageContainerRef}>
                      {!imageLoaded && (
                        <div className="flex items-center justify-center min-h-[300px] md:min-h-[400px] bg-muted/30 rounded-lg border-2 border-border">
                          <p className="text-muted-foreground">이미지 로딩 중...</p>
                      </div>
                    )}
                    <img
                      ref={imageElementRef}
                      src={question.imageUrl || ""}
                      alt="Question image"
                      className={`w-full h-auto block ${!imageLoaded ? 'hidden' : ''}`}
                      onLoad={(e) => {
                        const target = e.currentTarget;
                        imageNaturalSizeRef.current = {
                          width: target.naturalWidth,
                          height: target.naturalHeight,
                        };
                        setImageLoaded(true);
                        window.requestAnimationFrame(() => {
                          applyImageFitScale();
                        });
                      }}
                      loading="eager"
                      fetchPriority="high"
                    />
                    {imageLabels.map((label: any, index: number) => {
                      const isRevealed = revealedLabels.has(index);
                      const isMatched = imageMatchedLabelIndices.has(index);
                      return (
                        <div
                          key={index}
                          className={`absolute border-2 transition-all cursor-pointer ${
                            isMatched
                              ? "border-emerald-500 bg-emerald-500/10"
                              : isRevealed
                                ? "border-dashed border-primary bg-transparent"
                                : "border-primary bg-black hover:bg-black/90"
                          }`}
                          style={{
                            left: `${label.x}%`,
                            top: `${label.y}%`,
                            width: `${label.width}%`,
                            height: `${label.height}%`,
                          }}
                          onClick={() => {
                            const newRevealed = new Set(revealedLabels);
                            if (isRevealed) {
                              newRevealed.delete(index);
                              lastLabelActionRef.current = 'hide';
                            } else {
                              newRevealed.add(index);
                              lastLabelActionRef.current = 'reveal';
                            }
                            revealedLabelsRef.current = newRevealed;
                            setRevealedLabels(newRevealed);
                            if (!hasInteracted) setHasInteracted(true);
                            const now = Date.now();
                            if (!startTime) setStartTime(now);
                            setLastInputTime(now);
                            if (!isActive) {
                              setIsActive(true);
                              setCurrentContinuousStartAt(now);
                            }
                          }}
                        >
                          {!isRevealed && !isMatched && (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-white font-bold text-2xl">{index + 1}</span>
                            </div>
                          )}
                          {isMatched && (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-emerald-700 dark:text-emerald-300 font-bold text-xs">완료</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {imageAttribution && (
                    <div className="mt-2 text-[10px] text-muted-foreground/75 space-y-0.5 border-t border-border/50 pt-1 select-none">
                      {imageAttribution.lines.map((line, index) =>
                        line.href ? (
                          <p key={`${line.text}-${index}`}>
                            <a
                              href={line.href}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="hover:underline underline-offset-2"
                            >
                              {line.text}
                            </a>
                          </p>
                        ) : (
                          <p key={`${line.text}-${index}`}>{line.text}</p>
                        )
                      )}
                    </div>
                  )}
                </div>

                {/* Right: Lined notebook-style practice note */}
                {!isDemo && (
                <div className="flex-1 min-w-0 flex flex-col" style={{ minWidth: useHorizontalImageLayout ? '280px' : '200px' }} ref={imageAnswerPanelRef}>
                  <div
                    className="relative rounded-lg border-2 border-border bg-background overflow-hidden cursor-text"
                    style={{
                      height: useHorizontalImageLayout
                        ? `${imageContainerHeight}px`
                        : `${Math.max(280, Math.min(520, Math.round(imageContainerHeight * 0.62)))}px`,
                    }}
                    onMouseDown={(e) => {
                      // textarea 자체 클릭은 기본 동작으로 처리
                      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
                      e.preventDefault();
                      const ta = notepadRef.current;
                      if (!ta) return;
                      ta.focus();
                      // 클릭한 Y 위치로 커서 이동
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickY = e.clientY - rect.top;
                      const lineHeight = 28;
                      const paddingTop = 8;
                      const targetLine = Math.floor((clickY - paddingTop) / lineHeight);
                      if (targetLine >= 0) {
                        const lines = ta.value.split('\n');
                        let pos = 0;
                        for (let i = 0; i < Math.min(targetLine, lines.length - 1); i++) {
                          pos += lines[i].length + 1;
                        }
                        pos += (lines[Math.min(targetLine, lines.length - 1)]?.length || 0);
                        ta.setSelectionRange(pos, pos);
                      }
                    }}
                  >
                    {/* Lined paper background */}
                    <div className="absolute inset-0 pointer-events-none" style={{ 
                      backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, oklch(0.7 0.01 260 / 0.25) 27px, oklch(0.7 0.01 260 / 0.25) 28px)',
                      backgroundPositionY: '7px'
                    }} />
                    {/* Left margin line */}
                    <div className="absolute top-0 bottom-0 left-[36px] w-[1px] pointer-events-none" style={{ backgroundColor: 'oklch(0.7 0.1 20 / 0.2)' }} />
                    <textarea
                      ref={notepadRef}
                      value={practiceNote}
                      onChange={(e) => handleImagePracticeNoteChange(e.target.value)}
                      onKeyDown={handleImagePracticeKeyDown}
                      onCompositionStart={() => setIsComposing(true)}
                      onCompositionEnd={() => setIsComposing(false)}
                      className="absolute inset-0 bg-transparent resize-none focus:outline-none font-mono text-sm text-foreground"
                      style={{
                        lineHeight: '28px',
                        paddingTop: '8px',
                        paddingLeft: '44px',
                        caretColor: 'oklch(0.5 0.15 260)',
                        zIndex: 1,
                        overflow: 'hidden',
                      }}
                      placeholder="연습장처럼 적어보세요. 한 줄 입력 후 Enter로 바로 채점됩니다."
                      spellCheck={false}
                    />
                  </div>
                </div>
                )}
              </div>
              {isDemo && (
                <div className="rounded-xl border-2 border-border bg-background px-4 py-3">
                  <div className="mb-2 text-xs text-muted-foreground">연습장</div>
                  <textarea
                    ref={notepadRef}
                    value={practiceNote}
                    onChange={(e) => handleImagePracticeNoteChange(e.target.value)}
                    onKeyDown={handleImagePracticeKeyDown}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => setIsComposing(false)}
                    className="w-full rounded-lg border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring text-sm leading-6 px-3 py-2"
                    style={{ minHeight: "160px", maxHeight: "40vh" }}
                    placeholder="정답을 가리고 떠오르는 라벨명을 적고 Enter로 채점해보세요."
                    spellCheck={false}
                  />
                </div>
              )}
              {memoOpen && !isDemo && (
                <div className="rounded-lg border-2 border-blue-300 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-700 p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StickyNote className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">암기법 / 설명 메모</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {memoSaved && <span className="text-xs text-emerald-600">✓ 저장됨</span>}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-100"
                        onClick={handleSaveMemo}
                        disabled={memoSaving}
                      >
                        <Save className="h-3 w-3" />
                        {memoSaving ? '저장 중...' : '저장'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setMemoOpen(false)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="이미지 문제 암기법, 설명 포인트를 적어두세요."
                    className="w-full p-3 rounded-md border border-blue-200 dark:border-blue-700 bg-white dark:bg-blue-950/30 resize-none text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    style={{ minHeight: '180px' }}
                  />
                </div>
              )}
            </div>
          ) : (
            /* Text question with visual feedback */
            <>
              {/* 가로 모드/메모 모드: 정답 우측에 패널 배치 */}
              <div
                className={
                  memoOpen || useHorizontalInputLayout
                    ? useHorizontalInputLayout
                      ? "flex flex-row gap-4 items-stretch min-h-[66vh] overflow-x-auto"
                      : "flex flex-col gap-4 items-stretch"
                    : ""
                }
              >
                <div className={memoOpen || useHorizontalInputLayout ? "flex-1 min-w-0" : ""}>
                  <div
                    ref={answerDisplayRef}
                    className="px-5 py-5 bg-muted/25 rounded-xl border-2 border-border overflow-y-auto"
                    style={{
                      minHeight: `${answerPanelMinHeightPx}px`,
                      maxHeight: answerPanelMaxHeight,
                    }}
                  >
                    <div className="leading-relaxed whitespace-pre-wrap">
                      {renderTextWithFeedback}
                    </div>
                  </div>
                  {showToothMorphologySource && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground/45 text-right select-none">
                      출처: 『치아형태학』, 이승표, 수문사 (2016)
                    </p>
                  )}
                </div>

                {/* 가로 모드 입력 패널: 답안 우측 빈 공간 활용 */}
                {useHorizontalInputLayout && (
                  <div className="w-[42%] min-w-[300px] max-w-[560px] rounded-xl border-2 border-border bg-background py-3 flex flex-col gap-2">
                    <div className="px-5 text-xs text-muted-foreground">연습장 입력</div>
                    <div className="px-5 text-[11px] text-muted-foreground">
                      띄어쓰기·엔터·한/영 전환 없이 써도 되고, 초성 입력도 인정돼요.
                    </div>
                    <div
                      key={`line-indicator-horizontal-${activePracticeLineNumber}`}
                      className={`px-5 text-[11px] transition-all duration-700 ${
                        lineIndicatorPulse
                          ? "opacity-100 text-primary"
                          : "opacity-65 text-muted-foreground"
                      }`}
                    >
                      현재 {activePracticeLineNumber}번째 줄 연습 중
                    </div>
                    <div className="px-5">
                      <textarea
                        data-practice-input="main"
                        ref={textareaRef}
                        value={userInput}
                        onCompositionStart={handleCompositionStart}
                        onCompositionEnd={handleCompositionEnd}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onKeyUp={handleKeyUp}
                        className="w-full flex-1 rounded-xl border-2 border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring caret-foreground text-xl font-semibold leading-relaxed tracking-tight px-5 py-3 placeholder:text-sm placeholder:font-normal placeholder:tracking-normal"
                        style={{
                          minHeight: `${horizontalInputMinHeightPx}px`,
                          maxHeight: "74vh",
                        }}
                        placeholder="연습장처럼 편하게 입력해보세요. 떠오르는 내용부터 적어도 괜찮아요."
                      />
                    </div>
                  </div>
                )}

                {/* 메모 패널 - 정답과 나란히 */}
                {memoOpen && (
                  <div className="flex-1 rounded-lg border-2 border-blue-300 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-700 p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StickyNote className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">암기법 / 설명 메모</span>

                      </div>
                      <div className="flex items-center gap-2">
                        {memoSaved && <span className="text-xs text-emerald-600">✓ 저장됨</span>}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-100"
                          onClick={handleSaveMemo}
                          disabled={memoSaving}
                        >
                          <Save className="h-3 w-3" />
                          {memoSaving ? '저장 중...' : '저장'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => setMemoOpen(false)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <textarea
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="암기법, 연상 기억법, 설명 등을 적어두세요."
                      className="flex-1 w-full p-3 rounded-md border border-blue-200 dark:border-blue-700 bg-white dark:bg-blue-950/30 resize-none text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      style={{ minHeight: '200px' }}
                    />
                  </div>
                )}
              </div>

            </>
          )}
        </CardContent>
      </Card>
      {!isDemo && orderedSubjectQuestions && orderedSubjectQuestions.length > 1 && (
        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-30 hidden xl:block">
          {prevQuestion && (
            <Button
              variant="outline"
              size="icon"
              className="pointer-events-auto absolute left-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full border-border/70 bg-background/92 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85"
              onClick={() => navigateWithMorph(prevQuestion.id, "prev")}
              aria-label="이전 문제"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          {nextQuestion && (
            <Button
              variant="outline"
              size="icon"
              className="pointer-events-auto absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full border-border/70 bg-background/92 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85"
              onClick={() => navigateWithMorph(nextQuestion.id, "next")}
              aria-label="다음 문제"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          )}
        </div>
      )}
      </div>
      </div>
      </div>
      </div>{/* 스크롤 영역 끝 */}

      {/* 하단 고정 입력 패널 - 표 모드 전용 */}
      {isTableQuestion && tableData && (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <div className="mx-auto w-full max-w-[1360px] px-2 sm:px-3 lg:px-4">
            <div className="mt-2 shrink-0 rounded-t-2xl border-x border-t border-border bg-background/95 px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 shadow-[0_-10px_24px_rgba(0,0,0,0.08)] backdrop-blur supports-[backdrop-filter]:bg-background/85 space-y-2">
              {tableActiveCellKey && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>셀 {tableTargetCells.indexOf(tableActiveCellKey) + 1}/{tableTargetCells.length}</span>
                  {tableCheckedCells.size > 0 && <span className="text-muted-foreground/80 ml-auto">집중 연습 {tableCheckedCells.size}셀</span>}
                </div>
              )}
              {/* 입력창 */}
              <textarea
                data-practice-input="table"
                ref={tableCellInputRef}
                value={tableCellInput}
                onChange={(e) => handleTableInputChange(e.target.value)}
                onKeyDown={handleTableKeyDown}
                onCompositionStart={() => setIsTableComposing(true)}
                onCompositionEnd={(e) => {
                  setIsTableComposing(false);
                  if (tableInputResettingRef.current) {
                    e.currentTarget.value = '';
                    return;
                  }
                  handleTableInputChange((e.target as HTMLTextAreaElement).value);
                }}
                className="w-full rounded-xl border-2 border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring caret-foreground text-sm leading-6 px-5 py-3"
                style={{
                  minHeight: `${inputPanelMinHeightPx}px`,
                  maxHeight: "320px",
                }}
                placeholder="칸을 채우며 외워보세요. 떠오르는 답을 바로 입력해보세요."
                autoFocus
              />
              {/* 연습 횟수 + 초기화 */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">연습장 모드: 띄어쓰기·한/영 전환 없이 입력해도 돼요. Enter로 현재 셀 확인, ↑/↓로 위아래 셀 이동, 셀 더블클릭/우클릭으로 집중 연습 설정이 가능해요.</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">연습 {practiceCount}회</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setTableCompletedCells(new Set());
                      setTableActiveCellIdx(0);
                      setTableWrongCells(new Set());
                      clearTableInput(true);
                    }}
                  >
                    초기화
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 하단 고정 입력 패널 - 텍스트 모드 전용 */}
      {!isImageQuestion && !isTableQuestion && (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <div className="mx-auto w-full max-w-[1360px] px-2 sm:px-3 lg:px-4">
            <div className="mt-2 shrink-0 rounded-t-2xl border-x border-t border-border bg-background/95 px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 shadow-[0_-10px_24px_rgba(0,0,0,0.08)] backdrop-blur supports-[backdrop-filter]:bg-background/85 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">연습장 모드: 띄어쓰기·엔터·한/영 전환 없이 입력해도 돼요. 초성 입력도 인정됩니다.</span>
                  <span
                    key={`line-indicator-vertical-${activePracticeLineNumber}`}
                    className={`text-[11px] transition-all duration-700 ${
                      lineIndicatorPulse
                        ? "opacity-100 text-primary"
                        : "opacity-65 text-muted-foreground"
                    }`}
                  >
                    {activePracticeLineNumber}번째 줄 연습 중
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">연습 {practiceCount}회</span>
                </div>
              </div>

              {!useHorizontalInputLayout && (
                <textarea
                  data-practice-input="main"
                  ref={textareaRef}
                  value={userInput}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyUp}
                  className="w-full rounded-xl border-2 border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring caret-foreground text-xl font-semibold leading-relaxed tracking-tight px-5 py-3 placeholder:text-sm placeholder:font-normal placeholder:tracking-normal"
                  style={{
                    minHeight: `${inputPanelMinHeightPx}px`,
                    maxHeight: "320px",
                  }}
                  placeholder="연습장처럼 편하게 입력해보세요. 떠오르는 내용부터 적어도 괜찮아요."
                />
              )}
            </div>
          </div>
        </div>
      )}

      {showInactiveAlert && (
        <div className="fixed bottom-6 right-6 bg-slate-100 border border-slate-300 rounded-lg p-4 shadow-lg max-w-sm animate-in fade-in duration-300 z-50">
          <p className="text-sm text-slate-700 leading-relaxed">
            입력이 없어 연습 시간 기록이 일시 정지되었습니다.
            <br />
            입력을 시작하면 자동으로 다시 기록됩니다.
          </p>
        </div>
      )}



      {/* 안정도 변화 그래프 모달 */}
      {!isDemo && question && (
        <ConfidenceHistoryModal
          questionId={question.id}
          questionTitle={question.question}
          open={showConfidenceHistory}
          onClose={() => setShowConfidenceHistory(false)}
          examDatePrediction={(confidenceData as any)?.examDatePrediction ?? null}
        />
      )}

      {/* 주의구간은 배지 아래 팝업 박스로 표시 (Dialog 불필요) */}
    </div>
  );
}
