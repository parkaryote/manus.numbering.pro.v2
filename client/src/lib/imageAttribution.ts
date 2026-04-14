export type AttributionLine = {
  text: string;
  href?: string;
};

export type ImageAttribution = {
  lines: AttributionLine[];
};

const COMMONS_SKULL_FILE_PAGE =
  "https://commons.wikimedia.org/wiki/File:Human_skull_side_simplified_(bones).svg";

const COMMONS_SKULL_URL_PATTERNS = [
  "human_skull_side_simplified_(bones).svg",
  "human_skull_side_simplified_%28bones%29.svg",
];

const IMAGE_ATTRIBUTION_BY_QUESTION_ID: Record<number, ImageAttribution> = {
  570001: {
    lines: [
      { text: "© Ksiom, Kwj2772 / Wikimedia Commons" },
      { text: "라이선스: Public Domain" },
    ],
  },
  570002: {
    lines: [{ text: "© Jonathan Richter · https://richterguitar.com" }],
  },
  600004: {
    lines: [{ text: "머리 및 목 해부학 2021 개정판 · 저자: 김명국, p.10" }],
  },
};

function isWikimediaSkullImageUrl(imageUrl?: string | null): boolean {
  if (!imageUrl) return false;
  const normalized = imageUrl.toLowerCase();
  return COMMONS_SKULL_URL_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function getImageAttribution(
  questionId?: number | null,
  imageUrl?: string | null
): ImageAttribution | null {
  if (isWikimediaSkullImageUrl(imageUrl)) {
    return {
      lines: [
        { text: "출처: Wikimedia Commons", href: COMMONS_SKULL_FILE_PAGE },
        { text: "저작자: LadyofHats · Mysid · Shizhao" },
        { text: "라이선스: Public Domain" },
      ],
    };
  }

  if (!questionId) return null;
  return IMAGE_ATTRIBUTION_BY_QUESTION_ID[questionId] ?? null;
}
