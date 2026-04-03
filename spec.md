# YAC AI Assistant - Version 24

## Current State
Full Iron Man-themed AI voice assistant (YAC) with:
- Internet Identity login gate
- HUD-style interface: arc reactor orb, HUD brackets, hex grid background, gold/red theme
- Pollinations.ai ChatGPT backend: 6 GET models in parallel, 4 POST fallback
- Voice input (mic button + wake word "jar")
- Text input with Enter key support
- TTS voice output (deep robotic voice)
- Live clock, quick-action buttons (NEWS/WEATHER/SPORTS/TIME)
- Thinking animation, persistent chat history (localStorage)
- Wake word toggle
- No camera feature

## Requested Changes (Diff)

### Add
- **Camera HUD panel**: on/off toggle button in the HUD; live camera feed shown as Iron Man-style surveillance overlay (small panel top-right area)
- **Vision AI**: capture a snapshot from camera feed and send to AI for description ("What do you see?" style)
- **More AI models**: add `gpt-4`, `claude`, `command-r`, `qwen` to the parallel model pool (via Pollinations.ai)
- **Smart AI routing**: inject model-preference hint into system prompt for complex questions
- **Mic auto-retry**: if mic fails, automatically retry once before showing error
- **Better speech sensitivity**: use `interimResults: true` during command recognition so partial matches trigger faster
- **Emotion/tone detection**: analyze user query keywords (urgent, happy, curious, angry) and have YAC respond with matching tone prefix
- **Multi-language support**: detect non-English input, instruct AI to respond in same language
- **Command shortcuts**: detect prefixes "calculate", "translate", "summarize" in query and append context to system prompt for specialized mode
- **Status indicator for camera**: show "CAM ACTIVE" / "CAM OFF" in SystemStatusPanel

### Modify
- **AI timeout**: reduce from 12s to 5s per request for faster guaranteed responses
- **Token cap**: keep at 400 but trim system prompt to be more concise
- **Parallel strategy**: race even more models simultaneously (up to 10 in the first wave)
- **Mic toggleListening**: add one auto-retry on failure before surfacing error
- **SystemStatusPanel**: add CAMERA row showing cam state

### Remove
- Nothing removed

## Implementation Plan
1. Add camera state variables: `cameraOn` (boolean), `cameraStream` (MediaStream ref), `videoRef` (HTMLVideoElement ref)
2. Add `toggleCamera()` function: calls `getUserMedia({ video: true })` to start, stops tracks to end
3. Add camera HUD overlay panel: positioned as floating panel with Iron Man surveillance styling, renders `<video>` element
4. Add snapshot + vision AI: "SCAN" button inside camera panel captures canvas frame, converts to base64, sends as text prompt "Describe this image: [base64]" (Pollinations.ai text endpoint only - no vision API, so describe via text prompt workaround)
5. Expand AI model pool in `callGeminiAPI`: add `claude`, `command-r`, `qwen-coder`, `gpt-4o` to GET wave
6. Reduce GET/POST timeout to 5s
7. Add emotion detection utility: scan query for keyword sets, return tone tag
8. Add language detection: simple heuristic (non-ASCII > 30%) to flag non-English, append to system prompt
9. Add command shortcut detection: check query prefix for calculate/translate/summarize, inject role into system prompt
10. Add mic auto-retry logic in `toggleListening`
11. Add CAMERA row to SystemStatusPanel
12. Validate and build
