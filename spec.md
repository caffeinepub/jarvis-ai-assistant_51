# YAC - AI Assistant Upgrade v22

## Current State
YAC is an Iron Man-themed AI voice assistant (HUD interface, arc reactor orb, gold/red color scheme) running on React/TypeScript frontend. It uses Pollinations.ai ChatGPT (4 models in parallel), Internet Identity auth, voice input/output, wake word "jar", auto-scrolling chat panel. Token limit is 250, timeout is 6s.

## Requested Changes (Diff)

### Add
- Live clock/date widget displayed in the HUD corner at all times
- Quick-action HUD buttons: NEWS, WEATHER, SPORTS, TIME -- tapping instantly sends that query to the AI
- "Thinking" / processing animation while AI is generating a response
- Conversation history persisted to localStorage and restored on reload
- Better mic error recovery -- clear error messages, auto-retry logic
- More reliable wake word detection with debounce and continuous restart

### Modify
- Increase max_tokens from 250 to 400 for fuller answers
- Improve system prompt: instruct AI to be direct, fast, include real-time context (today's date + time)
- Wake word detection: more resilient restart loop, less likely to silently stop
- Mic button: show specific error reason (permission denied, no speech, network)

### Remove
- Nothing removed

## Implementation Plan
1. Add live clock state that updates every second, render in HUD
2. Add quick-action buttons row below the chat panel: NEWS, WEATHER, SPORTS, TIME
3. Add thinking/processing animation (pulsing dots or HUD scan-line) shown while awaiting AI response
4. Save/load conversation messages to/from localStorage key `yac-history`
5. Update system prompt to include current date+time and instruct concise but complete answers
6. Increase max_tokens to 400
7. Improve SpeechRecognition restart loop: use onend to always restart when wake word mode is active, with a small delay
8. Improve mic error handling: map error codes to user-friendly HUD messages
