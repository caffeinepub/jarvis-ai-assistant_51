# YAC - India-Focused News & Continuous Listening

## Current State
YAC is an Iron Man-themed AI assistant with voice/text input, HUD interface, IST clock, quick-action buttons (NEWS/WEATHER/SPORTS/TIME), camera feed, wake word detection, and Pollinations.ai backend. The NEWS/WEATHER/SPORTS quick-action buttons ask generic global questions. Voice listening is single-shot (waits for a command, then stops).

## Requested Changes (Diff)

### Add
- Continuous always-on listening mode: after each voice command is processed, mic automatically restarts and keeps listening without the user needing to tap the mic button again
- Visual indicator in mic area showing continuous mode is active

### Modify
- NEWS quick-action button query: change from generic to India-specific ("What are the top news headlines in India right now today?")
- WEATHER quick-action button query: add India context ("What is the current weather in major Indian cities today?")
- SPORTS quick-action button query: add India context ("What are the latest cricket and sports scores and results in India today?")
- AI system prompt: add India-awareness so AI defaults to India context when answering news, sports, weather queries
- After a voice command is submitted (via mic button), automatically restart listening so user doesn't have to tap again — continuous single-shot mode
- When listening finishes and a result is sent, immediately restart recognition after the AI responds (or after a short delay)

### Remove
- Nothing removed

## Implementation Plan
1. Update quick-action button queries to be India-focused (NEWS → India news, WEATHER → India weather, SPORTS → cricket/India sports)
2. Update AI system prompt to include India context: default to India for news/sports/weather unless user specifies otherwise
3. Add continuous listening state (`continuousListening`): after `sendMessage` completes (AI responds), automatically call `toggleListening()` again
4. When mic button is used for a command and a result is received, after `speakText` begins, restart listening after a 2-3s delay (enough time for speech synthesis to start)
5. Add visual badge/indicator showing "CONTINUOUS MODE" when this auto-restart behavior is active
6. The behavior is always-on (not a separate toggle) — continuous listening is the default behavior when the mic button is used
