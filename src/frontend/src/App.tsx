import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  Camera,
  ChevronRight,
  Globe,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationEntry } from "./backend";
import { useActor } from "./hooks/useActor";
import { useInternetIdentity } from "./hooks/useInternetIdentity";
import { useGetAllMessages, useIsConnected } from "./hooks/useQueries";

// ─── Network Time Sync ────────────────────────────────────────────────────────
// Network time sync — offset between network UTC and device UTC (ms)
let _networkTimeOffsetMs = 0;
let _networkTimeSynced = false;

async function syncNetworkTime(): Promise<void> {
  try {
    // Try WorldTimeAPI first (returns IST directly)
    const res = await fetch(
      "https://worldtimeapi.org/api/timezone/Asia/Kolkata",
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const data = await res.json();
      // data.unixtime is seconds since epoch (UTC)
      const networkUtcMs = data.unixtime * 1000;
      _networkTimeOffsetMs = networkUtcMs - Date.now();
      _networkTimeSynced = true;
      return;
    }
  } catch {
    /* ignore */
  }
  try {
    // Fallback: timeapi.io
    const res2 = await fetch(
      "https://timeapi.io/api/time/current/zone?timeZone=Asia%2FKolkata",
      { signal: AbortSignal.timeout(4000) },
    );
    if (res2.ok) {
      const d = await res2.json();
      // d.dateTime is ISO string in IST
      const networkUtcMs =
        new Date(d.dateTime).getTime() - 5.5 * 60 * 60 * 1000;
      _networkTimeOffsetMs = networkUtcMs - Date.now();
      _networkTimeSynced = true;
    }
  } catch {
    /* ignore, use device time */
  }
}

function getNetworkAdjustedDate(): Date {
  return new Date(Date.now() + _networkTimeOffsetMs);
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  timestamp: number;
  isLive?: boolean;
}

// ─── Emotion Detection ───────────────────────────────────────────────────────
function detectEmotion(text: string): string {
  const lower = text.toLowerCase();
  if (
    /\b(urgent|emergency|now|asap|help|sos|critical|immediately)\b/.test(lower)
  )
    return "urgent";
  if (
    /\b(happy|great|awesome|love|excited|wonderful|amazing|fantastic)\b/.test(
      lower,
    )
  )
    return "positive";
  if (
    /\b(why|how|what|explain|curious|tell me|describe|understand)\b/.test(lower)
  )
    return "curious";
  return "neutral";
}

// ─── Language Detection ───────────────────────────────────────────────────────
function needsMultilingualHint(text: string): boolean {
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) nonAscii++;
  }
  return text.length > 0 && nonAscii / text.length > 0.2;
}

// ─── In-flight deduplication ─────────────────────────────────────────────────
const _inFlightRequests = new Map<string, Promise<string>>();

// ─── Connectivity check ────────────────────────────────────────────────────
async function checkConnectivity(): Promise<boolean> {
  // Try multiple lightweight endpoints to verify online status
  const tests = [
    fetch("https://text.pollinations.ai/", {
      method: "HEAD",
      signal: AbortSignal.timeout(2000),
    }),
    fetch("https://www.google.com/generate_204", {
      method: "HEAD",
      signal: AbortSignal.timeout(2000),
    }),
    fetch("https://api.pollinations.ai/v1/models", {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    }).catch(() => {}),
  ];
  try {
    const results = await Promise.allSettled(tests);
    return results.some((r) => r.status === "fulfilled");
  } catch {
    return false;
  }
}

// ─── Pre-warm connections ────────────────────────────────────────────────────
// Pre-warm connection to reduce cold-start latency
function preWarmConnection(): void {
  fetch("https://text.pollinations.ai/", {
    method: "HEAD",
    signal: AbortSignal.timeout(5000),
    keepalive: true,
  }).catch(() => {});
  fetch("https://api.pollinations.ai/v1/models", {
    method: "GET",
    signal: AbortSignal.timeout(5000),
    keepalive: true,
  }).catch(() => {});
}

// ─── AI Backend ───────────────────────────────────────────────────────────────
// ─── Query Intent Classifier ────────────────────────────────────────────────
function classifyQuery(
  text: string,
): "news" | "weather" | "sports" | "time" | "general" {
  const lower = text.toLowerCase();
  if (/\b(news|headline|happening|today|latest|current event)\b/.test(lower))
    return "news";
  if (/\b(weather|temperature|rain|forecast|humidity|climate)\b/.test(lower))
    return "weather";
  if (/\b(cricket|ipl|score|match|wicket|team|football|sport)\b/.test(lower))
    return "sports";
  if (/\b(time|clock|hour|minute|ist)\b/.test(lower)) return "time";
  return "general";
}

// ─── Live Data Fetchers ───────────────────────────────────────────────────────
async function fetchLiveNews(): Promise<string> {
  try {
    const res = await fetch(
      "https://api.rss2json.com/v1/api.json?rss_url=https://feeds.feedburner.com/ndtvnews-india-news&count=5",
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const data = await res.json();
      const items = data?.items;
      if (Array.isArray(items) && items.length > 0) {
        const headlines = items
          .slice(0, 5)
          .map((it: { title: string }) => `• ${it.title}`)
          .join("\n");
        return `LIVE INDIA NEWS HEADLINES:\n${headlines}`;
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const res2 = await fetch(
      "https://api.rss2json.com/v1/api.json?rss_url=https://timesofindia.indiatimes.com/rssfeedstopstories.cms&count=5",
      { signal: AbortSignal.timeout(4000) },
    );
    if (res2.ok) {
      const data2 = await res2.json();
      const items2 = data2?.items;
      if (Array.isArray(items2) && items2.length > 0) {
        const headlines2 = items2
          .slice(0, 5)
          .map((it: { title: string }) => `• ${it.title}`)
          .join("\n");
        return `LIVE INDIA NEWS HEADLINES:\n${headlines2}`;
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}

async function fetchLiveWeather(city = "Mumbai"): Promise<string> {
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const data = await res.json();
      const current = data?.current_condition?.[0];
      if (current) {
        const temp = current.temp_C;
        const feels = current.FeelsLikeC;
        const desc = current.weatherDesc?.[0]?.value;
        const humidity = current.humidity;
        const wind = current.windspeedKmph;
        return `LIVE WEATHER IN ${city.toUpperCase()}: ${temp}°C (feels like ${feels}°C), ${desc}, humidity ${humidity}%, wind ${wind} km/h`;
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}

async function fetchLiveCricket(): Promise<string> {
  try {
    const res = await fetch(
      "https://api.rss2json.com/v1/api.json?rss_url=https://www.cricbuzz.com/rss/cricket-news&count=5",
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const data = await res.json();
      const items = data?.items;
      if (Array.isArray(items) && items.length > 0) {
        const scores = items
          .slice(0, 5)
          .map((it: { title: string }) => `• ${it.title}`)
          .join("\n");
        return `LIVE CRICKET UPDATES:\n${scores}`;
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}

async function fetchLiveContext(query: string): Promise<string> {
  const intent = classifyQuery(query);
  if (intent === "news") return fetchLiveNews();
  if (intent === "weather") {
    const cityMatch = query.match(/weather (?:in |at |of )?([a-zA-Z ]+)/i);
    const city = cityMatch?.[1]?.trim() || "Mumbai";
    return fetchLiveWeather(city);
  }
  if (intent === "sports") return fetchLiveCricket();
  if (intent === "time") return ""; // already handled by network time sync
  return "";
}

// Sequential-first strategy to avoid Pollinations.ai IP rate limiting.
// Parallel requests from the same IP trigger 429s. We try one model at a time,
// then fall back to alternative free AI providers (OpenRouter, Groq).
async function _callYACInner(
  query: string,
  modeHint?: string,
  liveContext?: string,
): Promise<string> {
  const nowUtc = getNetworkAdjustedDate();
  const istMs =
    nowUtc.getTime() +
    5.5 * 60 * 60 * 1000 -
    nowUtc.getTimezoneOffset() * 60 * 1000;
  const istDate = new Date(istMs);
  const istStr = istDate.toUTCString().replace("GMT", "IST");
  let systemPrompt = `You are YAC, Iron Man\'s AI assistant based in India. Current time is ${istStr} (IST, UTC+5:30). Always reference IST when discussing time. When asked about news, weather, sports, or current events without a specific location, default to India. Be concise under 100 words.`;

  if (modeHint) {
    systemPrompt += ` ${modeHint}`;
  }

  // Inject real-time context if available
  if (liveContext && liveContext.length > 0) {
    systemPrompt += `\n\nREAL-TIME DATA (use this for your answer, do not fabricate additional facts):\n${liveContext}`;
  }

  const fullPrompt = `${systemPrompt}\n\nUser: ${query}\n\nAssistant:`;

  // ── Helper: GET request to text.pollinations.ai ──
  const tryGet = async (model: string, timeoutMs: number): Promise<string> => {
    const encoded = encodeURIComponent(fullPrompt);
    const url = `https://text.pollinations.ai/${encoded}?model=${model}&nologo=true`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      keepalive: true,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (
      !text?.trim() ||
      text.trim().startsWith("{") ||
      text.trim().startsWith("<") ||
      text.trim().length < 5
    )
      throw new Error("Invalid response");
    return text.trim();
  };

  // ── Helper: POST request to text.pollinations.ai/openai ──
  const tryPost = async (model: string, timeoutMs: number): Promise<string> => {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query },
        ],
        model,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      keepalive: true,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty response");
    return text;
  };

  // ── Helper: OpenRouter free tier (no API key required for free models) ──
  const tryOpenRouter = async (timeoutMs: number): Promise<string> => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "HTTP-Referer": "https://yac-assistant.app",
        "X-Title": "YAC Assistant",
      },
      body: JSON.stringify({
        model: "mistralai/mistral-7b-instruct:free",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query },
        ],
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      keepalive: true,
    });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty response");
    return text;
  };

  // ── Helper: HuggingFace Inference API text generation (free, no key) ──
  const tryHuggingFaceText = async (timeoutMs: number): Promise<string> => {
    const res = await fetch(
      "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: fullPrompt,
          parameters: { max_new_tokens: 150, return_full_text: false },
        }),
        signal: AbortSignal.timeout(timeoutMs),
        keepalive: true,
      },
    );
    if (!res.ok) throw new Error(`HF HTTP ${res.status}`);
    const data = await res.json();
    const text = Array.isArray(data)
      ? data[0]?.generated_text?.trim()
      : data?.generated_text?.trim();
    if (!text || text.length < 5) throw new Error("Empty response");
    return text;
  };

  // ── Working Pollinations models (as of Apr 2026) ──
  // Use cached winning model first for faster reconnects
  const cachedModel = sessionStorage.getItem("yac_fast_model");
  const MODELS =
    cachedModel &&
    ["openai-fast", "openai", "gpt-oss", "gpt-oss-20b"].includes(cachedModel)
      ? [
          cachedModel,
          ...["openai-fast", "openai", "gpt-oss", "gpt-oss-20b"].filter(
            (m) => m !== cachedModel,
          ),
        ]
      : ["openai-fast", "openai", "gpt-oss", "gpt-oss-20b"];

  // ── Sequential-first strategy: single requests avoid IP rate limiting ──

  // Step 1 — Try cached/best model via GET (fastest single request)
  try {
    const result = await tryGet(MODELS[0], 5000);
    if (result) {
      sessionStorage.setItem("yac_fast_model", MODELS[0]);
      return result;
    }
  } catch {
    /* try next */
  }

  // Step 2 — Try second model via GET (different model, same IP quota resets)
  try {
    const result = await tryGet(MODELS[1], 5000);
    if (result) {
      sessionStorage.setItem("yac_fast_model", MODELS[1]);
      return result;
    }
  } catch {
    /* try next */
  }

  // Step 3 — Try POST endpoint with best model (different endpoint, avoids GET rate limit)
  try {
    const result = await tryPost(MODELS[0], 6000);
    if (result) {
      sessionStorage.setItem("yac_fast_model", MODELS[0]);
      return result;
    }
  } catch {
    /* try next */
  }

  // Step 4 — Race OpenRouter + remaining Pollinations models in parallel
  try {
    const result = await Promise.any([
      tryOpenRouter(7000),
      tryGet(MODELS[2], 6000),
      tryGet(MODELS[3], 6000),
      tryPost(MODELS[1], 7000),
    ]);
    if (result) return result;
  } catch {
    /* try final step */
  }

  // Step 5 — Final fallback: HuggingFace + remaining POST attempts
  try {
    const result = await Promise.any([
      tryHuggingFaceText(10000),
      tryPost(MODELS[2], 8000),
      tryPost(MODELS[3], 8000),
    ]);
    if (result) return result;
  } catch {
    /* all failed */
  }

  return "YAC systems offline. All AI endpoints are unreachable. Please try again in a moment.";
}

// ─── callYAC with in-flight deduplication ────────────────────────────────────
async function callYAC(
  query: string,
  modeHint?: string,
  liveContext?: string,
): Promise<string> {
  const key = query.trim().toLowerCase().slice(0, 100);
  if (_inFlightRequests.has(key)) return _inFlightRequests.get(key)!;
  const promise = _callYACInner(query, modeHint, liveContext).finally(() =>
    _inFlightRequests.delete(key),
  );
  _inFlightRequests.set(key, promise);
  return promise;
}

// ─── Vision AI Backend ────────────────────────────────────────────────────────
// Converts base64 data URL to a Blob for binary API calls
function dataURLtoBlob(dataURL: string): Blob {
  const [header, b64] = dataURL.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function callVisionAI(
  imageBase64: string,
  question: string,
): Promise<string> {
  // Strategy 1: Hugging Face BLIP image captioning (no API key, free tier)
  const tryHuggingFaceBLIP = async (): Promise<string> => {
    const blob = dataURLtoBlob(imageBase64);
    const res = await fetch(
      "https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large",
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) throw new Error(`HF BLIP HTTP ${res.status}`);
    const data = await res.json();
    const caption = Array.isArray(data)
      ? data[0]?.generated_text
      : data?.generated_text;
    if (!caption) throw new Error("No caption");
    // Wrap caption in YAC voice
    return `I can see: ${caption}. ${question.includes("describe") ? "" : "Scanning complete."}`;
  };

  // Strategy 2: Hugging Face ViT-GPT2 image captioning
  const tryHuggingFaceViT = async (): Promise<string> => {
    const blob = dataURLtoBlob(imageBase64);
    const res = await fetch(
      "https://api-inference.huggingface.co/models/nlpconnect/vit-gpt2-image-captioning",
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) throw new Error(`HF ViT HTTP ${res.status}`);
    const data = await res.json();
    const caption = Array.isArray(data)
      ? data[0]?.generated_text
      : data?.generated_text;
    if (!caption) throw new Error("No caption");
    return `Visual analysis complete. I detect: ${caption}.`;
  };

  // Strategy 3: Pollinations with proper OpenAI vision format (base64 inline)
  const tryPollinationsVision = async (): Promise<string> => {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        max_tokens: 150,
        messages: [
          {
            role: "system",
            content:
              "You are YAC, Iron Man's AI. Analyze the image briefly in 1-2 sentences.",
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: imageBase64, detail: "low" },
              },
              { type: "text", text: question },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty");
    return text;
  };

  // Run all strategies in parallel, use first success
  try {
    const result = await Promise.any([
      tryHuggingFaceBLIP(),
      tryHuggingFaceViT(),
      tryPollinationsVision(),
    ]);
    if (result) return result;
  } catch {
    /* all failed */
  }

  return "Visual scan failed. Unable to process image.";
}

// ─── Voice loader helper ──────────────────────────────────────────────────────
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    const onVoicesChanged = () => {
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        onVoicesChanged,
      );
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    setTimeout(() => {
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        onVoicesChanged,
      );
      resolve(window.speechSynthesis.getVoices());
    }, 2000);
  });
}

function pickJarvisVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const lower = (v: SpeechSynthesisVoice) => v.name.toLowerCase();
  const preferred = [
    voices.find((v) => lower(v).includes("google uk english male")),
    voices.find((v) => lower(v).includes("daniel")),
    voices.find((v) => lower(v).includes("alex")),
    voices.find((v) => lower(v).includes("male") && lower(v).includes("en")),
    voices.find((v) => v.lang.startsWith("en") && lower(v).includes("male")),
    voices.find((v) => v.lang.startsWith("en")),
  ];
  return preferred.find(Boolean) ?? voices[0] ?? null;
}

// ─── HUD Corner Brackets ────────────────────────────────────────────────────
function HudCorners({
  color = "oklch(0.78 0.15 75 / 0.7)",
  size = 20,
}: { color?: string; size?: number }) {
  const style = (top: boolean, left: boolean) => ({
    position: "absolute" as const,
    width: size,
    height: size,
    pointerEvents: "none" as const,
    [top ? "top" : "bottom"]: -1,
    [left ? "left" : "right"]: -1,
    borderTop: top ? `2px solid ${color}` : "none",
    borderBottom: !top ? `2px solid ${color}` : "none",
    borderLeft: left ? `2px solid ${color}` : "none",
    borderRight: !left ? `2px solid ${color}` : "none",
  });
  return (
    <>
      <div style={style(true, true)} />
      <div style={style(true, false)} />
      <div style={style(false, true)} />
      <div style={style(false, false)} />
    </>
  );
}

// ─── Arc Reactor Orb ─────────────────────────────────────────────────────────
function ArcReactorOrb({ listening }: { listening: boolean }) {
  const GOLD = "oklch(0.78 0.15 75)";
  const RED = "oklch(0.48 0.22 25)";
  const BLUE = "oklch(0.72 0.18 220)";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 320, height: 320 }}
    >
      {/* Ambient background glow */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: listening
            ? `radial-gradient(circle, ${RED} 0%, transparent 65%)`
            : "radial-gradient(circle, oklch(0.72 0.18 220 / 0.12) 0%, transparent 65%)",
          filter: "blur(28px)",
          opacity: listening ? 0.35 : 0.6,
          transition: "all 0.6s ease",
        }}
      />

      {/* Outermost ring — slow spin, gold tick marks */}
      <div
        className="absolute arc-spin-slow"
        style={{ width: 300, height: 300 }}
      >
        <svg width="300" height="300" viewBox="0 0 300 300" aria-hidden="true">
          <title>Outer reactor ring</title>
          <circle
            cx="150"
            cy="150"
            r="148"
            fill="none"
            stroke={"oklch(0.78 0.15 75 / 0.35)"}
            strokeWidth="1"
          />
          {Array.from({ length: 24 }, (_, i) => {
            const angle = (i * 360) / 24;
            const rad = (angle * Math.PI) / 180;
            const r1 = 144;
            const r2 = i % 6 === 0 ? 134 : i % 3 === 0 ? 138 : 141;
            return (
              <line
                key={angle}
                x1={150 + r1 * Math.cos(rad)}
                y1={150 + r1 * Math.sin(rad)}
                x2={150 + r2 * Math.cos(rad)}
                y2={150 + r2 * Math.sin(rad)}
                stroke={`oklch(0.78 0.15 75 / ${i % 6 === 0 ? "0.8" : "0.4"})`}
                strokeWidth={i % 6 === 0 ? "2" : "1"}
              />
            );
          })}
          {/* Triangle notches at cardinal points */}
          {[0, 90, 180, 270].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            const cx = 150 + 148 * Math.cos(rad);
            const cy = 150 + 148 * Math.sin(rad);
            return (
              <polygon
                key={deg}
                points={`${cx},${cy - 5} ${cx - 4},${cy + 4} ${cx + 4},${cy + 4}`}
                fill={"oklch(0.78 0.15 75 / 0.9)"}
                transform={`rotate(${deg + 90}, ${cx}, ${cy})`}
              />
            );
          })}
        </svg>
      </div>

      {/* Middle ring — reverse spin, hex tick marks */}
      <div
        className="absolute arc-spin-reverse"
        style={{ width: 255, height: 255 }}
      >
        <svg width="255" height="255" viewBox="0 0 255 255" aria-hidden="true">
          <title>Middle reactor ring</title>
          <circle
            cx="127.5"
            cy="127.5"
            r="125"
            fill="none"
            stroke={
              listening
                ? "oklch(0.48 0.22 25 / 0.6)"
                : "oklch(0.78 0.15 75 / 0.25)"
            }
            strokeWidth="1.5"
            strokeDasharray="6 4"
            style={{ transition: "stroke 0.5s ease" }}
          />
          {Array.from({ length: 18 }, (_, i) => {
            const angle = (i * 360) / 18;
            const rad = (angle * Math.PI) / 180;
            const r1 = 121;
            const r2 = 115;
            return (
              <line
                key={angle}
                x1={127.5 + r1 * Math.cos(rad)}
                y1={127.5 + r1 * Math.sin(rad)}
                x2={127.5 + r2 * Math.cos(rad)}
                y2={127.5 + r2 * Math.sin(rad)}
                stroke={
                  listening
                    ? "oklch(0.48 0.22 25 / 0.7)"
                    : "oklch(0.78 0.15 75 / 0.5)"
                }
                strokeWidth="1.5"
              />
            );
          })}
        </svg>
      </div>

      {/* Inner ring — medium spin */}
      <div
        className="absolute arc-spin-medium"
        style={{ width: 210, height: 210 }}
      >
        <svg width="210" height="210" viewBox="0 0 210 210" aria-hidden="true">
          <title>Inner reactor ring</title>
          <circle
            cx="105"
            cy="105"
            r="103"
            fill="none"
            stroke={
              listening
                ? "oklch(0.48 0.22 25 / 0.5)"
                : "oklch(0.78 0.15 75 / 0.45)"
            }
            strokeWidth="2"
            style={{ transition: "stroke 0.5s ease" }}
          />
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i * 360) / 12;
            const rad = (angle * Math.PI) / 180;
            const r1 = 99;
            return (
              <rect
                key={angle}
                x={105 + r1 * Math.cos(rad) - 3}
                y={105 + r1 * Math.sin(rad) - 1.5}
                width="6"
                height="3"
                fill={
                  listening
                    ? "oklch(0.48 0.22 25 / 0.8)"
                    : "oklch(0.78 0.15 75 / 0.7)"
                }
                transform={`rotate(${angle}, ${105 + r1 * Math.cos(rad)}, ${105 + r1 * Math.sin(rad)})`}
              />
            );
          })}
        </svg>
      </div>

      {/* Innermost glowing ring */}
      <div
        className="absolute"
        style={{
          width: 168,
          height: 168,
          borderRadius: "50%",
          border: `2px solid ${listening ? RED : GOLD}`,
          boxShadow: listening
            ? `0 0 20px ${RED}, 0 0 40px oklch(0.48 0.22 25 / 0.4)`
            : "0 0 20px oklch(0.78 0.15 75 / 0.5), 0 0 40px oklch(0.78 0.15 75 / 0.25)",
          transition: "border-color 0.5s ease, box-shadow 0.5s ease",
        }}
      />

      {/* Arc reactor core glow */}
      <div className="absolute arc-pulse" style={{ width: 140, height: 140 }}>
        <div
          className="w-full h-full rounded-full reactor-glow-anim"
          style={{
            background: listening
              ? "radial-gradient(circle at 40% 35%, oklch(0.7 0.22 25 / 0.95), oklch(0.48 0.22 25 / 0.8) 40%, oklch(0.25 0.12 25 / 0.5) 70%, transparent)"
              : `radial-gradient(circle at 40% 35%, oklch(0.95 0.05 220 / 0.95), ${BLUE} 35%, oklch(0.55 0.2 220 / 0.7) 60%, transparent)`,
            boxShadow: listening
              ? `0 0 30px ${RED}, 0 0 60px oklch(0.48 0.22 25 / 0.4)`
              : `0 0 30px oklch(0.85 0.1 220 / 0.8), 0 0 60px ${BLUE}, 0 0 100px oklch(0.72 0.18 220 / 0.3)`,
            filter: "blur(1px)",
            transition: "background 0.5s ease, box-shadow 0.5s ease",
          }}
        />
      </div>

      {/* Center bright core */}
      <div
        className="relative z-10 flex items-center justify-center"
        style={{
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: listening
            ? "radial-gradient(circle, oklch(0.9 0.15 25), oklch(0.6 0.22 25))"
            : `radial-gradient(circle, white, ${BLUE})`,
          boxShadow: listening
            ? `0 0 20px ${RED}, 0 0 40px oklch(0.48 0.22 25 / 0.6)`
            : `0 0 20px white, 0 0 40px ${BLUE}`,
          transition: "all 0.5s ease",
        }}
      >
        <Zap
          size={24}
          style={{
            color: listening ? "oklch(0.95 0.04 25)" : "oklch(0.05 0.01 220)",
          }}
        />
      </div>

      {/* Red pulse rings when listening */}
      <AnimatePresence>
        {listening && (
          <>
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1.15 }}
              exit={{ opacity: 0 }}
              transition={{
                repeat: Number.POSITIVE_INFINITY,
                duration: 1,
                repeatType: "reverse",
              }}
              className="absolute rounded-full pointer-events-none"
              style={{
                width: 190,
                height: 190,
                border: "2px solid oklch(0.48 0.22 25 / 0.7)",
                boxShadow: "0 0 25px oklch(0.48 0.22 25 / 0.5)",
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 1 }}
              animate={{ opacity: 0.4, scale: 1.35 }}
              exit={{ opacity: 0 }}
              transition={{
                repeat: Number.POSITIVE_INFINITY,
                duration: 1.4,
                repeatType: "reverse",
              }}
              className="absolute rounded-full pointer-events-none"
              style={{
                width: 210,
                height: 210,
                border: "1px solid oklch(0.48 0.22 25 / 0.4)",
              }}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Waveform Bar ─────────────────────────────────────────────────────────────
const WAVE_BAR_IDS = Array.from({ length: 32 }, (_, i) => `wave-${i}-static`);

function Waveform({ listening }: { listening: boolean }) {
  return (
    <div
      className="flex items-center justify-center gap-[3px]"
      style={{ height: 48, width: "100%", maxWidth: 360 }}
    >
      {WAVE_BAR_IDS.map((id, i) => (
        <div
          key={id}
          className="rounded-full"
          style={
            {
              width: 4,
              height: listening ? undefined : 3,
              minHeight: 3,
              maxHeight: 40,
              background: listening
                ? `oklch(${0.78 - (i % 3) * 0.05} ${0.15 + (i % 4) * 0.02} ${75 + (i % 5) * 3})`
                : "oklch(0.3 0.1 25)",
              animation: listening
                ? `wave-bar ${0.4 + (i % 7) * 0.08}s ${i * 0.03}s ease-in-out infinite alternate`
                : "none",
              "--wave-height": `${8 + Math.abs(Math.sin(i) * 28)}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

// ─── Chat Transcript Panel ────────────────────────────────────────────────────
function ChatTranscriptPanel({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message count change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div
      data-ocid="chat.panel"
      className="iron-panel rounded-lg p-4 w-full flex flex-col hud-brackets"
      style={{ height: 420, position: "relative" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={14} style={{ color: "oklch(0.78 0.15 75)" }} />
        <span
          className="text-xs font-semibold tracking-widest uppercase tech-font"
          style={{
            color: "oklch(0.78 0.15 75)",
            textShadow: "0 0 8px oklch(0.78 0.15 75 / 0.6)",
          }}
        >
          Chat Transcript
        </span>
        <span
          className="ml-auto text-xs px-2 py-0.5 rounded tech-font"
          style={{
            background: "oklch(0.78 0.15 75 / 0.12)",
            color: "oklch(0.78 0.15 75)",
            border: "1px solid oklch(0.78 0.15 75 / 0.3)",
          }}
        >
          {messages.length}
        </span>
      </div>
      <ScrollArea className="pr-1" style={{ height: "calc(100% - 48px)" }}>
        <div className="space-y-3">
          {messages.length === 0 ? (
            <p
              className="text-xs text-center py-6 tech-font tracking-widest"
              style={{ color: "oklch(0.5 0.04 75)" }}
            >
              AWAITING INPUT...
            </p>
          ) : (
            messages.map((msg, idx) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: msg.role === "user" ? 10 : -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex flex-col gap-0.5 ${msg.role === "user" ? "items-end" : "items-start"}`}
                data-ocid={`chat.item.${idx + 1}`}
              >
                <span
                  className="text-[10px] font-medium tracking-wider uppercase tech-font"
                  style={{
                    color:
                      msg.role === "user"
                        ? "oklch(0.72 0.18 220)"
                        : "oklch(0.78 0.15 75)",
                  }}
                >
                  {msg.role === "user" ? "YOU" : "J.A.R.V.I.S."}
                  {msg.role === "assistant" && msg.isLive && (
                    <span
                      className="text-[8px] font-bold tracking-widest uppercase tech-font px-1.5 py-0.5 rounded"
                      style={{
                        background: "oklch(0.78 0.15 75 / 0.2)",
                        border: "1px solid oklch(0.78 0.15 75 / 0.5)",
                        color: "oklch(0.78 0.15 75)",
                      }}
                    >
                      LIVE
                    </span>
                  )}
                </span>
                <div
                  className="text-xs px-3 py-2 rounded max-w-[90%]"
                  style={{
                    background:
                      msg.role === "user"
                        ? "oklch(0.48 0.22 25 / 0.15)"
                        : "oklch(0.78 0.15 75 / 0.08)",
                    border: `1px solid ${
                      msg.role === "user"
                        ? "oklch(0.48 0.22 25 / 0.4)"
                        : "oklch(0.78 0.15 75 / 0.25)"
                    }`,
                    color: msg.pending
                      ? "oklch(0.5 0.04 75)"
                      : "oklch(0.92 0.04 75)",
                    fontStyle: msg.pending ? "italic" : "normal",
                  }}
                >
                  {msg.content}
                </div>
              </motion.div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── System Status Panel ──────────────────────────────────────────────────────
function SystemStatusPanel({
  connected,
  messageCount,
  uptime,
  cameraOn,
}: {
  connected: boolean;
  messageCount: number;
  uptime: string;
  cameraOn: boolean;
}) {
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = getNetworkAdjustedDate();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const ist = new Date(
        now.getTime() + istOffset - now.getTimezoneOffset() * 60 * 1000,
      );
      const hh = String(ist.getUTCHours()).padStart(2, "0");
      const mm = String(ist.getUTCMinutes()).padStart(2, "0");
      const ss = String(ist.getUTCSeconds()).padStart(2, "0");
      setCurrentTime(`${hh}:${mm}:${ss} IST`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const metrics = [
    {
      label: "CONNECTION",
      value: connected ? "ONLINE" : "OFFLINE",
      color: connected ? "oklch(0.7 0.18 145)" : "oklch(0.65 0.25 25)",
      dot: true,
    },
    {
      label: "QUERIES",
      value: String(messageCount),
      color: "oklch(0.78 0.15 75)",
    },
    { label: "IST TIME", value: currentTime, color: "oklch(0.72 0.18 220)" },
    { label: "UPTIME", value: uptime, color: "oklch(0.65 0.18 220)" },
    { label: "STATUS", value: "OPERATIONAL", color: "oklch(0.7 0.18 145)" },
    { label: "POWER", value: "100%", color: "oklch(0.78 0.15 75)" },
    {
      label: "CAMERA",
      value: cameraOn ? "ACTIVE" : "OFFLINE",
      color: cameraOn ? "oklch(0.78 0.15 75)" : "oklch(0.45 0.15 25)",
      dot: true,
    },
  ];

  return (
    <div
      data-ocid="hud.panel"
      className="iron-panel rounded-lg p-4 w-full hud-brackets"
      style={{ height: 360, position: "relative" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Brain size={14} style={{ color: "oklch(0.72 0.18 220)" }} />
        <span
          className="text-xs font-semibold tracking-widest uppercase tech-font"
          style={{
            color: "oklch(0.72 0.18 220)",
            textShadow: "0 0 8px oklch(0.72 0.18 220 / 0.6)",
          }}
        >
          System Status
        </span>
      </div>
      <div className="space-y-3">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between">
            <span
              className="text-[10px] tracking-widest uppercase tech-font"
              style={{ color: "oklch(0.5 0.04 75)" }}
            >
              {m.label}
            </span>
            <div className="flex items-center gap-1.5">
              {m.dot && (
                <span
                  className="w-1.5 h-1.5 rounded-full hud-blink"
                  style={{
                    background: m.color,
                    boxShadow: `0 0 6px ${m.color}`,
                  }}
                />
              )}
              <span
                className="text-xs font-semibold tech-font"
                style={{ color: m.color, textShadow: `0 0 8px ${m.color}60` }}
              >
                {m.value}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div
        className="mt-4 pt-3 rounded text-center text-[10px] tracking-widest uppercase tech-font"
        style={{
          border: "1px solid oklch(0.78 0.15 75 / 0.2)",
          background: "oklch(0.78 0.15 75 / 0.04)",
          color: "oklch(0.78 0.15 75 / 0.7)",
          padding: "8px",
        }}
      >
        MARK XLVII ● ONLINE ● YAC INDUSTRIES
      </div>
    </div>
  );
}

// ─── Camera HUD Panel ─────────────────────────────────────────────────────────
function CameraHudPanel({
  videoRef,
  canvasRef,
  onScan,
  onClose,
  scanning,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onScan: () => void;
  onClose: () => void;
  scanning: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 20 }}
      transition={{ duration: 0.3 }}
      data-ocid="camera.panel"
      className="fixed bottom-6 right-6 z-50"
      style={{
        width: 280,
        background: "oklch(0.06 0.01 220 / 0.95)",
        border: "1px solid oklch(0.78 0.15 75 / 0.6)",
        boxShadow:
          "0 0 30px oklch(0.78 0.15 75 / 0.2), 0 0 60px oklch(0.78 0.15 75 / 0.1)",
      }}
    >
      <HudCorners color="oklch(0.78 0.15 75 / 0.8)" size={14} />

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid oklch(0.78 0.15 75 / 0.2)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full hud-blink"
            style={{
              background: "oklch(0.65 0.25 25)",
              boxShadow: "0 0 6px oklch(0.65 0.25 25)",
            }}
          />
          <span
            className="text-[10px] font-bold tracking-[0.3em] uppercase tech-font"
            style={{ color: "oklch(0.78 0.15 75)" }}
          >
            CAM FEED
          </span>
          {/* AUTO LIVE badge */}
          <span
            className="flex items-center gap-1 px-1.5 py-0.5"
            style={{
              background: "oklch(0.78 0.15 75 / 0.12)",
              border: "1px solid oklch(0.78 0.15 75 / 0.4)",
              fontSize: 8,
              letterSpacing: "0.15em",
              color: "oklch(0.78 0.15 75)",
              fontFamily: "monospace",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full hud-blink"
              style={{
                background: "oklch(0.78 0.15 75)",
                boxShadow: "0 0 4px oklch(0.78 0.15 75)",
              }}
            />
            AUTO · LIVE
          </span>
        </div>
        <button
          type="button"
          data-ocid="camera.close_button"
          onClick={onClose}
          className="text-[10px] tracking-widest uppercase tech-font px-2 py-0.5 transition-all hover:opacity-70"
          style={{
            color: "oklch(0.65 0.25 25)",
            border: "1px solid oklch(0.65 0.25 25 / 0.4)",
          }}
        >
          ✕
        </button>
      </div>

      {/* Video feed with scan-line overlay */}
      <div className="relative" style={{ lineHeight: 0 }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            display: "block",
            maxHeight: 200,
            objectFit: "cover",
          }}
        />
        {/* Scan-line overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, oklch(0 0 0 / 0.15) 2px, oklch(0 0 0 / 0.15) 4px)",
          }}
        />
        {/* Scan sweep animation */}
        <div
          className="absolute inset-x-0 pointer-events-none cam-scan-sweep"
          style={{
            height: 2,
            background:
              "linear-gradient(90deg, transparent, oklch(0.78 0.15 75 / 0.7), transparent)",
            top: 0,
          }}
        />
        {/* Corner HUD overlays inside video */}
        <div
          className="absolute top-2 left-2"
          style={{
            width: 16,
            height: 16,
            borderTop: "1px solid oklch(0.78 0.15 75 / 0.7)",
            borderLeft: "1px solid oklch(0.78 0.15 75 / 0.7)",
          }}
        />
        <div
          className="absolute top-2 right-2"
          style={{
            width: 16,
            height: 16,
            borderTop: "1px solid oklch(0.78 0.15 75 / 0.7)",
            borderRight: "1px solid oklch(0.78 0.15 75 / 0.7)",
          }}
        />
        <div
          className="absolute bottom-2 left-2"
          style={{
            width: 16,
            height: 16,
            borderBottom: "1px solid oklch(0.78 0.15 75 / 0.7)",
            borderLeft: "1px solid oklch(0.78 0.15 75 / 0.7)",
          }}
        />
        <div
          className="absolute bottom-2 right-2"
          style={{
            width: 16,
            height: 16,
            borderBottom: "1px solid oklch(0.78 0.15 75 / 0.7)",
            borderRight: "1px solid oklch(0.78 0.15 75 / 0.7)",
          }}
        />
        {/* REC indicator */}
        <div className="absolute top-2 right-8 flex items-center gap-1">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: "oklch(0.65 0.25 25)",
              animation: "pulse 1s ease-in-out infinite",
            }}
          />
          <span
            className="text-[8px] font-bold tracking-widest tech-font"
            style={{ color: "oklch(0.65 0.25 25)" }}
          >
            REC
          </span>
        </div>
        {/* Scanning overlay */}
        {scanning && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
            style={{ background: "oklch(0.78 0.15 75 / 0.15)" }}
          >
            <span
              className="text-[11px] font-bold tracking-[0.3em] uppercase tech-font hud-blink"
              style={{
                color: "oklch(0.78 0.15 75)",
                textShadow: "0 0 12px oklch(0.78 0.15 75)",
              }}
            >
              ⬡ SCANNING...
            </span>
          </div>
        )}
      </div>

      {/* Scan button */}
      <div className="px-3 py-2">
        <button
          type="button"
          data-ocid="camera.scan.button"
          onClick={onScan}
          disabled={scanning}
          className="w-full py-1.5 text-[10px] font-bold tracking-[0.3em] uppercase tech-font transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: scanning
              ? "oklch(0.78 0.15 75 / 0.2)"
              : "oklch(0.78 0.15 75 / 0.1)",
            border: "1px solid oklch(0.78 0.15 75 / 0.5)",
            color: "oklch(0.78 0.15 75)",
            boxShadow: "0 0 10px oklch(0.78 0.15 75 / 0.15)",
          }}
          onMouseEnter={(e) => {
            if (!scanning) {
              (e.currentTarget as HTMLElement).style.background =
                "oklch(0.78 0.15 75 / 0.2)";
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 0 20px oklch(0.78 0.15 75 / 0.4)";
            }
          }}
          onMouseLeave={(e) => {
            if (!scanning) {
              (e.currentTarget as HTMLElement).style.background =
                "oklch(0.78 0.15 75 / 0.1)";
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 0 10px oklch(0.78 0.15 75 / 0.15)";
            }
          }}
        >
          {scanning ? "⬡ SCANNING..." : "⬡ INITIATE VISUAL SCAN"}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({
  onLogin,
  isLoggingIn,
}: {
  onLogin: () => void;
  isLoggingIn: boolean;
}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "oklch(0.05 0.01 220)" }}
    >
      {/* Scanline overlay */}
      <div className="scanline-overlay" />
      <div className="scanline-sweep" />

      {/* Hex grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='52' viewBox='0 0 60 52'%3E%3Cpolygon points='30,2 58,16 58,36 30,50 2,36 2,16' fill='none' stroke='oklch(0.78 0.15 75 / 0.06)' stroke-width='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: "60px 52px",
          opacity: 0.8,
        }}
      />

      {/* Arc reactor ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 60% at 50% 50%, oklch(0.72 0.18 220 / 0.1), transparent 70%)",
        }}
      />

      {/* Screen corner HUD brackets */}
      {[
        { cls: "top-6 left-6" },
        { cls: "top-6 right-6" },
        { cls: "bottom-6 left-6" },
        { cls: "bottom-6 right-6" },
      ].map(({ cls }, i) => (
        <div
          key={cls}
          className={`absolute ${cls} w-10 h-10 pointer-events-none`}
          style={{
            borderTop: i < 2 ? "2px solid oklch(0.78 0.15 75 / 0.5)" : "none",
            borderBottom:
              i >= 2 ? "2px solid oklch(0.78 0.15 75 / 0.5)" : "none",
            borderLeft:
              i % 2 === 0 ? "2px solid oklch(0.78 0.15 75 / 0.5)" : "none",
            borderRight:
              i % 2 === 1 ? "2px solid oklch(0.78 0.15 75 / 0.5)" : "none",
          }}
        />
      ))}

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="flex flex-col items-center gap-8 px-8 text-center relative"
        style={{ maxWidth: 480 }}
      >
        {/* Arc reactor login orb */}
        <div
          className="relative flex items-center justify-center"
          style={{ width: 200, height: 200 }}
        >
          {/* Outer rings */}
          <div
            className="absolute arc-spin-slow"
            style={{ width: 190, height: 190 }}
          >
            <svg
              width="190"
              height="190"
              viewBox="0 0 190 190"
              aria-hidden="true"
            >
              <title>Login reactor ring</title>
              <circle
                cx="95"
                cy="95"
                r="93"
                fill="none"
                stroke="oklch(0.78 0.15 75 / 0.3)"
                strokeWidth="1"
              />
              {Array.from({ length: 16 }, (_, i) => {
                const angle = (i * 360) / 16;
                const rad = (angle * Math.PI) / 180;
                return (
                  <line
                    key={angle}
                    x1={95 + 89 * Math.cos(rad)}
                    y1={95 + 89 * Math.sin(rad)}
                    x2={95 + 83 * Math.cos(rad)}
                    y2={95 + 83 * Math.sin(rad)}
                    stroke={`oklch(0.78 0.15 75 / ${i % 4 === 0 ? "0.9" : "0.4"})`}
                    strokeWidth="1.5"
                  />
                );
              })}
            </svg>
          </div>
          <div
            className="absolute arc-spin-reverse"
            style={{ width: 155, height: 155 }}
          >
            <div
              className="w-full h-full rounded-full"
              style={{
                border: "1px dashed oklch(0.72 0.18 220 / 0.4)",
                boxShadow: "0 0 10px oklch(0.72 0.18 220 / 0.15)",
              }}
            />
          </div>
          {/* Core glow */}
          <div
            className="absolute arc-pulse"
            style={{ width: 110, height: 110 }}
          >
            <div
              className="w-full h-full rounded-full reactor-glow-anim"
              style={{
                background:
                  "radial-gradient(circle at 40% 35%, white 0%, oklch(0.72 0.18 220) 35%, oklch(0.4 0.18 220 / 0.7) 65%, transparent)",
                boxShadow:
                  "0 0 30px white, 0 0 60px oklch(0.72 0.18 220), 0 0 100px oklch(0.72 0.18 220 / 0.5)",
                filter: "blur(1px)",
              }}
            />
          </div>
          <div
            className="relative z-10 flex items-center justify-center"
            style={{
              width: 50,
              height: 50,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, white, oklch(0.72 0.18 220))",
              boxShadow: "0 0 20px white, 0 0 40px oklch(0.72 0.18 220)",
            }}
          >
            <Zap size={22} style={{ color: "oklch(0.05 0.01 220)" }} />
          </div>
        </div>

        {/* YAC Industries badge */}
        <div className="flex flex-col gap-1">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-xs tracking-[0.4em] uppercase tech-font"
            style={{ color: "oklch(0.55 0.08 75)" }}
          >
            YAC INDUSTRIES
          </motion.p>
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="text-5xl font-black tracking-[0.25em] uppercase"
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              color: "oklch(0.78 0.15 75)",
              textShadow:
                "0 0 20px oklch(0.78 0.15 75 / 0.7), 0 0 50px oklch(0.78 0.15 75 / 0.4)",
            }}
          >
            J.A.R.V.I.S.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-[11px] tracking-[0.2em] uppercase tech-font"
            style={{ color: "oklch(0.5 0.06 75)" }}
          >
            Just A Rather Very Intelligent System
          </motion.p>
        </div>

        {/* Divider */}
        <div className="w-full flex items-center gap-3">
          <div
            className="flex-1 h-px"
            style={{ background: "oklch(0.78 0.15 75 / 0.25)" }}
          />
          <span
            className="text-[10px] tracking-widest uppercase tech-font"
            style={{ color: "oklch(0.45 0.04 75)" }}
          >
            SYSTEM ACCESS REQUIRED
          </span>
          <div
            className="flex-1 h-px"
            style={{ background: "oklch(0.78 0.15 75 / 0.25)" }}
          />
        </div>

        {/* Login button */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          className="w-full"
          style={{ position: "relative" }}
        >
          <HudCorners size={16} color="oklch(0.78 0.15 75 / 0.7)" />
          <button
            type="button"
            data-ocid="login.primary_button"
            onClick={onLogin}
            disabled={isLoggingIn}
            className="w-full py-3 px-8 text-sm font-semibold tracking-widest uppercase transition-all disabled:opacity-60 disabled:cursor-not-allowed tech-font"
            style={{
              background: isLoggingIn
                ? "oklch(0.78 0.15 75 / 0.08)"
                : "oklch(0.78 0.15 75 / 0.1)",
              border: "1px solid oklch(0.78 0.15 75 / 0.55)",
              color: "oklch(0.78 0.15 75)",
              boxShadow: isLoggingIn
                ? "none"
                : "0 0 20px oklch(0.78 0.15 75 / 0.2), inset 0 0 20px oklch(0.78 0.15 75 / 0.05)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "oklch(0.48 0.22 25 / 0.2)";
              (e.currentTarget as HTMLElement).style.borderColor =
                "oklch(0.48 0.22 25 / 0.8)";
              (e.currentTarget as HTMLElement).style.color =
                "oklch(0.72 0.22 25)";
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 0 20px oklch(0.48 0.22 25 / 0.4)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "oklch(0.78 0.15 75 / 0.1)";
              (e.currentTarget as HTMLElement).style.borderColor =
                "oklch(0.78 0.15 75 / 0.55)";
              (e.currentTarget as HTMLElement).style.color =
                "oklch(0.78 0.15 75)";
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 0 20px oklch(0.78 0.15 75 / 0.2)";
            }}
          >
            {isLoggingIn ? (
              <span className="flex items-center justify-center gap-2">
                <span
                  className="w-4 h-4 rounded-full border-2 animate-spin"
                  style={{
                    borderColor: "oklch(0.78 0.15 75 / 0.3)",
                    borderTopColor: "oklch(0.78 0.15 75)",
                  }}
                />
                AUTHENTICATING...
              </span>
            ) : (
              "INITIATE SYSTEM ACCESS"
            )}
          </button>
        </motion.div>

        <p
          className="text-[11px] tech-font"
          style={{ color: "oklch(0.38 0.04 75)" }}
        >
          SECURED BY INTERNET IDENTITY — BIOMETRIC AUTHENTICATION
        </p>
      </motion.div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { identity, login, clear, isInitializing, isLoggingIn } =
    useInternetIdentity();
  const { actor: _actor } = useActor();
  const _queryClient = useQueryClient();
  const { data: remoteMessages = [] } = useGetAllMessages();
  const { data: _queryConnected = false } = useIsConnected();
  const [isOnline, setIsOnline] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      localStorage.removeItem("yac-history");
    } catch (_e) {
      // ignore
    }
    return [];
  });
  const [liveTime, setLiveTime] = useState("");
  const [listening, setListening] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [startTime] = useState(Date.now());
  const [uptime, setUptime] = useState("00:00:00");

  // Camera state
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanning, setScanning] = useState(false);
  const lastScanDescRef = useRef<string>("");

  const recognitionRef = useRef<any>(null);
  const toggleListeningRef = useRef<(() => void) | null>(null);
  const retryCountRef = useRef(0);
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const wakeListenerRef = useRef<any>(null);
  const wakeWordActiveRef = useRef(false);
  const continuousListenRef = useRef(false);
  const [continuousMode, setContinuousMode] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");

  // Connectivity check — run on mount and every 30 seconds
  useEffect(() => {
    preWarmConnection(); // Pre-warm connections immediately on mount
    let mounted = true;
    const check = async () => {
      const online = await checkConnectivity();
      if (mounted) setIsOnline(online);
    };
    check();
    const id = setInterval(check, 30000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  // Sync network time on startup
  useEffect(() => {
    syncNetworkTime();
  }, []);

  // Uptime counter
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
      const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
      const s = String(elapsed % 60).padStart(2, "0");
      setUptime(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  // Live clock
  useEffect(() => {
    syncNetworkTime();
    const tick = () => {
      const now = getNetworkAdjustedDate();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const ist = new Date(
        now.getTime() + istOffset - now.getTimezoneOffset() * 60 * 1000,
      );
      const months = [
        "JAN",
        "FEB",
        "MAR",
        "APR",
        "MAY",
        "JUN",
        "JUL",
        "AUG",
        "SEP",
        "OCT",
        "NOV",
        "DEC",
      ];
      const mon = months[ist.getUTCMonth()];
      const day = String(ist.getUTCDate()).padStart(2, "0");
      const yr = ist.getUTCFullYear();
      const hh = String(ist.getUTCHours()).padStart(2, "0");
      const mm = String(ist.getUTCMinutes()).padStart(2, "0");
      const ss = String(ist.getUTCSeconds()).padStart(2, "0");
      setLiveTime(`${mon} ${day} ${yr} | ${hh}:${mm}:${ss} IST`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Save chat history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "yac-history",
        JSON.stringify(chatMessages.slice(-50)),
      );
    } catch (_e) {
      // ignore
    }
  }, [chatMessages]);

  // Seed chat from remote messages
  useEffect(() => {
    if (remoteMessages.length === 0) return;
    const seeded: ChatMessage[] = [];
    for (const entry of remoteMessages) {
      seeded.push({
        id: `remote-user-${entry.id}`,
        role: "user",
        content: entry.message.content,
        timestamp: Number(entry.timestamp),
      });
      if (entry.response.content) {
        seeded.push({
          id: `remote-jarvis-${entry.id}`,
          role: "assistant",
          content: entry.response.content,
          timestamp: Number(entry.response.timestamp),
        });
      }
    }
    setChatMessages(seeded);
  }, [remoteMessages]);

  // ─── Camera Controls ─────────────────────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    if (cameraOn) {
      // Turn off camera
      for (const t of cameraStreamRef.current?.getTracks() ?? []) {
        t.stop();
      }
      cameraStreamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraOn(false);
    } else {
      // Turn on camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        cameraStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraOn(true);
        setVoiceStatus("");
      } catch (err: any) {
        const msg =
          err?.name === "NotAllowedError"
            ? "CAMERA ACCESS DENIED - CHECK BROWSER SETTINGS"
            : err?.name === "NotFoundError"
              ? "NO CAMERA FOUND"
              : "CAMERA ERROR - TRY AGAIN";
        setVoiceStatus(msg);
      }
    }
  }, [cameraOn]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      for (const t of cameraStreamRef.current?.getTracks() ?? []) {
        t.stop();
      }
    };
  }, []);

  // handleCameraScan is defined below after sendMessage is available

  const speakText = useCallback(async (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    // Small delay to let cancel() settle before speaking
    await new Promise((r) => setTimeout(r, 150));
    const voices = await loadVoices();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.92;
    utt.pitch = 0.8;
    utt.volume = 1.0;
    const voice = pickJarvisVoice(voices);
    if (voice) utt.voice = voice;
    // Chrome keepalive hack: pause/resume every 10s to prevent cutoff
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    utt.onstart = () => {
      keepAlive = setInterval(() => {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10000);
    };
    utt.onend = () => {
      if (keepAlive) clearInterval(keepAlive);
    };
    utt.onerror = () => {
      if (keepAlive) clearInterval(keepAlive);
    };
    window.speechSynthesis.speak(utt);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isSending) return;
      setIsSending(true);

      // Detect command shortcuts
      const lower = text.toLowerCase().trim();
      let modeHint: string | undefined;
      if (lower.startsWith("calculate ")) {
        modeHint =
          "You are in calculator mode. Be precise and show your steps.";
      } else if (lower.startsWith("translate ")) {
        modeHint =
          "You are in translation mode. Translate accurately and provide the translation.";
      } else if (lower.startsWith("summarize ")) {
        modeHint = "You are in summary mode. Be concise and use bullet points.";
      }

      // Emotion/tone detection
      const emotion = detectEmotion(text);
      if (emotion === "urgent") {
        modeHint = `${modeHint ?? ""} The user seems urgent — prioritize the most important information first.`;
      } else if (emotion === "positive") {
        modeHint = `${modeHint ?? ""} The user is in a positive mood — match the energy with an upbeat tone.`;
      } else if (emotion === "curious") {
        modeHint = `${modeHint ?? ""} The user is curious — provide clear, educational explanations.`;
      }

      // Language detection
      if (needsMultilingualHint(text)) {
        modeHint = `${modeHint ?? ""} Respond in the same language as the user.`;
      }

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text.trim(),
        timestamp: Date.now(),
      };
      const pendingId = `pending-${Date.now()}`;
      const pendingMsg: ChatMessage = {
        id: pendingId,
        role: "assistant",
        content: "Processing...",
        pending: true,
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, userMsg, pendingMsg]);
      setTextInput("");
      try {
        const liveContext = await fetchLiveContext(text.trim());
        const response = await callYAC(text.trim(), modeHint, liveContext);
        const responseMsg: ChatMessage = {
          id: `jarvis-${Date.now()}`,
          role: "assistant",
          content: response,
          timestamp: Date.now(),
          isLive: liveContext.length > 0,
        };
        setChatMessages((prev) =>
          prev.filter((m) => m.id !== pendingId).concat(responseMsg),
        );
        speakText(response);
        // Auto-restart listening if continuous mode is active
        if (continuousListenRef.current) {
          setTimeout(() => {
            if (continuousListenRef.current) {
              toggleListeningRef.current?.();
            }
          }, 2500);
        }
      } catch (_err) {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  ...m,
                  content:
                    "[Error communicating with J.A.R.V.I.S. Please try again.]",
                  pending: false,
                }
              : m,
          ),
        );
      } finally {
        setIsSending(false);
      }
    },
    [isSending, speakText],
  );

  const toggleListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(
        "Speech recognition is not supported in your browser. Please use Chrome.",
      );
      return;
    }
    if (listening) {
      continuousListenRef.current = false;
      setContinuousMode(false);
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let resultReceived = false;
    recognition.onresult = (event: any) => {
      resultReceived = true;
      retryCountRef.current = 0;
      const transcript = event.results[0][0].transcript;
      setListening(false);
      setContinuousMode(true);
      continuousListenRef.current = true;
      sendMessage(transcript);
    };
    recognition.onerror = (event: any) => {
      setListening(false);
      const errorCode = event?.error || "";
      if (errorCode === "not-allowed" || errorCode === "permission-denied") {
        setVoiceStatus("MICROPHONE ACCESS DENIED - CHECK BROWSER SETTINGS");
        retryCountRef.current = 0;
      } else if (errorCode === "no-speech") {
        setVoiceStatus("NO SPEECH DETECTED - TRY AGAIN");
        retryCountRef.current = 0;
      } else if (errorCode === "network") {
        setVoiceStatus("NETWORK ERROR - CHECK CONNECTION");
        // Auto-retry once on network error
        if (retryCountRef.current < 1) {
          retryCountRef.current += 1;
          setTimeout(() => toggleListening(), 500);
        } else {
          retryCountRef.current = 0;
        }
      } else if (errorCode === "aborted") {
        setVoiceStatus("LISTENING STOPPED");
        retryCountRef.current = 0;
      } else {
        setVoiceStatus("VOICE ERROR - TRY AGAIN");
        // Auto-retry once on generic error
        if (retryCountRef.current < 1) {
          retryCountRef.current += 1;
          setTimeout(() => toggleListening(), 500);
        } else {
          retryCountRef.current = 0;
        }
      }
      if (wakeWordActiveRef.current) {
        setTimeout(() => startWakeListener(), 500);
      }
    };
    recognition.onend = () => {
      setListening(false);
      if (!resultReceived && !wakeWordActiveRef.current) {
        if (continuousListenRef.current) {
          setTimeout(() => {
            if (continuousListenRef.current) toggleListeningRef.current?.();
          }, 500);
        } else {
          setVoiceStatus("NO SPEECH DETECTED - TRY AGAIN");
        }
      }
      if (wakeWordActiveRef.current) {
        setTimeout(() => startWakeListener(), 300);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, sendMessage]);

  // Keep toggleListeningRef in sync so sendMessage can call it without circular deps
  toggleListeningRef.current = toggleListening;

  // Wake word aliases — catches "jar", "jarvis", common mishears
  const WAKE_WORDS = [
    "jar",
    "jarvis",
    "jab",
    "job",
    "char",
    "yar",
    "ya",
    "dr",
    "guard",
  ];

  const startWakeListener = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition || !wakeWordActiveRef.current) return;

    // Clear any existing listener first
    if (wakeListenerRef.current) {
      try {
        wakeListenerRef.current.onend = null;
        wakeListenerRef.current.onerror = null;
        wakeListenerRef.current.stop();
      } catch (_) {}
      wakeListenerRef.current = null;
    }

    setVoiceStatus('WAKE ACTIVE · SAY "JAR"');

    let sessionActive = true;
    const restartWake = (delayMs = 0) => {
      if (!wakeWordActiveRef.current || !sessionActive) return;
      if (delayMs > 0) {
        setTimeout(() => {
          if (wakeWordActiveRef.current && sessionActive) startWakeListener();
        }, delayMs);
      } else {
        // Immediate restart — use microtask queue to avoid re-entrancy
        Promise.resolve().then(() => {
          if (wakeWordActiveRef.current && sessionActive) startWakeListener();
        });
      }
    };

    try {
      const wakeRec = new SpeechRecognition();
      wakeRec.lang = "en-US";
      // Use continuous=false, maxAlternatives=3 for better single-utterance detection
      // Non-continuous mode is more reliable on mobile and avoids browser auto-stop
      wakeRec.continuous = false;
      wakeRec.interimResults = false;
      wakeRec.maxAlternatives = 3;

      wakeRec.onresult = (event: any) => {
        // Check all alternatives for any wake word match
        const alts: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          for (let j = 0; j < event.results[i].length; j++) {
            alts.push(event.results[i][j].transcript.toLowerCase().trim());
          }
        }
        const combined = alts.join(" ");
        const isWakeWord = WAKE_WORDS.some((w) => combined.includes(w));

        if (isWakeWord) {
          sessionActive = false;
          try {
            wakeRec.stop();
          } catch (_) {}
          setWakeWordDetected(true);
          setVoiceStatus("WAKE WORD DETECTED · LISTENING...");
          setTimeout(() => setWakeWordDetected(false), 2000);

          // Start command recognition after brief delay
          setTimeout(() => {
            if (!wakeWordActiveRef.current) return;
            const SR2 =
              (window as any).SpeechRecognition ||
              (window as any).webkitSpeechRecognition;
            const cmdRec = new SR2();
            cmdRec.lang = "en-US";
            cmdRec.continuous = false;
            cmdRec.interimResults = false;
            cmdRec.maxAlternatives = 1;
            let cmdReceived = false;
            cmdRec.onresult = (ev: any) => {
              cmdReceived = true;
              const cmd = ev.results[0][0].transcript;
              setListening(false);
              setVoiceStatus("");
              sendMessage(cmd);
            };
            cmdRec.onerror = () => {
              setListening(false);
              if (wakeWordActiveRef.current) startWakeListener();
            };
            cmdRec.onend = () => {
              setListening(false);
              if (!cmdReceived)
                setVoiceStatus('NO COMMAND HEARD · SAY "JAR" AGAIN');
              if (wakeWordActiveRef.current)
                setTimeout(() => startWakeListener(), 300);
            };
            recognitionRef.current = cmdRec;
            setListening(true);
            try {
              cmdRec.start();
            } catch (_) {
              setListening(false);
              if (wakeWordActiveRef.current) startWakeListener();
            }
          }, 100);
        } else {
          // Not a wake word — restart immediately to keep listening
          restartWake(0);
        }
      };

      wakeRec.onerror = (e: any) => {
        const errCode = e?.error || "";
        // aborted/no-speech are normal — restart immediately
        if (errCode === "aborted" || errCode === "no-speech") {
          restartWake(0);
        } else if (
          errCode === "not-allowed" ||
          errCode === "permission-denied"
        ) {
          sessionActive = false;
          setVoiceStatus("MICROPHONE DENIED · CHECK BROWSER SETTINGS");
          wakeWordActiveRef.current = false;
          setWakeWordActive(false);
        } else {
          // network/other — brief pause then restart
          restartWake(500);
        }
      };

      wakeRec.onend = () => {
        // Always restart unless we deliberately stopped (sessionActive=false)
        if (sessionActive) restartWake(0);
      };

      wakeListenerRef.current = wakeRec;
      wakeRec.start();
    } catch (_e) {
      // If start() throws (e.g. already running), retry after a tick
      restartWake(200);
    }
  }, [sendMessage]);

  const toggleWakeWord = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(
        "Speech recognition is not supported in your browser. Please use Chrome.",
      );
      return;
    }
    if (wakeWordActive) {
      wakeWordActiveRef.current = false;
      setWakeWordActive(false);
      if (wakeListenerRef.current) {
        try {
          wakeListenerRef.current.onend = null;
          wakeListenerRef.current.onerror = null;
          wakeListenerRef.current.stop();
        } catch (_) {}
        wakeListenerRef.current = null;
      }
      setVoiceStatus("");
    } else {
      wakeWordActiveRef.current = true;
      setWakeWordActive(true);
      startWakeListener();
    }
  }, [wakeWordActive, startWakeListener]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") sendMessage(textInput);
  };

  // Capture a frame from the video element as a base64 JPEG
  const captureFrameAsBase64 = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 320, 240);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  // Bind handleCameraScan to sendMessage after it's defined
  const handleCameraScanBound = useCallback(async () => {
    if (!videoRef.current || !cameraOn || scanning) return;
    const imageData = captureFrameAsBase64();
    if (!imageData) return;

    setScanning(true);
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: "📸 [Visual Scan Initiated]",
      timestamp: Date.now(),
    };
    const pendingId = `pending-${Date.now()}`;
    const pendingMsg: ChatMessage = {
      id: pendingId,
      role: "assistant",
      content: "Analyzing visual feed...",
      pending: true,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, userMsg, pendingMsg]);

    try {
      const result = await callVisionAI(
        imageData,
        "What do you see in this image? Describe it briefly in 1-2 sentences.",
      );
      const responseMsg: ChatMessage = {
        id: `jarvis-${Date.now()}`,
        role: "assistant",
        content: result,
        timestamp: Date.now(),
      };
      setChatMessages((prev) =>
        prev.filter((m) => m.id !== pendingId).concat(responseMsg),
      );
      speakText(result);
    } catch {
      setChatMessages((prev) =>
        prev
          .filter((m) => m.id !== pendingId)
          .concat({
            id: `jarvis-${Date.now()}`,
            role: "assistant",
            content: "Visual scan failed. Unable to process image.",
            timestamp: Date.now(),
          }),
      );
    } finally {
      setScanning(false);
    }
  }, [cameraOn, scanning, captureFrameAsBase64, speakText]);

  // Auto-scan effect: when camera is on, automatically scan every 8 seconds
  useEffect(() => {
    if (!cameraOn) return;
    const interval = setInterval(async () => {
      if (scanning) return;
      const imageData = captureFrameAsBase64();
      if (!imageData) return;
      try {
        const result = await callVisionAI(
          imageData,
          "Briefly describe what you see in one sentence. Be specific about objects, people, or text visible.",
        );
        if (
          result &&
          result !== lastScanDescRef.current &&
          !result.toLowerCase().includes("failed")
        ) {
          lastScanDescRef.current = result;
          const autoMsg: ChatMessage = {
            id: `auto-${Date.now()}`,
            role: "assistant",
            content: `👁 Auto-scan: ${result}`,
            timestamp: Date.now(),
          };
          setChatMessages((prev) => [...prev, autoMsg]);
          if (!window.speechSynthesis.speaking) {
            speakText(result);
          }
        }
      } catch {
        /* silent fail for auto-scan */
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [cameraOn, scanning, captureFrameAsBase64, speakText]);

  const features = [
    {
      icon: <Mic size={22} />,
      title: "Voice Command",
      desc: "Speak naturally and J.A.R.V.I.S. processes your commands with high-accuracy speech recognition. No keyboard required.",
    },
    {
      icon: <Globe size={22} />,
      title: "Internet Access",
      desc: "J.A.R.V.I.S. has real-time access to the global network, pulling live data, news, and information for accurate responses.",
    },
    {
      icon: <Sparkles size={22} />,
      title: "AI Processing",
      desc: "Advanced AI reasoning delivers context-aware, intelligent responses instantly. Powered by the YAC Intelligence Framework.",
    },
    {
      icon: <Camera size={22} />,
      title: "Visual Scan",
      desc: "Activate the camera feed for live surveillance mode. Initiate a visual scan and J.A.R.V.I.S. will analyze what the camera sees.",
    },
  ];

  const steps = [
    {
      num: "01",
      title: "Initiate",
      desc: "Activate the microphone or type your query. J.A.R.V.I.S. listens with precision and clarity.",
    },
    {
      num: "02",
      title: "Process",
      desc: "Your input is analyzed through J.A.R.V.I.S.'s AI pipeline with live internet context integration.",
    },
    {
      num: "03",
      title: "Execute",
      desc: "J.A.R.V.I.S. delivers an intelligent spoken response and displays the transcript in real-time.",
    },
  ];

  // ─── Auth gates ──────────────────────────────────────────────────────────
  if (isInitializing) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "oklch(0.05 0.01 220)" }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 rounded-full border-2 animate-spin"
            style={{
              borderColor: "oklch(0.78 0.15 75 / 0.2)",
              borderTopColor: "oklch(0.78 0.15 75)",
            }}
          />
          <span
            className="text-xs tracking-widest uppercase tech-font"
            style={{ color: "oklch(0.5 0.08 75)" }}
          >
            INITIALIZING SYSTEMS...
          </span>
        </div>
      </div>
    );
  }

  if (!identity) {
    return <LoginScreen onLogin={login} isLoggingIn={isLoggingIn} />;
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "oklch(0.05 0.01 220)" }}
    >
      {/* Scanline overlay */}
      <div className="scanline-overlay" />
      <div className="scanline-sweep" />

      {/* Hex grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='52' viewBox='0 0 60 52'%3E%3Cpolygon points='30,2 58,16 58,36 30,50 2,36 2,16' fill='none' stroke='oklch(0.78 0.15 75 / 0.04)' stroke-width='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: "60px 52px",
          zIndex: 0,
        }}
      />

      {/* ─── Camera HUD Panel (floating overlay) ──────────────────────── */}
      <AnimatePresence>
        {cameraOn && (
          <CameraHudPanel
            videoRef={videoRef}
            canvasRef={canvasRef}
            onScan={handleCameraScanBound}
            onClose={toggleCamera}
            scanning={scanning}
          />
        )}
      </AnimatePresence>

      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-3"
        style={{
          borderBottom: "1px solid oklch(0.78 0.15 75 / 0.25)",
          background: "oklch(0.05 0.01 220 / 0.95)",
          backdropFilter: "blur(16px)",
          boxShadow: "0 1px 30px oklch(0.78 0.15 75 / 0.08)",
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Zap size={18} style={{ color: "oklch(0.78 0.15 75)" }} />
          <div className="flex flex-col">
            <span
              className="text-sm font-black tracking-[0.2em] uppercase tech-font"
              style={{
                color: "oklch(0.78 0.15 75)",
                textShadow: "0 0 12px oklch(0.78 0.15 75 / 0.5)",
              }}
            >
              J.A.R.V.I.S.
            </span>
            <span
              className="text-[8px] tracking-[0.3em] uppercase tech-font"
              style={{ color: "oklch(0.45 0.06 75)" }}
            >
              YAC AI SYSTEM
            </span>
          </div>
        </div>

        {/* Live clock */}
        <div className="hidden md:flex items-center gap-3">
          {liveTime && (
            <div
              className="px-3 py-1 text-xs tech-font tracking-widest"
              style={{
                color: "oklch(0.78 0.15 75)",
                textShadow: "0 0 8px oklch(0.78 0.15 75 / 0.6)",
                background: "oklch(0.09 0.015 75 / 0.5)",
                border: "1px solid oklch(0.78 0.15 75 / 0.15)",
                letterSpacing: "0.15em",
              }}
            >
              {liveTime}
            </div>
          )}
        </div>

        {/* CTAs */}
        <div className="flex items-center gap-3">
          {/* NET pulsing status dot */}
          <div
            className="flex items-center gap-1 tech-font"
            style={{
              fontSize: "9px",
              color: "oklch(0.45 0.06 75)",
              letterSpacing: "0.1em",
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isOnline
                  ? "oklch(0.7 0.25 145)"
                  : "oklch(0.65 0.3 25)",
                boxShadow: isOnline
                  ? "0 0 6px oklch(0.7 0.25 145 / 0.9)"
                  : "0 0 6px oklch(0.65 0.3 25 / 0.9)",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
            NET
          </div>
          <div
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 tech-font"
            style={{
              background: isOnline
                ? "oklch(0.25 0.1 145 / 0.2)"
                : "oklch(0.25 0.15 25 / 0.2)",
              border: `1px solid ${isOnline ? "oklch(0.55 0.15 145 / 0.5)" : "oklch(0.48 0.22 25 / 0.5)"}`,
              color: isOnline ? "oklch(0.7 0.18 145)" : "oklch(0.65 0.25 25)",
            }}
          >
            {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
            {isOnline ? "ONLINE" : "OFFLINE"}
          </div>
          <button
            type="button"
            data-ocid="auth.toggle"
            onClick={clear}
            title="Logout"
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 transition-all hover:opacity-80 active:scale-95 tech-font"
            style={{
              background: "oklch(0.09 0.015 75 / 0.8)",
              border: "1px solid oklch(0.22 0.04 75 / 0.6)",
              color: "oklch(0.5 0.04 75)",
            }}
          >
            <LogOut size={12} />
            <span className="hidden sm:inline">LOGOUT</span>
          </button>
        </div>
      </header>

      <main className="flex-1 relative z-10">
        {/* ─── Hero Section ─────────────────────────────────────────────── */}
        <section className="relative flex flex-col items-center pt-16 pb-20 px-4 overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 50% 30%, oklch(0.72 0.18 220 / 0.08), transparent)",
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="mb-2 text-xs font-semibold tracking-[0.4em] uppercase tech-font"
            style={{ color: "oklch(0.55 0.08 75)" }}
          >
            YAC INDUSTRIES — ARTIFICIAL INTELLIGENCE DIVISION
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-5xl md:text-7xl font-black text-center mb-3 leading-tight tech-font"
            style={{
              color: "oklch(0.78 0.15 75)",
              textShadow:
                "0 0 30px oklch(0.78 0.15 75 / 0.6), 0 0 70px oklch(0.78 0.15 75 / 0.3)",
              letterSpacing: "0.2em",
            }}
          >
            J.A.R.V.I.S.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-sm mb-14 text-center max-w-lg tech-font tracking-widest uppercase"
            style={{ color: "oklch(0.5 0.06 75)" }}
          >
            Just A Rather Very Intelligent System
          </motion.p>

          {/* Three-column layout: chat | orb | status */}
          <div className="w-full max-w-6xl flex items-start justify-center gap-6">
            {/* Left: Chat Transcript */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
              className="hidden lg:block w-72 flex-shrink-0"
            >
              <ChatTranscriptPanel messages={chatMessages} />
            </motion.div>

            {/* Center: Arc Reactor Orb + Controls */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.15 }}
              className="flex flex-col items-center flex-shrink-0"
            >
              <ArcReactorOrb listening={listening} />

              {/* Mic button */}
              <div className="mt-4 flex flex-col items-center gap-3">
                <button
                  type="button"
                  data-ocid="jarvis.mic.button"
                  onClick={toggleListening}
                  disabled={isSending}
                  className="relative transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
                  style={{
                    width: 72,
                    height: 72,
                    background: listening
                      ? "oklch(0.48 0.22 25 / 0.2)"
                      : "oklch(0.09 0.015 75)",
                    border: `2px solid ${listening ? "oklch(0.48 0.22 25)" : "oklch(0.22 0.04 75)"}`,
                    boxShadow: listening
                      ? "0 0 25px oklch(0.48 0.22 25 / 0.6), 0 0 50px oklch(0.48 0.22 25 / 0.3)"
                      : "0 0 10px oklch(0.78 0.15 75 / 0.1)",
                    clipPath:
                      "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                    animation: listening
                      ? "red-pulse-ring 1.4s ease-in-out infinite"
                      : "none",
                  }}
                >
                  <div className="flex items-center justify-center w-full h-full">
                    {listening ? (
                      <MicOff
                        size={26}
                        style={{ color: "oklch(0.7 0.22 25)" }}
                      />
                    ) : (
                      <Mic size={26} style={{ color: "oklch(0.78 0.15 75)" }} />
                    )}
                  </div>
                </button>

                <p
                  className="text-sm font-semibold tracking-[0.2em] uppercase tech-font"
                  style={{
                    color: listening
                      ? "oklch(0.7 0.22 25)"
                      : "oklch(0.5 0.06 75)",
                    textShadow: listening
                      ? "0 0 12px oklch(0.48 0.22 25 / 0.7)"
                      : "none",
                  }}
                >
                  {listening ? "LISTENING..." : "SPEAK TO J.A.R.V.I.S."}
                </p>

                <Waveform listening={listening} />

                {/* Wake word toggle + Camera toggle row */}
                <div className="flex items-center gap-2 mt-1 flex-wrap justify-center">
                  <button
                    type="button"
                    data-ocid="jarvis.wake_word.toggle"
                    onClick={toggleWakeWord}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold tracking-widest uppercase transition-all hover:scale-105 active:scale-95 tech-font"
                    style={{
                      background: wakeWordActive
                        ? "oklch(0.25 0.1 145 / 0.2)"
                        : "oklch(0.09 0.015 75)",
                      border: `1px solid ${wakeWordActive ? "oklch(0.55 0.15 145 / 0.6)" : "oklch(0.22 0.04 75 / 0.6)"}`,
                      color: wakeWordActive
                        ? "oklch(0.7 0.18 145)"
                        : "oklch(0.5 0.06 75)",
                      boxShadow: wakeWordActive
                        ? "0 0 12px oklch(0.55 0.15 145 / 0.3)"
                        : "none",
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        background: wakeWordDetected
                          ? "oklch(0.78 0.15 75)"
                          : wakeWordActive
                            ? "oklch(0.7 0.18 145)"
                            : "oklch(0.3 0.04 75)",
                        boxShadow: wakeWordActive
                          ? wakeWordDetected
                            ? "0 0 8px oklch(0.78 0.15 75)"
                            : "0 0 6px oklch(0.7 0.18 145)"
                          : "none",
                        animation:
                          wakeWordActive && !wakeWordDetected
                            ? "pulse 2s ease-in-out infinite"
                            : "none",
                      }}
                    />
                    WAKE: {wakeWordActive ? "ON" : "OFF"}
                  </button>

                  {/* Camera toggle button */}
                  <button
                    type="button"
                    data-ocid="camera.toggle"
                    onClick={toggleCamera}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold tracking-widest uppercase transition-all hover:scale-105 active:scale-95 tech-font"
                    style={{
                      background: cameraOn
                        ? "oklch(0.48 0.22 25 / 0.2)"
                        : "oklch(0.09 0.015 75)",
                      border: `1px solid ${cameraOn ? "oklch(0.48 0.22 25 / 0.7)" : "oklch(0.22 0.04 75 / 0.6)"}`,
                      color: cameraOn
                        ? "oklch(0.7 0.22 25)"
                        : "oklch(0.5 0.06 75)",
                      boxShadow: cameraOn
                        ? "0 0 14px oklch(0.48 0.22 25 / 0.4)"
                        : "none",
                    }}
                  >
                    <Camera size={12} />
                    CAM {cameraOn ? "ON" : "OFF"}
                  </button>

                  {wakeWordDetected && (
                    <span
                      className="text-xs font-bold tracking-widest uppercase tech-font animate-pulse"
                      style={{
                        color: "oklch(0.78 0.15 75)",
                        textShadow: "0 0 8px oklch(0.78 0.15 75 / 0.7)",
                      }}
                    >
                      JARVIS DETECTED!
                    </span>
                  )}
                  {continuousMode && !wakeWordActive && (
                    <span
                      className="text-xs font-bold tracking-widest uppercase tech-font animate-pulse"
                      style={{
                        color: "oklch(0.72 0.18 220)",
                        textShadow: "0 0 8px oklch(0.72 0.18 220 / 0.7)",
                      }}
                    >
                      ● CONTINUOUS
                    </span>
                  )}
                </div>

                {/* Voice status message */}
                {voiceStatus && (
                  <div
                    className="text-[10px] tracking-widest uppercase tech-font text-center px-3 py-1 mt-1"
                    style={{
                      color: "oklch(0.65 0.25 25)",
                      textShadow: "0 0 8px oklch(0.48 0.22 25 / 0.6)",
                      background: "oklch(0.48 0.22 25 / 0.08)",
                      border: "1px solid oklch(0.48 0.22 25 / 0.3)",
                    }}
                  >
                    {voiceStatus}
                  </div>
                )}

                {/* Thinking animation */}
                {isSending && (
                  <div
                    className="flex items-center gap-2 px-4 py-2 tech-font processing-pulse"
                    style={{
                      background: "oklch(0.78 0.15 75 / 0.06)",
                      border: "1px solid oklch(0.78 0.15 75 / 0.3)",
                      color: "oklch(0.78 0.15 75)",
                    }}
                  >
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            background: "oklch(0.78 0.15 75)",
                            animation: `processing-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                          }}
                        />
                      ))}
                    </span>
                    <span className="text-[10px] tracking-[0.3em] uppercase">
                      PROCESSING...
                    </span>
                  </div>
                )}

                {/* Quick action buttons */}
                <div className="flex gap-2 flex-wrap justify-center mt-1">
                  {[
                    {
                      label: "NEWS",
                      query:
                        "What are the top news headlines in India right now today? Give me 3-4 key stories.",
                    },
                    {
                      label: "WEATHER",
                      query:
                        "What is the current weather like in major Indian cities like Mumbai, Delhi, Bangalore today?",
                    },
                    {
                      label: "SPORTS",
                      query:
                        "What are the latest cricket scores and sports results in India today?",
                    },
                    {
                      label: "TIME",
                      query: "What is the current date and time right now?",
                    },
                  ].map(({ label, query }) => (
                    <button
                      key={label}
                      type="button"
                      data-ocid={`quick.${label.toLowerCase()}.button`}
                      disabled={isSending}
                      onClick={() => {
                        setVoiceStatus("");
                        sendMessage(query);
                      }}
                      className="px-3 py-1 text-[10px] font-bold tracking-[0.2em] uppercase tech-font transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
                      style={{
                        background: "oklch(0.78 0.15 75 / 0.08)",
                        border: "1px solid oklch(0.78 0.15 75 / 0.4)",
                        color: "oklch(0.78 0.15 75)",
                        boxShadow: "0 0 8px oklch(0.78 0.15 75 / 0.15)",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.boxShadow =
                          "0 0 16px oklch(0.78 0.15 75 / 0.5)";
                        (e.currentTarget as HTMLElement).style.background =
                          "oklch(0.78 0.15 75 / 0.18)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.boxShadow =
                          "0 0 8px oklch(0.78 0.15 75 / 0.15)";
                        (e.currentTarget as HTMLElement).style.background =
                          "oklch(0.78 0.15 75 / 0.08)";
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  {/* Clear history button */}
                  <button
                    type="button"
                    data-ocid="clear.history.button"
                    onClick={() => {
                      setChatMessages([]);
                      try {
                        localStorage.removeItem("yac-history");
                      } catch (_e) {
                        /* ignore */
                      }
                    }}
                    className="px-3 py-1 text-[10px] font-bold tracking-[0.2em] uppercase tech-font transition-all hover:scale-105 active:scale-95"
                    style={{
                      background: "oklch(0.65 0.25 25 / 0.08)",
                      border: "1px solid oklch(0.65 0.25 25 / 0.4)",
                      color: "oklch(0.65 0.25 25)",
                      boxShadow: "0 0 8px oklch(0.65 0.25 25 / 0.15)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.boxShadow =
                        "0 0 16px oklch(0.65 0.25 25 / 0.5)";
                      (e.currentTarget as HTMLElement).style.background =
                        "oklch(0.65 0.25 25 / 0.18)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.boxShadow =
                        "0 0 8px oklch(0.65 0.25 25 / 0.15)";
                      (e.currentTarget as HTMLElement).style.background =
                        "oklch(0.65 0.25 25 / 0.08)";
                    }}
                  >
                    CLEAR
                  </button>
                </div>

                {/* Text input fallback */}
                <div
                  className="flex gap-2 w-full mt-1"
                  style={{ maxWidth: 360 }}
                >
                  <Input
                    data-ocid="jarvis.text.input"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Or type your command..."
                    disabled={isSending || listening}
                    className="text-sm tech-font"
                    style={{
                      background: "oklch(0.09 0.015 75)",
                      border: "1px solid oklch(0.78 0.15 75 / 0.4)",
                      color: "oklch(0.92 0.04 75)",
                      borderRadius: 0,
                    }}
                  />
                  <Button
                    data-ocid="jarvis.send.button"
                    onClick={() => sendMessage(textInput)}
                    disabled={isSending || !textInput.trim()}
                    size="icon"
                    className="flex-shrink-0"
                    style={{
                      background: "oklch(0.48 0.22 25 / 0.3)",
                      border: "1px solid oklch(0.48 0.22 25 / 0.6)",
                      color: "oklch(0.72 0.22 25)",
                      borderRadius: 0,
                      boxShadow: "0 0 10px oklch(0.48 0.22 25 / 0.2)",
                    }}
                  >
                    <Send size={16} />
                  </Button>
                </div>
              </div>
            </motion.div>

            {/* Right: System Status */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
              className="hidden lg:block w-72 flex-shrink-0"
            >
              <SystemStatusPanel
                connected={isOnline}
                messageCount={
                  chatMessages.filter((m) => m.role === "user").length
                }
                uptime={uptime}
                cameraOn={cameraOn}
              />
            </motion.div>
          </div>

          {/* Mobile panels */}
          <div className="lg:hidden w-full max-w-md mt-8 space-y-4">
            <ChatTranscriptPanel messages={chatMessages} />
            <SystemStatusPanel
              connected={isOnline}
              messageCount={
                chatMessages.filter((m) => m.role === "user").length
              }
              uptime={uptime}
              cameraOn={cameraOn}
            />
          </div>
        </section>

        {/* ─── Features Section ─────────────────────────────────────────── */}
        <section
          id="features"
          className="py-20 px-4"
          style={{ borderTop: "1px solid oklch(0.78 0.15 75 / 0.1)" }}
        >
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <p
                className="text-xs font-semibold tracking-[0.4em] uppercase mb-3 tech-font"
                style={{ color: "oklch(0.55 0.08 75)" }}
              >
                CAPABILITIES
              </p>
              <h2
                className="text-3xl md:text-4xl font-bold mb-4 tech-font"
                style={{
                  color: "oklch(0.78 0.15 75)",
                  textShadow: "0 0 20px oklch(0.78 0.15 75 / 0.4)",
                }}
              >
                SYSTEM MODULES
              </h2>
              <p
                className="text-sm max-w-lg mx-auto"
                style={{ color: "oklch(0.5 0.06 75)" }}
              >
                J.A.R.V.I.S. combines advanced voice AI with real-time internet
                access — the most capable assistant in the YAC arsenal.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  data-ocid={`features.item.${i + 1}`}
                  className="iron-panel p-6 flex flex-col gap-4 hud-brackets"
                  style={{
                    position: "relative",
                    transition: "box-shadow 0.3s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow =
                      "0 0 30px oklch(0.78 0.15 75 / 0.2), inset 0 0 20px oklch(0.78 0.15 75 / 0.04)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow =
                      "0 0 20px oklch(0.78 0.15 75 / 0.08), inset 0 0 20px oklch(0.78 0.15 75 / 0.03)";
                  }}
                >
                  <div
                    className="flex items-center justify-center w-12 h-12"
                    style={{
                      background: "oklch(0.78 0.15 75 / 0.1)",
                      border: "1px solid oklch(0.78 0.15 75 / 0.4)",
                      color: "oklch(0.78 0.15 75)",
                      clipPath:
                        "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                    }}
                  >
                    {f.icon}
                  </div>
                  <h3
                    className="text-lg font-semibold tracking-widest uppercase tech-font"
                    style={{ color: "oklch(0.78 0.15 75)" }}
                  >
                    {f.title}
                  </h3>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "oklch(0.55 0.06 75)" }}
                  >
                    {f.desc}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── How It Works Section ─────────────────────────────────────── */}
        <section
          id="how-it-works"
          className="py-20 px-4"
          style={{ borderTop: "1px solid oklch(0.78 0.15 75 / 0.1)" }}
        >
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <p
                className="text-xs font-semibold tracking-[0.4em] uppercase mb-3 tech-font"
                style={{ color: "oklch(0.55 0.12 220)" }}
              >
                PROTOCOL
              </p>
              <h2
                className="text-3xl md:text-4xl font-bold mb-4 tech-font"
                style={{
                  color: "oklch(0.72 0.18 220)",
                  textShadow: "0 0 20px oklch(0.72 0.18 220 / 0.4)",
                }}
              >
                OPERATION SEQUENCE
              </h2>
              <p
                className="text-sm max-w-lg mx-auto"
                style={{ color: "oklch(0.5 0.06 75)" }}
              >
                Three-step protocol from query to intelligent response.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
              <div
                className="hidden md:block absolute top-10 left-1/3 right-1/3 h-px"
                style={{
                  background:
                    "linear-gradient(90deg, oklch(0.78 0.15 75 / 0.4), oklch(0.72 0.18 220 / 0.4))",
                }}
              />
              {steps.map((s, i) => (
                <motion.div
                  key={s.num}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15 }}
                  data-ocid={`steps.item.${i + 1}`}
                  className="iron-panel p-6 flex flex-col gap-3 text-center hud-brackets"
                  style={{ position: "relative" }}
                >
                  <div
                    className="text-3xl font-black font-mono mx-auto tech-font"
                    style={{
                      color: "oklch(0.78 0.15 75 / 0.25)",
                      textShadow: "0 0 20px oklch(0.78 0.15 75 / 0.15)",
                    }}
                  >
                    {s.num}
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <h3
                      className="text-lg font-semibold tracking-widest uppercase tech-font"
                      style={{ color: "oklch(0.78 0.15 75)" }}
                    >
                      {s.title}
                    </h3>
                    <ChevronRight
                      size={16}
                      style={{ color: "oklch(0.48 0.22 25)" }}
                    />
                  </div>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "oklch(0.5 0.06 75)" }}
                  >
                    {s.desc}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ─── Footer ───────────────────────────────────────────────────────── */}
      <footer
        className="px-6 py-8 relative z-10"
        style={{ borderTop: "1px solid oklch(0.78 0.15 75 / 0.2)" }}
      >
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap size={14} style={{ color: "oklch(0.78 0.15 75)" }} />
            <span
              className="font-bold tracking-widest text-sm uppercase tech-font"
              style={{ color: "oklch(0.78 0.15 75)" }}
            >
              J.A.R.V.I.S.
            </span>
            <span
              className="text-xs ml-2 tech-font tracking-widest"
              style={{ color: "oklch(0.4 0.04 75)" }}
            >
              YAC INDUSTRIES
            </span>
          </div>
          <div className="flex gap-6">
            {["Features", "How It Works", "About"].map((link) => (
              <a
                key={link}
                href={`#${link.toLowerCase().replace(" ", "-")}`}
                className="text-xs transition-colors tech-font tracking-widest uppercase"
                style={{ color: "oklch(0.4 0.04 75)" }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.color = "oklch(0.78 0.15 75)";
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.color = "oklch(0.4 0.04 75)";
                }}
              >
                {link}
              </a>
            ))}
          </div>
          <p
            className="text-xs tech-font"
            style={{ color: "oklch(0.38 0.04 75)" }}
          >
            © {new Date().getFullYear()}. Built with ♥ using{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "oklch(0.55 0.08 75)" }}
            >
              caffeine.ai
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
