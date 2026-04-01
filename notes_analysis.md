# Practice.tsx Analysis Notes

## Current State
- DB schema: memo field exists in questions table
- Server: questions.saveMemo mutation exists
- Client states: memo, memoOpen, memoSaving, memoSaved, repeatLineIdx, repeatCount, editMode, editQuestion, editAnswer
- Handlers: handleSaveMemo, startRepeatLine, stopRepeatLine, startEditMode, handleSaveEdit exist
- Missing: UI for memo panel, line repeat UI, edit mode UI
- Issue: handleCorrectAnswer has duplicate createSession calls (lines 806-812 and 859-874)

## Features to implement
1. Memo UI - collapsible panel with save button, distinct from scratch pad
2. Line repeat UI - click line to start repeat, show count
3. Edit mode UI - button in header, inline edit form
4. Speed bonus in Test.tsx
5. Grid yellow verification
6. Clean up duplicate createSession in handleCorrectAnswer
