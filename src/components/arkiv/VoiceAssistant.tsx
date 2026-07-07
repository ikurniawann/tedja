"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, X, Hand } from "lucide-react";

/* ── App Mapping ──────────────────────────────────────────────── */
const APPS: Record<string, string> = {
  hr: "/dashboard/hris", hris: "/dashboard/hris", hiring: "/dashboard/hris",
  employee: "/dashboard/hris", payroll: "/dashboard/hris",
  erp: "/dashboard/erp", purchasing: "/dashboard/purchasing",
  procurement: "/dashboard/purchasing", inventory: "/dashboard/erp",
  crm: "/dashboard/crm", customer: "/dashboard/crm", lead: "/dashboard/crm",
  pipeline: "/dashboard/crm",
  pos: "https://suluinwounderland.com/dashboard/pos/cashier-new",
  cashier: "https://suluinwounderland.com/dashboard/pos/cashier-new",
  order: "https://suluinwounderland.com/dashboard/pos/orders",
  kitchen: "https://suluinwounderland.com/dashboard/pos/kds",
  kds: "https://suluinwounderland.com/dashboard/pos/kds",
  creative: "/dashboard/creative", design: "/dashboard/creative",
  render: "/dashboard/render", settings: "/dashboard/settings",
  profile: "/dashboard/profile", desktop: "/arkiv-os", home: "/arkiv-os",
};

/* ── Types ──────────────────────────────────────────────────────── */
type ClapState = "idle" | "waiting-gesture" | "listening" | "detected";
type SpeechRecognitionConstructor = new () => SpeechRecognition;
type BrowserWindowWithSpeech = Window & typeof globalThis & { webkitSpeechRecognition?: SpeechRecognitionConstructor };
type BrowserWindowWithAudio = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function getErrorDetails(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

export function VoiceAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState("Tekan mikrofon untuk mulai bicara");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [clapState, setClapState] = useState<ClapState>("idle");
  const [debugLevel, setDebugLevel] = useState(0); // 0-100 for debug bar

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const finalTranscriptRef = useRef("");

  /* ── Clap detection refs ─────────────────────────────────────────── */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const clapRafRef = useRef<number | null>(null);
  const clapCooldownRef = useRef(false);
  const clapBufferRef = useRef<number[]>([]);
  const lastPeakRef = useRef(0);

  /* ── Speech Recognition Init ─────────────────────────────────────── */
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || (window as BrowserWindowWithSpeech).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    setHasMic(true);

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "id-ID";

    rec.onstart = () => { setIsListening(true); setStatus("Mendengarkan..."); };

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscriptRef.current += e.results[i][0].transcript;
          handleEnd(finalTranscriptRef.current.trim());
        } else {
          interim += e.results[i][0].transcript;
          setStatus(interim || "Mendengarkan...");
        }
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      if (e.error === "no-speech") setStatus("Tidak ada suara, coba lagi.");
      else if (e.error === "not-allowed") setStatus("Izin mikrofon ditolak.");
      else if (e.error === "network") setStatus("Error jaringan.");
      else setStatus(`Error: ${e.error}`);
    };

    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
  }, []);

  /* ── Clap Detection Core ────────────────────────────────────────── */
  const startClapDetection = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      console.error("[Clap] getUserMedia not supported");
      return;
    }
    try {
      console.log("[Clap] Requesting mic access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;
      console.log("[Clap] Mic access granted");

      const AudioCtx = window.AudioContext || (window as BrowserWindowWithAudio).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      // Handle suspended state (Chrome autoplay policy)
      if (audioCtx.state === "suspended") {
        console.log("[Clap] AudioContext suspended, waiting for user gesture...");
        setClapState("waiting-gesture");
        return; // Will resume on user click
      }

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512; // Higher resolution
      analyser.smoothingTimeConstant = 0.05; // Less smoothing = more responsive
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      console.log("[Clap] Detection loop started");
      setClapState("listening");

      const detect = () => {
        analyser.getByteTimeDomainData(dataArray);

        // Calculate peak amplitude from waveform (centered at 128)
        let peak = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = Math.abs(dataArray[i] - 128) / 128;
          if (normalized > peak) peak = normalized;
        }

        lastPeakRef.current = peak;
        setDebugLevel(Math.round(peak * 100));

        clapBufferRef.current.push(peak);
        if (clapBufferRef.current.length > 15) clapBufferRef.current.shift();

        const recent = clapBufferRef.current.slice(-4);
        const maxRecent = Math.max(...recent);
        const prev = clapBufferRef.current.slice(-8, -4);
        const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;

        // Clap: sudden HIGH peak after QUIET period
        // Threshold lowered to 0.35 for better sensitivity
        if (
          !clapCooldownRef.current &&
          maxRecent > 0.35 &&        // loud peak (0-1 range)
          prevAvg < 0.08 &&        // quiet before
          recent.length >= 2
        ) {
          console.log(`[Clap] DETECTED! peak=${maxRecent.toFixed(3)}, prevAvg=${prevAvg.toFixed(3)}`);
          clapCooldownRef.current = true;
          setClapState("detected");
          setStatus("👏 Clap terdeteksi — membuka HRIS...");

          setTimeout(() => {
            window.location.href = "/dashboard/hris";
          }, 500);

          setTimeout(() => {
            clapCooldownRef.current = false;
            setClapState("listening");
            console.log("[Clap] Cooldown reset");
          }, 2500);
        }

        clapRafRef.current = requestAnimationFrame(detect);
      };

      clapRafRef.current = requestAnimationFrame(detect);
    } catch (error: unknown) {
      const details = getErrorDetails(error);
      console.warn("[Clap] Error:", details.name, details.message);
      setClapState("idle");
    }
  }, []);

  const stopClapDetection = useCallback(() => {
    console.log("[Clap] Stopping detection...");
    if (clapRafRef.current) { cancelAnimationFrame(clapRafRef.current); clapRafRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach((t) => t.stop()); micStreamRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(()=>{}); audioCtxRef.current = null; }
    analyserRef.current = null;
    setClapState("idle");
  }, []);

  /* ── Resume AudioContext on user click ──────────────────────────── */
  const enableClapAfterGesture = useCallback(async () => {
    console.log("[Clap] User gesture received — enabling...");
    if (audioCtxRef.current?.state === "suspended") {
      await audioCtxRef.current.resume();
      console.log("[Clap] AudioContext resumed!");
    }
    // Restart detection
    stopClapDetection();
    setTimeout(() => startClapDetection(), 100);
  }, [startClapDetection, stopClapDetection]);

  /* ── Try auto-start on mount (will be suspended until gesture) ──── */
  useEffect(() => {
    startClapDetection();
    return () => stopClapDetection();
  }, [startClapDetection, stopClapDetection]);

  /* ── Cleanup ───────────────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      stopClapDetection();
      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch {}
      if (abortRef.current) abortRef.current.abort();
      window.speechSynthesis.cancel();
    };
  }, [stopClapDetection]);

  /* ── TTS ───────────────────────────────────────────────────────── */
  const speakText = useCallback((text: string, onEnd?: () => void) => {
    if (!window.speechSynthesis) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "id-ID";
    utter.rate = 1.05;
    utter.onend = () => { setSpeaking(false); onEnd?.(); };
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }, []);

  /* ── Command parser ────────────────────────────────────────────── */
  const parseCommand = (text: string) => {
    const lower = text.toLowerCase();
    for (const [keyword, url] of Object.entries(APPS)) {
      if (
        lower.includes(`buka ${keyword}`) ||
        lower.includes(`buka aplikasi ${keyword}`) ||
        lower.includes(`pergi ke ${keyword}`) ||
        lower.includes(`ke ${keyword}`)
      ) return { type: "open" as const, url, app: keyword };
    }
    if (lower.includes("ke desktop") || lower.includes("ke beranda")) {
      return { type: "open" as const, url: "/arkiv-os", app: "desktop" };
    }
    return { type: "ask" as const, text };
  };

  /* ── Arkiv AI Agent ─────────────────────────────────────────────── */
  const askOllama = async (userText: string) => {
    setThinking(true);
    setStatus("Berpikir...");
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
        signal: abortRef.current.signal,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI Assistant error");
      const answer = json.answer || "Maaf, saya belum mendapat jawaban.";
      setResponse(answer);
      setThinking(false);
      return answer;
    } catch {
      setThinking(false);
      const fallback = "Maaf, AI Assistant sedang tidak tersedia. Coba lagi sebentar.";
      setResponse(fallback);
      return fallback;
    }
  };

  /* ── Handle end of speech ───────────────────────────────────────── */
  const handleEnd = async (text: string) => {
    if (!text) return;
    setTranscript(text);
    const cmd = parseCommand(text);

    if (cmd.type === "open") {
      const reply = `Baik, membuka aplikasi ${cmd.app}.`;
      setResponse(reply);
      speakText(reply, () => { window.location.href = cmd.url; });
    } else {
      const aiResponse = await askOllama(text);
      if (aiResponse) speakText(aiResponse);
    }
  };

  /* ── Toggle listening ────────────────────────────────────────────── */
  const toggleListening = () => {
    if (!recognitionRef.current) { setStatus("Browser tidak support Speech Recognition. Gunakan Chrome/Edge."); return; }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      finalTranscriptRef.current = "";
      setTranscript("");
      setResponse("");
      setStatus("Mendengarkan...");
      recognitionRef.current.start();
    }
  };

  /* ── Close modal ─────────────────────────────────────────────────── */
  const closeModal = () => {
    setIsOpen(false);
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch {}
    if (abortRef.current) abortRef.current.abort();
    window.speechSynthesis.cancel();
    setIsListening(false);
    setSpeaking(false);
    setThinking(false);
  };

  if (!hasMic) return null;

  const fabClick = () => {
    if (clapState === "waiting-gesture") {
      enableClapAfterGesture();
    }
    setIsOpen(true);
    setTranscript("");
    setResponse("");
    setStatus("Tekan mikrofon untuk mulai bicara");
  };

  return (
    <>
      {/* Debug level indicator (tiny bar at bottom-right) */}
      {clapState === "listening" && (
        <div className="fixed bottom-20 right-5 z-[55] h-1 w-14 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all"
            style={{ width: `${Math.min(debugLevel, 100)}%`, opacity: debugLevel > 5 ? 1 : 0.3 }}
          />
        </div>
      )}

      {/* Floating mic button with clap pulse ring */}
      <button
        onClick={fabClick}
        className="fixed bottom-24 right-5 z-50 grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-cyan-400/90 text-black shadow-lg shadow-cyan-400/30 backdrop-blur-md transition hover:scale-110 hover:shadow-cyan-400/50 active:scale-95"
        title={clapState === "waiting-gesture" ? "Klik untuk aktifkan deteksi tepuk" : "Arkiv Voice Assistant — Tepuk tangan untuk buka HRIS"}
      >
        {clapState === "waiting-gesture" ? <Hand className="size-6" /> : <Mic className="size-6" />}
        {/* Clap listening indicator ring */}
        {clapState === "listening" && (
          <span className="absolute inset-0 rounded-full border border-cyan-400/40 animate-ping" style={{ animationDuration: "2s" }} />
        )}
        {clapState === "detected" && (
          <span className="absolute inset-[-8px] rounded-full border-2 border-amber-400 animate-ping" style={{ animationDuration: "0.6s" }} />
        )}
      </button>

      {/* Waiting-gesture tooltip */}
      {clapState === "waiting-gesture" && (
        <div className="fixed bottom-[7.5rem] right-5 z-[55] rounded-xl bg-amber-500/90 px-3 py-1.5 text-xs font-semibold text-black shadow-lg backdrop-blur-md">
          👆 Klik tombol mic untuk aktifkan deteksi tepuk
        </div>
      )}

      {/* Modal overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div
            className="relative w-[90vw] max-w-md rounded-3xl border border-white/15 bg-slate-950/90 p-6 shadow-2xl backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-400/20 text-cyan-400">
                  <Mic className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Arkiv Voice Assistant</h3>
                  <p className="text-xs text-white/50">
                    {clapState === "listening" ? "👏 Tepuk tangan untuk buka HRIS" : "Tepuk tangan atau tekan mikrofon"}
                  </p>
                </div>
              </div>
              <button
                onClick={closeModal}
                className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* wave animation */}
            <div className="mb-6 flex flex-col items-center">
              <div
                className={`mb-4 flex h-16 items-center justify-center gap-[3px] transition-opacity ${isListening || thinking || speaking ? "opacity-100" : "opacity-40"}`}
              >
                {[0, 0.1, 0.2, 0.3, 0.15, 0.05, 0.25].map((delay, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-full transition-colors ${speaking ? "bg-amber-400" : "bg-cyan-400"}`}
                    style={{
                      height: `${[16, 32, 24, 40, 20, 32, 16][i]}px`,
                      animation: `voiceWave ${isListening ? 0.5 : thinking ? 0.8 : speaking ? 0.3 : 1.2}s ease-in-out ${delay}s infinite`,
                    }}
                  />
                ))}
              </div>
              <p className="text-center text-sm font-medium text-white/90">{status}</p>
            </div>

            {/* mic big button */}
            <div className="mb-6 flex justify-center">
              <button
                onClick={toggleListening}
                className={`grid h-16 w-16 place-items-center rounded-full border transition active:scale-95 ${
                  isListening
                    ? "border-cyan-400/40 bg-cyan-400/30 text-cyan-300"
                    : "border-cyan-400/30 bg-cyan-400/20 text-cyan-400 hover:bg-cyan-400/30"
                }`}
              >
                {isListening ? <Square className="size-7" /> : <Mic className="size-7" />}
              </button>
            </div>

            {/* transcript */}
            {transcript && (
              <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/40">Anda bilang:</p>
                <p className="text-sm font-medium text-white">{transcript}</p>
              </div>
            )}

            {/* AI response */}
            {response && (
              <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-4">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400">Arkiv AI:</p>
                <p className="text-sm font-medium leading-relaxed text-white">{response}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes voiceWave {
          0%, 100% { transform: scaleY(1); opacity: 0.5; }
          50% { transform: scaleY(1.6); opacity: 1; }
        }
      `}</style>
    </>
  );
}
