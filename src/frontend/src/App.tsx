import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  ChevronRight,
  Globe,
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
import { useGetAllMessages, useIsConnected } from "./hooks/useQueries";

// ─── Types ───────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  timestamp: number;
}

// ─── DuckDuckGo JSON parser ────────────────────────────────────────────────
function parseDuckDuckGoResponse(raw: string): string {
  if (!raw || !raw.trim())
    return "I could not find a specific answer for that. Try rephrasing your question.";
  // Try JSON parse
  try {
    const data = JSON.parse(raw);
    const answer = data.AbstractText || data.Answer || data.Definition || "";
    if (answer.trim()) return answer.trim();
    // If there are related topics, use the first one
    if (data.RelatedTopics?.length > 0) {
      const first = data.RelatedTopics[0];
      const text = first.Text || first.Topics?.[0]?.Text || "";
      if (text.trim()) return text.trim();
    }
    // Heading as last resort
    if (data.Heading && data.AbstractSource) {
      return `${data.Heading}: No detailed summary found. Try searching for more specifics.`;
    }
    return "I could not find a specific answer for that. Try rephrasing your question.";
  } catch {
    // Not JSON, return as-is if it looks like real text
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
    // Fallback timeout in case event never fires
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

// ─── Animated Orb ────────────────────────────────────────────────────────────
function AnimatedOrb({ listening }: { listening: boolean }) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 320, height: 320 }}
    >
      {/* Outer ambient glow */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, oklch(0.45 0.2 255 / 0.15) 0%, transparent 70%)",
          filter: "blur(20px)",
        }}
      />
      {/* Slowest spinning ring */}
      <div
        className="absolute ring-spin-slow"
        style={{ width: 300, height: 300 }}
      >
        <div
          className="w-full h-full rounded-full"
          style={{
            border: "1px solid oklch(0.82 0.12 183 / 0.2)",
            boxShadow: "0 0 12px oklch(0.82 0.12 183 / 0.1)",
          }}
        />
      </div>
      {/* Medium reverse ring */}
      <div
        className="absolute ring-spin-reverse"
        style={{ width: 260, height: 260 }}
      >
        <div
          className="w-full h-full rounded-full"
          style={{
            border: "1px dashed oklch(0.75 0.14 210 / 0.25)",
          }}
        />
      </div>
      {/* Fast spinning ring */}
      <div className="absolute ring-spin" style={{ width: 220, height: 220 }}>
        <div
          className="w-full h-full rounded-full"
          style={{
            border: "1.5px solid oklch(0.82 0.12 183 / 0.4)",
            boxShadow: "0 0 16px oklch(0.82 0.12 183 / 0.2) inset",
          }}
        />
      </div>
      {/* Plasma core */}
      <div className="absolute orb-pulse" style={{ width: 170, height: 170 }}>
        <div
          className="w-full h-full rounded-full"
          style={{
            background:
              "radial-gradient(circle at 40% 35%, oklch(0.82 0.12 183 / 0.9), oklch(0.65 0.18 225 / 0.8) 40%, oklch(0.45 0.2 255 / 0.7) 70%, oklch(0.12 0.018 228 / 0.4))",
            boxShadow:
              "0 0 30px oklch(0.82 0.12 183 / 0.5), 0 0 60px oklch(0.75 0.14 210 / 0.3), 0 0 100px oklch(0.45 0.2 255 / 0.2)",
            filter: "blur(1px)",
          }}
        />
      </div>
      {/* Inner plasma drift */}
      <div
        className="absolute plasma-drift"
        style={{ width: 100, height: 100, top: "50%", left: "50%" }}
      >
        <div
          className="w-full h-full rounded-full"
          style={{
            background:
              "radial-gradient(circle, oklch(0.9 0.1 183 / 0.8), oklch(0.82 0.12 183 / 0.3) 50%, transparent)",
            filter: "blur(4px)",
          }}
        />
      </div>
      {/* Listening pulse overlay */}
      <AnimatePresence>
        {listening && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1.2 }}
            exit={{ opacity: 0 }}
            transition={{
              repeat: Number.POSITIVE_INFINITY,
              duration: 1,
              repeatType: "reverse",
            }}
            className="absolute rounded-full"
            style={{
              width: 190,
              height: 190,
              border: "2px solid oklch(0.82 0.12 183 / 0.8)",
              boxShadow: "0 0 30px oklch(0.82 0.12 183 / 0.6)",
            }}
          />
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
                ? `oklch(${0.82 - (i % 3) * 0.05} ${0.12 + (i % 4) * 0.02} ${183 + (i % 5) * 5})`
                : "oklch(0.25 0.025 228)",
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
      className="glass-card rounded-2xl p-4 w-full flex flex-col"
      style={{ height: 320 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={14} style={{ color: "oklch(0.82 0.12 183)" }} />
        <span
          className="text-xs font-semibold tracking-widest uppercase"
          style={{
            color: "oklch(0.82 0.12 183)",
            textShadow: "0 0 8px oklch(0.82 0.12 183 / 0.6)",
          }}
        >
          Chat Transcript
        </span>
        <span
          className="ml-auto text-xs px-2 py-0.5 rounded-full"
          style={{
            background: "oklch(0.82 0.12 183 / 0.15)",
            color: "oklch(0.82 0.12 183)",
          }}
        >
          {messages.length}
        </span>
      </div>
      <ScrollArea className="flex-1 pr-1">
        <div className="space-y-3">
          {messages.length === 0 ? (
            <p
              className="text-xs text-center py-6"
              style={{ color: "oklch(0.58 0.02 228)" }}
            >
              Waiting for input...
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
                  className="text-[10px] font-medium tracking-wider uppercase"
                  style={{
                    color:
                      msg.role === "user"
                        ? "oklch(0.65 0.18 225)"
                        : "oklch(0.82 0.12 183)",
                  }}
                >
                  {msg.role === "user" ? "You" : "JARVIS"}
                </span>
                <div
                  className="text-xs px-3 py-2 rounded-xl max-w-[90%]"
                  style={{
                    background:
                      msg.role === "user"
                        ? "oklch(0.45 0.2 255 / 0.2)"
                        : "oklch(0.82 0.12 183 / 0.1)",
                    border: `1px solid ${msg.role === "user" ? "oklch(0.65 0.18 225 / 0.3)" : "oklch(0.82 0.12 183 / 0.25)"}`,
                    color: msg.pending
                      ? "oklch(0.58 0.02 228)"
                      : "oklch(0.94 0.01 230)",
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
      color: connected ? "oklch(0.75 0.18 145)" : "oklch(0.65 0.25 25)",
      dot: true,
    },
    {
      label: "QUERIES",
      value: String(messageCount),
      color: "oklch(0.82 0.12 183)",
    },
    { label: "SYS TIME", value: currentTime, color: "oklch(0.75 0.14 210)" },
    { label: "UPTIME", value: uptime, color: "oklch(0.65 0.18 225)" },
    { label: "STATUS", value: "OPERATIONAL", color: "oklch(0.75 0.18 145)" },
    { label: "VERSION", value: "v2.1.0", color: "oklch(0.58 0.02 228)" },
  ];

  return (
    <div
      data-ocid="hud.panel"
      className="glass-card rounded-2xl p-4 w-full"
      style={{ height: 320 }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Brain size={14} style={{ color: "oklch(0.75 0.14 210)" }} />
        <span
          className="text-xs font-semibold tracking-widest uppercase"
          style={{
            color: "oklch(0.75 0.14 210)",
            textShadow: "0 0 8px oklch(0.75 0.14 210 / 0.6)",
          }}
        >
          System Status
        </span>
      </div>
      <div className="space-y-3">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between">
            <span
              className="text-[10px] tracking-widest uppercase"
              style={{ color: "oklch(0.58 0.02 228)" }}
            >
              {m.label}
            </span>
            <div className="flex items-center gap-1.5">
              {m.dot && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: m.color,
                    boxShadow: `0 0 6px ${m.color}`,
                  }}
                />
              )}
              <span
                className="text-xs font-semibold font-mono"
                style={{ color: m.color, textShadow: `0 0 8px ${m.color}60` }}
              >
                {m.value}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div
        className="mt-4 pt-3 rounded-lg text-center text-[10px] tracking-widest uppercase"
        style={{
          border: "1px solid oklch(0.82 0.12 183 / 0.2)",
          background: "oklch(0.82 0.12 183 / 0.05)",
          color: "oklch(0.82 0.12 183 / 0.7)",
          padding: "8px",
        }}
      >
        JARVIS AI ● Internet Connected
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  const { data: remoteMessages = [] } = useGetAllMessages();
  const { data: connected = false } = useIsConnected();

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [listening, setListening] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [startTime] = useState(Date.now());
  const [uptime, setUptime] = useState("00:00:00");

  const recognitionRef = useRef<any>(null);

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
    const voices = await loadVoices();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.92;
    utt.pitch = 0.8;
    utt.volume = 1.0;
    const voice = pickJarvisVoice(voices);
    if (voice) utt.voice = voice;
    window.speechSynthesis.speak(utt);
  }, []);

  const pollForResponse = useCallback(
    async (id: bigint, pendingId: string) => {
      if (!actor) return;
      const maxAttempts = 30;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const entry: ConversationEntry = await actor.getMessage(id);
          if (entry.response.content) {
            const responseMsg: ChatMessage = {
              id: `jarvis-${id}`,
              role: "assistant",
              content: parseDuckDuckGoResponse(entry.response.content),
              timestamp: Date.now(),
            };
            setChatMessages((prev) =>
              prev.filter((m) => m.id !== pendingId).concat(responseMsg),
            );
            speakText(parseDuckDuckGoResponse(entry.response.content));
            queryClient.invalidateQueries({ queryKey: ["messages"] });
            return;
          }
        } catch {
          // continue polling
        }
      }
      // Timeout
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                ...m,
                content: "[No response received. Please try again.]",
                pending: false,
              }
            : m,
        ),
      );
    },
    [actor, speakText, queryClient],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !actor || isSending) return;
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
        const msgId = await actor.sendMessage(text.trim());
        await pollForResponse(msgId, pendingId);
      } catch (_err) {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  ...m,
                  content:
                    "[Error communicating with JARVIS. Please try again.]",
                  pending: false,
                }
              : m,
          ),
        );
      } finally {
        setIsSending(false);
      }
    },
    [actor, isSending, pollForResponse],
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
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setListening(false);
      sendMessage(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") sendMessage(textInput);
  };

  const features = [
    {
      icon: <Mic size={22} />,
      title: "Voice Control",
      desc: "Speak naturally and JARVIS understands your commands with high-accuracy speech recognition powered by the Web Speech API.",
    },
    {
      icon: <Globe size={22} />,
      title: "Internet Connected",
      desc: "JARVIS has real-time access to the internet, pulling live data, news, weather, and information to give you accurate answers.",
    },
    {
      icon: <Sparkles size={22} />,
      title: "Smart Responses",
      desc: "Powered by advanced AI, JARVIS reasons through complex queries and delivers context-aware, intelligent responses instantly.",
    },
  ];

  const steps = [
    {
      num: "01",
      title: "Speak",
      desc: "Activate the microphone or type your query. JARVIS listens with precision and clarity.",
    },
    {
      num: "02",
      title: "Process",
      desc: "Your input is analyzed and sent through JARVIS's AI pipeline with live internet context.",
    },
    {
      num: "03",
      title: "Respond",
      desc: "JARVIS delivers an intelligent, spoken response and displays it in the transcript panel.",
    },
  ];

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background:
          "linear-gradient(180deg, oklch(0.07 0.01 230) 0%, oklch(0.085 0.012 228) 100%)",
      }}
    >
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-4"
        style={{
          borderBottom: "1px solid oklch(0.25 0.025 228 / 0.5)",
          background: "oklch(0.07 0.01 230 / 0.9)",
          backdropFilter: "blur(16px)",
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-lg"
            style={{
              background: "oklch(0.82 0.12 183 / 0.15)",
              border: "1px solid oklch(0.82 0.12 183 / 0.4)",
              boxShadow: "0 0 12px oklch(0.82 0.12 183 / 0.3)",
            }}
          >
            <Zap size={18} style={{ color: "oklch(0.82 0.12 183)" }} />
          </div>
          <span
            className="text-xl font-bold tracking-widest uppercase"
            style={{
              color: "oklch(0.82 0.12 183)",
              textShadow: "0 0 12px oklch(0.82 0.12 183 / 0.5)",
            }}
          >
            JARVIS
          </span>
        </div>
        {/* Nav */}
        <nav
          className="hidden md:flex items-center gap-1 px-4 py-2 rounded-full"
          style={{
            background: "oklch(0.12 0.018 228 / 0.8)",
            border: "1px solid oklch(0.25 0.025 228)",
          }}
        >
          {["Features", "How It Works", "About"].map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase().replace(" ", "-")}`}
              data-ocid="nav.link"
              className="px-4 py-1.5 text-sm rounded-full transition-colors"
              style={{ color: "oklch(0.72 0.02 228)" }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.color = "oklch(0.82 0.12 183)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.color = "oklch(0.72 0.02 228)";
              }}
            >
              {link}
            </a>
          ))}
        </nav>
        {/* CTAs */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
            style={{
              background: connected
                ? "oklch(0.3 0.1 145 / 0.2)"
                : "oklch(0.3 0.15 25 / 0.2)",
              border: `1px solid ${connected ? "oklch(0.55 0.15 145 / 0.5)" : "oklch(0.55 0.2 25 / 0.5)"}`,
              color: connected ? "oklch(0.75 0.18 145)" : "oklch(0.65 0.25 25)",
            }}
          >
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connected ? "Online" : "Offline"}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ─── Hero Section ─────────────────────────────────────────────── */}
        <section className="relative flex flex-col items-center pt-16 pb-20 px-4 overflow-hidden">
          {/* Background vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 50% 30%, oklch(0.45 0.2 255 / 0.08), transparent)",
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="mb-2 text-xs font-semibold tracking-[0.3em] uppercase"
            style={{ color: "oklch(0.82 0.12 183)" }}
          >
            Next-Generation AI Assistant
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-5xl md:text-6xl font-bold text-center mb-4 leading-tight"
            style={{ color: "oklch(0.94 0.01 230)" }}
          >
            Meet{" "}
            <span
              style={{
                color: "oklch(0.82 0.12 183)",
                textShadow:
                  "0 0 20px oklch(0.82 0.12 183 / 0.5), 0 0 40px oklch(0.82 0.12 183 / 0.25)",
              }}
            >
              JARVIS
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-base mb-14 text-center max-w-lg"
            style={{ color: "oklch(0.72 0.02 228)" }}
          >
            Your intelligent AI companion with real-time internet connectivity.
            Speak. Ask. Discover.
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

            {/* Center: Orb + Controls */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.15 }}
              className="flex flex-col items-center flex-shrink-0"
            >
              <AnimatedOrb listening={listening} />

              {/* Mic button */}
              <div className="mt-4 flex flex-col items-center gap-3">
                <button
                  type="button"
                  data-ocid="jarvis.mic.button"
                  onClick={toggleListening}
                  disabled={isSending}
                  className="relative rounded-full transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
                  style={{
                    width: 72,
                    height: 72,
                    background: listening
                      ? "oklch(0.82 0.12 183 / 0.2)"
                      : "oklch(0.14 0.02 228)",
                    border: `2px solid ${listening ? "oklch(0.82 0.12 183)" : "oklch(0.25 0.025 228)"}`,
                    boxShadow: listening
                      ? "0 0 20px oklch(0.82 0.12 183 / 0.5), 0 0 40px oklch(0.82 0.12 183 / 0.25)"
                      : "0 0 10px oklch(0.12 0.018 228)",
                    animation: listening
                      ? "mic-listening 1.2s ease-in-out infinite"
                      : "none",
                  }}
                >
                  {/* Double ring */}
                  {listening && (
                    <>
                      <div
                        className="absolute rounded-full ring-spin pointer-events-none"
                        style={{
                          inset: -8,
                          border: "1px solid oklch(0.82 0.12 183 / 0.4)",
                        }}
                      />
                      <div
                        className="absolute rounded-full ring-spin-reverse pointer-events-none"
                        style={{
                          inset: -16,
                          border: "1px dashed oklch(0.75 0.14 210 / 0.3)",
                        }}
                      />
                    </>
                  )}
                  <div className="flex items-center justify-center w-full h-full">
                    {listening ? (
                      <MicOff
                        size={28}
                        style={{ color: "oklch(0.82 0.12 183)" }}
                      />
                    ) : (
                      <Mic
                        size={28}
                        style={{ color: "oklch(0.72 0.02 228)" }}
                      />
                    )}
                  </div>
                </button>

                <p
                  className="text-sm font-medium tracking-wider"
                  style={{
                    color: listening
                      ? "oklch(0.82 0.12 183)"
                      : "oklch(0.58 0.02 228)",
                  }}
                >
                  {listening ? "Listening..." : "Speak to JARVIS"}
                </p>

                <Waveform listening={listening} />

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
                    placeholder="Or type your message..."
                    disabled={isSending || listening}
                    className="text-sm rounded-full"
                    style={{
                      background: "oklch(0.12 0.018 228)",
                      border: "1px solid oklch(0.25 0.025 228)",
                      color: "oklch(0.94 0.01 230)",
                    }}
                  />
                  <Button
                    data-ocid="jarvis.send.button"
                    onClick={() => sendMessage(textInput)}
                    disabled={isSending || !textInput.trim()}
                    size="icon"
                    className="rounded-full flex-shrink-0"
                    style={{
                      background: "oklch(0.82 0.12 183 / 0.2)",
                      border: "1px solid oklch(0.82 0.12 183 / 0.4)",
                      color: "oklch(0.82 0.12 183)",
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
        <section id="features" className="py-20 px-4">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <p
                className="text-xs font-semibold tracking-[0.3em] uppercase mb-3"
                style={{ color: "oklch(0.82 0.12 183)" }}
              >
                Capabilities
              </p>
              <h2
                className="text-3xl md:text-4xl font-bold mb-4"
                style={{ color: "oklch(0.94 0.01 230)" }}
              >
                Features Overview
              </h2>
              <p
                className="text-base max-w-lg mx-auto"
                style={{ color: "oklch(0.72 0.02 228)" }}
              >
                JARVIS combines cutting-edge voice AI with real-time internet
                access to be the most capable assistant you've ever used.
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
                  className="glass-card rounded-2xl p-6 flex flex-col gap-4 transition-all hover:border-opacity-60"
                  style={{ transition: "box-shadow 0.3s" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow =
                      "0 0 24px oklch(0.82 0.12 183 / 0.15)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                  }}
                >
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-xl"
                    style={{
                      background: "oklch(0.82 0.12 183 / 0.1)",
                      border: "1px solid oklch(0.82 0.12 183 / 0.3)",
                      color: "oklch(0.82 0.12 183)",
                    }}
                  >
                    {f.icon}
                  </div>
                  <h3
                    className="text-lg font-semibold"
                    style={{ color: "oklch(0.94 0.01 230)" }}
                  >
                    {f.title}
                  </h3>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "oklch(0.72 0.02 228)" }}
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
          style={{ borderTop: "1px solid oklch(0.25 0.025 228 / 0.4)" }}
        >
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <p
                className="text-xs font-semibold tracking-[0.3em] uppercase mb-3"
                style={{ color: "oklch(0.75 0.14 210)" }}
              >
                Process
              </p>
              <h2
                className="text-3xl md:text-4xl font-bold mb-4"
                style={{ color: "oklch(0.94 0.01 230)" }}
              >
                How It Works
              </h2>
              <p
                className="text-base max-w-lg mx-auto"
                style={{ color: "oklch(0.72 0.02 228)" }}
              >
                Three simple steps from query to intelligent response.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
              {/* Connector line */}
              <div
                className="hidden md:block absolute top-10 left-1/3 right-1/3 h-px"
                style={{
                  background:
                    "linear-gradient(90deg, oklch(0.82 0.12 183 / 0.3), oklch(0.75 0.14 210 / 0.3))",
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
                  className="glass-card rounded-2xl p-6 flex flex-col gap-3 text-center"
                >
                  <div
                    className="text-3xl font-black font-mono mx-auto"
                    style={{
                      color: "oklch(0.82 0.12 183 / 0.3)",
                      textShadow: "0 0 20px oklch(0.82 0.12 183 / 0.2)",
                    }}
                  >
                    {s.num}
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <h3
                      className="text-lg font-semibold"
                      style={{ color: "oklch(0.94 0.01 230)" }}
                    >
                      {s.title}
                    </h3>
                    <ChevronRight
                      size={16}
                      style={{ color: "oklch(0.82 0.12 183)" }}
                    />
                  </div>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "oklch(0.72 0.02 228)" }}
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
        className="px-6 py-8"
        style={{ borderTop: "1px solid oklch(0.25 0.025 228 / 0.4)" }}
      >
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap size={14} style={{ color: "oklch(0.82 0.12 183)" }} />
            <span
              className="font-bold tracking-widest text-sm uppercase"
              style={{ color: "oklch(0.82 0.12 183)" }}
            >
              JARVIS
            </span>
            <span
              className="text-xs ml-2"
              style={{ color: "oklch(0.58 0.02 228)" }}
            >
              AI Voice Assistant
            </span>
          </div>
          <div className="flex gap-6">
            {["Features", "How It Works", "About"].map((link) => (
              <a
                key={link}
                href={`#${link.toLowerCase().replace(" ", "-")}`}
                className="text-xs transition-colors"
                style={{ color: "oklch(0.58 0.02 228)" }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.color =
                    "oklch(0.82 0.12 183)";
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.color =
                    "oklch(0.58 0.02 228)";
                }}
              >
                {link}
              </a>
            ))}
          </div>
          <p className="text-xs" style={{ color: "oklch(0.58 0.02 228)" }}>
            © {new Date().getFullYear()}. Built with ♥ using{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "oklch(0.72 0.02 228)" }}
            >
              caffeine.ai
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
