import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import {
  Brain,
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

// ─── Types ───────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  timestamp: number;
}

// Free AI via Pollinations.ai — all models raced in parallel for max speed
async function callGeminiAPI(query: string): Promise<string> {
  const nowStr = new Date().toISOString();
  const systemPrompt = `You are YAC, an advanced AI assistant. Today is ${nowStr}. You have real-time knowledge of news, weather, sports, stocks, and current events. Be direct and concise. Answer in under 200 words.`;

  // GET endpoint — no CORS preflight, very reliable
  const makeGet = async (model: string): Promise<string> => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);
    try {
      const prompt = encodeURIComponent(
        `${systemPrompt}\n\nUser: ${query}\n\nAssistant:`,
      );
      const res = await fetch(
        `https://text.pollinations.ai/${prompt}?model=${model}&nologo=true`,
        {
          signal: controller.signal,
        },
      );
      clearTimeout(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (
        text?.trim() &&
        !text.trim().startsWith("{") &&
        !text.trim().startsWith("<") &&
        text.trim().length > 10
      )
        return text.trim();
      throw new Error("Invalid response");
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  };

  // POST endpoint
  const makePost = async (model: string): Promise<string> => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query },
          ],
          model,
          max_tokens: 400,
        }),
        signal: controller.signal,
      });
      clearTimeout(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("Empty response");
      return text;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  };

  // Race GET endpoints across all models first (fastest, most reliable)
  try {
    const result = await Promise.any([
      makeGet("openai"),
      makeGet("mistral"),
      makeGet("llama"),
      makeGet("openai-large"),
      makeGet("phi"),
      makeGet("gemma"),
    ]);
    if (result) return result;
  } catch {
    // GET attempts failed, try POST
  }

  // POST fallback
  try {
    const result = await Promise.any([
      makePost("openai"),
      makePost("openai-large"),
      makePost("mistral"),
      makePost("llama"),
    ]);
    if (result) return result;
  } catch {
    // all failed
  }

  return "YAC systems offline. All AI endpoints are unreachable. Please try again in a moment.";
}

// ─── DuckDuckGo JSON parser ────────────────────────────────────────────────
function parseDuckDuckGoResponse(raw: string): string {
  if (!raw || !raw.trim())
    return "I could not find a specific answer for that. Try rephrasing your question.";
  try {
    const data = JSON.parse(raw);
    const answer = data.AbstractText || data.Answer || data.Definition || "";
    if (answer.trim()) return answer.trim();
    if (data.RelatedTopics?.length > 0) {
      const first = data.RelatedTopics[0];
      const text = first.Text || first.Topics?.[0]?.Text || "";
      if (text.trim()) return text.trim();
    }
    if (data.Heading && data.AbstractSource) {
      return `${data.Heading}: No detailed summary found. Try searching for more specifics.`;
    }
    return "I could not find a specific answer for that. Try rephrasing your question.";
  } catch {
    if (raw.length > 5 && !raw.startsWith("{")) return raw;
    return "I could not find a specific answer for that. Try rephrasing your question.";
  }
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
            const _r2 = 92;
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
}: {
  connected: boolean;
  messageCount: number;
  uptime: string;
}) {
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("en-US", { hour12: false }));
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
    { label: "SYS TIME", value: currentTime, color: "oklch(0.72 0.18 220)" },
    { label: "UPTIME", value: uptime, color: "oklch(0.65 0.18 220)" },
    { label: "STATUS", value: "OPERATIONAL", color: "oklch(0.7 0.18 145)" },
    { label: "POWER", value: "100%", color: "oklch(0.78 0.15 75)" },
  ];

  return (
    <div
      data-ocid="hud.panel"
      className="iron-panel rounded-lg p-4 w-full hud-brackets"
      style={{ height: 320, position: "relative" }}
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
  const { data: connected = false } = useIsConnected();

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem("yac-history");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed.slice(-50);
      }
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

  const recognitionRef = useRef<any>(null);
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const wakeListenerRef = useRef<any>(null);
  const wakeWordActiveRef = useRef(false);
  const [voiceStatus, setVoiceStatus] = useState("");

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
    const tick = () => {
      const now = new Date();
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
      const mon = months[now.getMonth()];
      const day = String(now.getDate()).padStart(2, "0");
      const yr = now.getFullYear();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      setLiveTime(`${mon} ${day} ${yr} | ${hh}:${mm}:${ss}`);
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
          content: parseDuckDuckGoResponse(entry.response.content),
          timestamp: Number(entry.response.timestamp),
        });
      }
    }
    setChatMessages(seeded);
  }, [remoteMessages]);

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
        const response = await callGeminiAPI(text.trim());
        const responseMsg: ChatMessage = {
          id: `jarvis-${Date.now()}`,
          role: "assistant",
          content: response,
          timestamp: Date.now(),
        };
        setChatMessages((prev) =>
          prev.filter((m) => m.id !== pendingId).concat(responseMsg),
        );
        speakText(response);
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
      const transcript = event.results[0][0].transcript;
      setListening(false);
      sendMessage(transcript);
    };
    recognition.onerror = (event: any) => {
      setListening(false);
      const errorCode = event?.error || "";
      if (errorCode === "not-allowed" || errorCode === "permission-denied") {
        setVoiceStatus("MICROPHONE ACCESS DENIED - CHECK BROWSER SETTINGS");
      } else if (errorCode === "no-speech") {
        setVoiceStatus("NO SPEECH DETECTED - TRY AGAIN");
      } else if (errorCode === "network") {
        setVoiceStatus("NETWORK ERROR - CHECK CONNECTION");
      } else if (errorCode === "aborted") {
        setVoiceStatus("LISTENING STOPPED");
      } else {
        setVoiceStatus("VOICE ERROR - TRY AGAIN");
      }
      if (wakeWordActiveRef.current) {
        setTimeout(() => startWakeListener(), 500);
      }
    };
    recognition.onend = () => {
      setListening(false);
      if (!resultReceived && !wakeWordActiveRef.current) {
        setVoiceStatus("NO SPEECH DETECTED - TRY AGAIN");
      }
      if (wakeWordActiveRef.current) {
        setTimeout(() => startWakeListener(), 300);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, sendMessage]);

  const startWakeListener = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition || !wakeWordActiveRef.current) return;
    try {
      const wakeRec = new SpeechRecognition();
      wakeRec.lang = "en-US";
      wakeRec.continuous = true;
      wakeRec.interimResults = true;
      wakeRec.maxAlternatives = 1;
      wakeRec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.toLowerCase();
          if (transcript.includes("jar")) {
            // Wake word detected!
            wakeRec.stop();
            setWakeWordDetected(true);
            setTimeout(() => setWakeWordDetected(false), 2000);
            // Start command recognition
            const SR2 =
              (window as any).SpeechRecognition ||
              (window as any).webkitSpeechRecognition;
            const cmdRec = new SR2();
            cmdRec.lang = "en-US";
            cmdRec.interimResults = false;
            cmdRec.maxAlternatives = 1;
            cmdRec.onresult = (ev: any) => {
              const cmd = ev.results[0][0].transcript;
              setListening(false);
              sendMessage(cmd);
            };
            cmdRec.onerror = () => {
              setListening(false);
              if (wakeWordActiveRef.current)
                setTimeout(() => startWakeListener(), 500);
            };
            cmdRec.onend = () => {
              setListening(false);
              if (wakeWordActiveRef.current)
                setTimeout(() => startWakeListener(), 500);
            };
            recognitionRef.current = cmdRec;
            setListening(true);
            cmdRec.start();
            break;
          }
        }
      };
      wakeRec.onerror = () => {
        if (wakeWordActiveRef.current)
          setTimeout(() => startWakeListener(), 1000);
      };
      wakeRec.onend = () => {
        if (wakeWordActiveRef.current) {
          setTimeout(() => startWakeListener(), 300);
        }
      };
      wakeListenerRef.current = wakeRec;
      wakeRec.start();
    } catch (_e) {
      // ignore
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
      wakeListenerRef.current?.stop();
      wakeListenerRef.current = null;
    } else {
      wakeWordActiveRef.current = true;
      setWakeWordActive(true);
      startWakeListener();
    }
  }, [wakeWordActive, startWakeListener]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") sendMessage(textInput);
  };

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
          <div
            className="flex items-center justify-center w-9 h-9"
            style={{
              background: "oklch(0.78 0.15 75 / 0.12)",
              border: "1px solid oklch(0.78 0.15 75 / 0.5)",
              boxShadow: "0 0 16px oklch(0.78 0.15 75 / 0.35)",
              clipPath:
                "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
            }}
          >
            <Zap size={16} style={{ color: "oklch(0.78 0.15 75)" }} />
          </div>
          <div className="flex flex-col leading-none">
            <span
              className="text-lg font-black tracking-[0.2em] uppercase tech-font"
              style={{
                color: "oklch(0.78 0.15 75)",
                textShadow: "0 0 16px oklch(0.78 0.15 75 / 0.6)",
              }}
            >
              J.A.R.V.I.S.
            </span>
            <span
              className="text-[9px] tracking-[0.3em] uppercase tech-font"
              style={{ color: "oklch(0.48 0.06 75)" }}
            >
              YAC INDUSTRIES
            </span>
          </div>
        </div>

        {/* Status bar + Live Clock */}
        <div className="hidden md:flex flex-col items-center gap-1">
          <div
            className="flex items-center gap-3 px-4 py-2 tech-font"
            style={{
              background: "oklch(0.09 0.015 75 / 0.7)",
              border: "1px solid oklch(0.78 0.15 75 / 0.2)",
            }}
          >
            <span
              className="text-[10px] tracking-widest uppercase"
              style={{ color: "oklch(0.5 0.04 75)" }}
            >
              MARK XLVII
            </span>
            <span style={{ color: "oklch(0.3 0.05 75)" }}>•</span>
            <span
              className="text-[10px] tracking-widest uppercase hud-blink"
              style={{ color: "oklch(0.7 0.18 145)" }}
            >
              ONLINE
            </span>
            <span style={{ color: "oklch(0.3 0.05 75)" }}>•</span>
            <span
              className="text-[10px] tracking-widest uppercase"
              style={{ color: "oklch(0.78 0.15 75)" }}
            >
              POWER: 100%
            </span>
          </div>
          {liveTime && (
            <div
              className="text-[10px] tracking-widest uppercase tech-font px-3 py-1"
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
          <div
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 tech-font"
            style={{
              background: connected
                ? "oklch(0.25 0.1 145 / 0.2)"
                : "oklch(0.25 0.15 25 / 0.2)",
              border: `1px solid ${connected ? "oklch(0.55 0.15 145 / 0.5)" : "oklch(0.48 0.22 25 / 0.5)"}`,
              color: connected ? "oklch(0.7 0.18 145)" : "oklch(0.65 0.25 25)",
            }}
          >
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connected ? "ONLINE" : "OFFLINE"}
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

                {/* Wake word toggle */}
                <div className="flex items-center gap-2 mt-1">
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
                    WAKE WORD: {wakeWordActive ? "ON" : "OFF"}
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
                      query: "What are the top news headlines right now today?",
                    },
                    {
                      label: "WEATHER",
                      query: "What is the current weather forecast today?",
                    },
                    {
                      label: "SPORTS",
                      query:
                        "What are the latest sports scores and results today?",
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
                connected={connected}
                messageCount={
                  chatMessages.filter((m) => m.role === "user").length
                }
                uptime={uptime}
              />
            </motion.div>
          </div>

          {/* Mobile panels */}
          <div className="lg:hidden w-full max-w-md mt-8 space-y-4">
            <ChatTranscriptPanel messages={chatMessages} />
            <SystemStatusPanel
              connected={connected}
              messageCount={
                chatMessages.filter((m) => m.role === "user").length
              }
              uptime={uptime}
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
