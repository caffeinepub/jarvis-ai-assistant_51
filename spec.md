# YAC AI Assistant — Real-Time Answers (Version 36)

## Current State

YAC (Version 35) is an Iron Man-themed AI voice assistant with:
- Sequential AI backend using Pollinations.ai (`openai-fast` primary), OpenRouter and HuggingFace as fallbacks
- System prompt includes current IST datetime so AI "knows" the date
- Quick-action buttons (NEWS, WEATHER, SPORTS, TIME) that send plain text queries to the AI
- Camera vision AI with Hugging Face BLIP/ViT-GPT2 models
- Wake word, continuous listening, India context defaults

The AI answers are based on the model's training data only. For news, weather, sports, and current events, the AI makes up plausible-sounding but potentially stale or wrong answers because the underlying models have no live data access.

## Requested Changes (Diff)

### Add
- **Real-time data fetcher**: Before sending any query to the AI, detect if the query is about news, weather, sports, time, or current events. If so, fetch live data from free public APIs:
  - **News**: GNews API (free tier, no key for basic) or RSS-to-JSON via rss2json.com for India news (Times of India, NDTV)
  - **Weather**: wttr.in (free, no API key) for current weather in Indian cities
  - **Sports/Cricket**: Cricbuzz RSS via rss2json.com or cricapi.com free endpoints for live cricket scores
  - **Time**: Already handled by network time sync (WorldTimeAPI)
- **Context injection**: Prepend the fetched live data as context to the AI prompt so the AI generates an answer grounded in real current data
- **Real-time badge**: Show a small "LIVE" badge in the chat when a response was augmented with real data
- **Quick-action button enhancement**: NEWS, WEATHER, SPORTS buttons now pre-fetch live data before asking the AI

### Modify
- `callYAC` function: Accept an optional `liveContext` string parameter that gets prepended to the system prompt when available
- Query intent detection: Classify queries as `news | weather | sports | time | general` before processing
- Quick-action handlers: Trigger live data fetch for NEWS, WEATHER, SPORTS before AI call
- Chat message display: Show `[LIVE]` badge on messages that used real-time data
- System prompt: Instruct AI to use provided live context and not fabricate facts

### Remove
- Nothing removed — this is an additive layer on top of the existing AI backend

## Implementation Plan

1. **Add query intent classifier**: simple regex/keyword function `classifyQuery(text)` returns `news | weather | sports | time | general`
2. **Add live data fetchers** (all free, no API key):
   - `fetchLiveNews()`: rss2json.com with NDTV/Times of India RSS feeds — returns top 5 headlines as text
   - `fetchLiveWeather(city?)`: wttr.in JSON API for Mumbai/Delhi/Bangalore — returns current conditions
   - `fetchLiveCricket()`: cricbuzz RSS via rss2json.com — returns live scores/match summary
3. **Add `fetchLiveContext(query)` function**: Calls appropriate fetcher based on intent, returns context string or empty string if failed (graceful degradation — falls back to plain AI call)
4. **Update `callYAC`**: Accept `liveContext` param, inject into system prompt before main prompt
5. **Update `handleSendMessage`**: Call `fetchLiveContext` first, then pass context to `callYAC`
6. **Update quick-action buttons**: Pass pre-defined context hints
7. **Update `ChatMessage` type**: Add optional `isLive?: boolean` field
8. **Update chat display**: Show gold `[LIVE]` badge on live-augmented assistant messages
9. **Validate and deploy**
