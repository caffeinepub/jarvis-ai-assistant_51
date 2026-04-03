# YAC - Iron Man AI Assistant

## Current State
Version 26 is deployed with live IST clocks in both the HUD header and stats panel. The AI system prompt uses `new Date().toISOString()` which produces UTC time with no timezone context.

## Requested Changes (Diff)

### Add
- IST timezone context in the AI system prompt so YAC always references Indian Standard Time (UTC+5:30) when answering time-related questions

### Modify
- `callYAC` function: update `systemPrompt` to include current IST date/time string and mention IST as the user's timezone

### Remove
- Nothing

## Implementation Plan
1. In `callYAC` function (~line 85), compute current IST time and include it in the system prompt
2. The prompt should tell YAC: "Current time is [IST time]. The user's timezone is IST (UTC+5:30). Always reference IST when discussing time."
