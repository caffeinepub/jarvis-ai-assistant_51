# Jarvis AI Assistant

## Current State
No existing source files. Rebuilding from scratch.

## Requested Changes (Diff)

### Add
- Dark HUD interface with animated plasma orb
- Voice input via Web Speech API (SpeechRecognition)
- Voice output via Web Speech Synthesis API (deep/robotic voice)
- Internet-connected AI answers via backend HTTP outcalls to a free AI/search API (DuckDuckGo Instant Answer API)
- Text input fallback for non-voice browsers
- Query display and response display

### Modify
N/A

### Remove
N/A

## Implementation Plan
1. Backend: HTTP outcall to DuckDuckGo Instant Answer API (free, no key needed) — `query(text: Text) : async Text`
2. Frontend: Dark HUD UI with animated orb, SpeechRecognition for input, SpeechSynthesis for spoken output, wired to backend query function
