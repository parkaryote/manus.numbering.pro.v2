/**
 * GA4 Custom Events Tracking Utility
 * 
 * Provides type-safe functions to track user interactions with Google Analytics 4
 * All events are automatically sent to GA4 if gtag is available
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

/**
 * Track a custom event with GA4
 * @param eventName - Event name (e.g., 'question_attempt', 'practice_complete')
 * @param eventData - Event parameters (optional)
 */
export function trackEvent(eventName: string, eventData?: Record<string, any>) {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('[GA4] gtag not available, event not tracked:', eventName);
    return;
  }

  try {
    window.gtag('event', eventName, eventData || {});
    console.debug('[GA4] Event tracked:', eventName, eventData);
  } catch (error) {
    console.error('[GA4] Failed to track event:', eventName, error);
  }
}

/**
 * Track question attempt event
 * @param questionId - Question ID
 * @param subjectId - Subject ID
 * @param questionType - Type of question ('text' | 'image' | 'table')
 * @param isCorrect - Whether the answer was correct
 * @param timeSpent - Time spent on the question (seconds)
 */
export function trackQuestionAttempt(
  questionId: number,
  subjectId: number,
  questionType: 'text' | 'image' | 'table',
  isCorrect: boolean,
  timeSpent: number
) {
  trackEvent('question_attempt', {
    question_id: questionId,
    subject_id: subjectId,
    question_type: questionType,
    is_correct: isCorrect,
    time_spent_seconds: Math.round(timeSpent),
  });
}

/**
 * Track practice session completion
 * @param subjectId - Subject ID
 * @param questionId - Question ID
 * @param practiceCount - Number of practice attempts
 * @param totalTime - Total time spent (seconds)
 * @param accuracy - Accuracy percentage (0-100)
 */
export function trackPracticeComplete(
  subjectId: number,
  questionId: number,
  practiceCount: number,
  totalTime: number,
  accuracy: number
) {
  trackEvent('practice_complete', {
    subject_id: subjectId,
    question_id: questionId,
    practice_count: practiceCount,
    total_time_seconds: Math.round(totalTime),
    accuracy_percent: Math.round(accuracy),
  });
}

/**
 * Track test submission
 * @param subjectId - Subject ID
 * @param testScore - Test score (0-100)
 * @param totalQuestions - Total number of questions in test
 * @param correctAnswers - Number of correct answers
 * @param timeSpent - Time spent on test (seconds)
 */
export function trackTestSubmit(
  subjectId: number,
  testScore: number,
  totalQuestions: number,
  correctAnswers: number,
  timeSpent: number
) {
  trackEvent('test_submit', {
    subject_id: subjectId,
    test_score: Math.round(testScore),
    total_questions: totalQuestions,
    correct_answers: correctAnswers,
    time_spent_seconds: Math.round(timeSpent),
  });
}

/**
 * Track subject creation
 * @param subjectId - Subject ID
 * @param subjectName - Subject name
 */
export function trackSubjectCreate(subjectId: number, subjectName: string) {
  trackEvent('subject_create', {
    subject_id: subjectId,
    subject_name: subjectName,
  });
}

/**
 * Track subject update
 * @param subjectId - Subject ID
 * @param subjectName - Subject name
 */
export function trackSubjectUpdate(subjectId: number, subjectName: string) {
  trackEvent('subject_update', {
    subject_id: subjectId,
    subject_name: subjectName,
  });
}

/**
 * Track subject deletion
 * @param subjectId - Subject ID
 * @param subjectName - Subject name
 */
export function trackSubjectDelete(subjectId: number, subjectName: string) {
  trackEvent('subject_delete', {
    subject_id: subjectId,
    subject_name: subjectName,
  });
}

/**
 * Track question creation
 * @param questionId - Question ID
 * @param subjectId - Subject ID
 * @param questionType - Type of question ('text' | 'image' | 'table')
 */
export function trackQuestionCreate(
  questionId: number,
  subjectId: number,
  questionType: 'text' | 'image' | 'table'
) {
  trackEvent('question_create', {
    question_id: questionId,
    subject_id: subjectId,
    question_type: questionType,
  });
}

/**
 * Track question update
 * @param questionId - Question ID
 * @param subjectId - Subject ID
 * @param questionType - Type of question ('text' | 'image' | 'table')
 */
export function trackQuestionUpdate(
  questionId: number,
  subjectId: number,
  questionType: 'text' | 'image' | 'table'
) {
  trackEvent('question_update', {
    question_id: questionId,
    subject_id: subjectId,
    question_type: questionType,
  });
}

/**
 * Track question deletion
 * @param questionId - Question ID
 * @param subjectId - Subject ID
 */
export function trackQuestionDelete(questionId: number, subjectId: number) {
  trackEvent('question_delete', {
    question_id: questionId,
    subject_id: subjectId,
  });
}

/**
 * Track OCR job start
 * @param fileName - File name
 * @param fileSize - File size (bytes)
 */
export function trackOCRStart(fileName: string, fileSize: number) {
  trackEvent('ocr_start', {
    file_name: fileName,
    file_size_bytes: fileSize,
  });
}

/**
 * Track OCR job completion
 * @param fileName - File name
 * @param extractedTextLength - Length of extracted text
 * @param processingTime - Processing time (seconds)
 */
export function trackOCRComplete(
  fileName: string,
  extractedTextLength: number,
  processingTime: number
) {
  trackEvent('ocr_complete', {
    file_name: fileName,
    extracted_text_length: extractedTextLength,
    processing_time_seconds: Math.round(processingTime),
  });
}

/**
 * Track OCR job failure
 * @param fileName - File name
 * @param errorMessage - Error message
 */
export function trackOCRError(fileName: string, errorMessage: string) {
  trackEvent('ocr_error', {
    file_name: fileName,
    error_message: errorMessage,
  });
}

/**
 * Track user engagement
 * @param engagementType - Type of engagement ('login' | 'logout' | 'page_view')
 * @param metadata - Additional metadata (optional)
 */
export function trackEngagement(
  engagementType: 'login' | 'logout' | 'page_view' | 'demo_mode',
  metadata?: Record<string, any>
) {
  trackEvent(`user_${engagementType}`, metadata || {});
}
