/**
 * OCR Service - Server-only module
 * 
 * 이 모듈은 서버 전용이며, 클라이언트 번들에 포함되지 않습니다.
 * Google Cloud Vision API를 사용하여 PDF/PPT/이미지에서 텍스트를 추출합니다.
 */

// OCR 구현은 여기에 추가됩니다
// @google-cloud/vision, @google-cloud/storage 등의 패키지는
// 이 파일에서만 import되어야 합니다.

export async function extractTextFromDocument(fileUrl: string): Promise<string> {
  // TODO: OCR 로직 구현
  return "";
}
