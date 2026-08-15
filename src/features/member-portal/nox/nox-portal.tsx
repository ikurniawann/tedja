"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import "./nox.css";

/**
 * Portal member "Nox Lab" — port React dari prototipe membernox.html (Fase A).
 *
 * Fase A = paritas visual dengan data contoh; penyambungan API menyusul di
 * Fase B, login OTP di Fase C, adaptasi mobile di Fase D. Keputusan owner
 * 2026-08-15: Missions, XP Streak, dan Nox Shards DISEMBUNYIKAN (belum ada
 * backend-nya) — yang tampil hanya informasi profil, XP, dan ARK Coins.
 * Mode tersisa: dashboard · profile · coins · history.
 *
 * Perilaku prototipe yang dipertahankan: layar entry, pindah mode via
 * nav/scroll/keyboard, parallax latar & karakter mengikuti kursor, drag
 * kamera, kursor kustom (mati otomatis di layar sentuh), hotspot lore, toast.
 */

const MODES = ["dashboard", "profile", "coins", "history"] as const;
type NoxMode = (typeof MODES)[number];

const MODE_LABELS: Record<NoxMode, string> = {
  dashboard: "Citizen dashboard",
  profile: "Profile",
  coins: "ARK Coins",
  history: "History",
};

/** Teks lore hotspot — flavor dunia, disalin apa adanya dari prototipe. */
const LORE: Record<string, { tag: string; title: string; text: string }> = {
  terminal: {
    tag: "NOX LAB OBJECT / 01",
    title: "Lab Terminal",
    text: "A citizen-facing terminal that translates activity across Wounderland into visible progress. In a production version, this can become a contextual entrance into missions, XP and account status.",
  },
  archive: {
    tag: "NOX LAB OBJECT / 02",
    title: "Archive Shelf",
    text: "The archive is a bridge between profile data and worldbuilding. Rewards, discovered items, campaign artifacts and hidden lore can live here rather than being presented as a conventional inventory grid.",
  },
  bed: {
    tag: "NOX LAB OBJECT / 03",
    title: "Nox Rest Zone",
    text: "A quieter corner of the lab. It can surface streaks, reflection prompts, saved moments or low-pressure return mechanics—giving the dashboard different emotional tempos.",
  },
};

/** Data contoh Fase A — diganti API /api/member-portal/* di Fase B. */
const SAMPLE = {
  name: "CITIZEN",
  coins: 2450,
  xp: 650,
  xpNext: 1250,
  level: 12,
};

export function NoxPortal() {
  const [mode, setMode] = useState<NoxMode>("dashboard");
  const [entered, setEntered] = useState(false);
  const [lore, setLore] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const appRef = useRef<HTMLDivElement>(null);
  const labBgRef = useRef<HTMLDivElement>(null);
  const charWrapRef = useRef<HTMLDivElement>(null);
  const cursorDotRef = useRef<HTMLDivElement>(null);
  const cursorRingRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelLock = useRef(false);
  // Nilai per-frame disimpan di ref, bukan state: loop rAF menulis 60x/detik
  // dan tidak boleh memicu render React.
  const anim = useRef({
    mouseX: 0.5,
    mouseY: 0.5,
    dotX: 0,
    dotY: 0,
    ringX: 0,
    ringY: 0,
    cameraX: 0,
    cameraY: 0,
    drag: false,
    dragX: 0,
    dragY: 0,
  });

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const goMode = useCallback(
    (next: NoxMode, fromScroll = false) => {
      setMode((prev) => {
        if (prev === next) return prev;
        const app = appRef.current;
        if (app) {
          app.classList.add("transitioning");
          setTimeout(() => app.classList.remove("transitioning"), 420);
        }
        if (!fromScroll) showToast(MODE_LABELS[next]);
        return next;
      });
    },
    [showToast]
  );

  /* Scroll & keyboard memindahkan mode — meniru prototipe, dengan kunci 760ms
   * supaya satu gulungan momentum tidak melompati beberapa mode sekaligus. */
  useEffect(() => {
    const stepFrom = (dir: 1 | -1) => {
      setMode((prev) => {
        const idx = MODES.indexOf(prev);
        const next = MODES[Math.max(0, Math.min(MODES.length - 1, idx + dir))];
        if (next !== prev) {
          const app = appRef.current;
          if (app) {
            app.classList.add("transitioning");
            setTimeout(() => app.classList.remove("transitioning"), 420);
          }
        }
        return next;
      });
    };

    const onWheel = (e: WheelEvent) => {
      if (!entered || wheelLock.current || lore) return;
      if (Math.abs(e.deltaY) < 18) return;
      wheelLock.current = true;
      stepFrom(e.deltaY > 0 ? 1 : -1);
      setTimeout(() => (wheelLock.current = false), 760);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!entered) return;
      if (["ArrowDown", "PageDown", "ArrowRight"].includes(e.key)) stepFrom(1);
      if (["ArrowUp", "PageUp", "ArrowLeft"].includes(e.key)) stepFrom(-1);
      if (e.key === "Escape") setLore(null);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [entered, lore]);

  /* Parallax + kursor kustom: satu loop rAF menggerakkan latar, karakter, dan
   * cincin kursor. Di layar sentuh loop tetap jalan (untuk parallax netral)
   * tapi elemen kursornya disembunyikan. */
  useEffect(() => {
    const a = anim.current;
    const isCoarse = window.matchMedia("(pointer:coarse)").matches;
    if (isCoarse) {
      if (cursorDotRef.current) cursorDotRef.current.style.display = "none";
      if (cursorRingRef.current) cursorRingRef.current.style.display = "none";
    }

    const onMove = (e: MouseEvent) => {
      a.mouseX = e.clientX / window.innerWidth;
      a.mouseY = e.clientY / window.innerHeight;
      a.dotX = e.clientX;
      a.dotY = e.clientY;
      if (cursorDotRef.current) {
        cursorDotRef.current.style.transform = `translate(${a.dotX - 2.5}px,${a.dotY - 2.5}px)`;
      }
      if (a.drag) {
        a.cameraX = Math.max(-20, Math.min(20, (e.clientX - a.dragX) * 0.035));
        a.cameraY = Math.max(-12, Math.min(12, (e.clientY - a.dragY) * 0.025));
      }
      const el = e.target instanceof Element ? e.target.closest(".interactive") : null;
      cursorRingRef.current?.classList.toggle("active", Boolean(el) || a.drag);
    };
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("button,.glass,.stat-glass,.hotspot")) return;
      a.drag = true;
      a.dragX = e.clientX;
      a.dragY = e.clientY;
    };
    const onUp = () => {
      a.drag = false;
      a.cameraX *= 0.25;
      a.cameraY *= 0.25;
    };

    let raf = 0;
    const loop = () => {
      a.ringX += (a.dotX - a.ringX) * 0.15;
      a.ringY += (a.dotY - a.ringY) * 0.15;
      if (cursorRingRef.current) {
        cursorRingRef.current.style.transform = `translate(${a.ringX - 17}px,${a.ringY - 17}px)`;
      }
      if (labBgRef.current) {
        labBgRef.current.style.marginLeft = `${(a.mouseX - 0.5) * 10 + a.cameraX}px`;
        labBgRef.current.style.marginTop = `${(a.mouseY - 0.5) * 6 + a.cameraY}px`;
      }
      if (charWrapRef.current) {
        charWrapRef.current.style.marginLeft = `${(a.mouseX - 0.5) * -10}px`;
        charWrapRef.current.style.marginBottom = `${(a.mouseY - 0.5) * -5}px`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const modeIndex = MODES.indexOf(mode);
  const coins = SAMPLE.coins.toLocaleString("id-ID");
  const activeLore = lore ? LORE[lore] : null;

  return (
    <div id="app" ref={appRef} data-mode={mode}>
      <div className="world">
        <div className="lab-bg" ref={labBgRef} />
        <div className="ambient a" />
        <div className="ambient b" />
        <div className="scanlines" />
        <div className="noise" />
      </div>

      <div className="shadow" />
      <div className="character-wrap" ref={charWrapRef}>
        {/* next/image tidak dipakai: elemen ini digeser tiap frame oleh loop
            parallax dan butuh ukuran intrinsik CSS prototipe apa adanya. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="character" src="/member-nox/character.webp" alt="SULU Nox character" />
      </div>

      <header className="topbar">
        <div className="brand">
          <Image src="/member-nox/logo.webp" alt="SULU in Wounderland" width={139} height={115} unoptimized />
        </div>
        <div className="hud">
          <div className="hud-chip">
            <div className="hud-icon">A</div>
            <div className="hud-copy">
              <small>ARK Coins</small>
              <strong>{coins}</strong>
            </div>
          </div>
          <button
            className="icon-btn interactive"
            aria-label="Citizen profile"
            onClick={() => goMode("profile")}
          >
            ◉
          </button>
        </div>
      </header>

      <nav className="navrail" aria-label="Citizen dashboard sections">
        {MODES.map((m) => (
          <button
            key={m}
            className={`nav-item interactive${mode === m ? " active" : ""}`}
            data-mode={m}
            aria-label={MODE_LABELS[m]}
            onClick={() => goMode(m)}
          >
            {NAV_ICONS[m]}
            <span>{m === "dashboard" ? "Dashboard" : MODE_LABELS[m]}</span>
          </button>
        ))}
        <div className="nav-index">
          {String(modeIndex + 1).padStart(2, "0")} / {String(MODES.length).padStart(2, "0")}
        </div>
      </nav>

      <main className="scene-ui">
        <section className="hero-copy">
          <div className="eyebrow">HEY THERE,</div>
          <h1 className="name">{SAMPLE.name}</h1>
          <div className="citizen-tag">Citizen of Wounderland</div>
          <div className="stat-glass interactive" data-cursor="OPEN">
            <div className="level-row">
              <div className="level">
                <small>Level</small>
                <strong>{SAMPLE.level}</strong>
              </div>
              <div className="xp">
                <small>
                  XP · {SAMPLE.xp.toLocaleString("id-ID")} / {SAMPLE.xpNext.toLocaleString("id-ID")}
                </small>
                <div className="xpbar">
                  <span style={{ width: `${Math.min(100, (SAMPLE.xp / SAMPLE.xpNext) * 100)}%` }} />
                </div>
                <div className="xp-meta">
                  <span>Next Level {SAMPLE.level + 1}</span>
                  <span>{(SAMPLE.xpNext - SAMPLE.xp).toLocaleString("id-ID")} XP to go</span>
                </div>
              </div>
            </div>
          </div>
          <div className="quote">
            <b>“</b>&nbsp; Not perfect yet.
            <br />
            But getting better.
          </div>
        </section>

        <aside className="side-stack">
          <section className="glass card interactive wallet-card" data-cursor="OPEN">
            <div className="card-head">
              <h3>ARK Wallet</h3>
              <small>Citizen balance</small>
            </div>
            <div className="wallet">
              <div className="coin-big">
                <div className="coin-medal">A</div>
                <div>
                  <small>Current balance</small>
                  <strong>{coins}</strong>
                </div>
              </div>
              <button className="action interactive" onClick={() => goMode("coins")}>
                Lihat →
              </button>
            </div>
          </section>
        </aside>

        <section className="glass bottom-tray">
          <div className="quick">
            <button className="interactive" onClick={() => goMode("coins")}>
              ARK Coins
            </button>
            <button className="interactive" onClick={() => goMode("history")}>
              History
            </button>
          </div>
        </section>

        <section className={`mode-panel glass card${mode === "profile" ? " active" : ""}`} data-panel="profile">
          <h2>Citizen Profile</h2>
          <p className="sub">Your identity inside Wounderland.</p>
          <div className="list">
            <div className="list-row interactive">
              <div className="list-icon">ID</div>
              <div>
                <b>Citizen</b>
                <small>Bergabung —</small>
              </div>
              <span className="pill">Active</span>
            </div>
            <div className="list-row interactive">
              <div className="list-icon">✦</div>
              <div>
                <b>Tier</b>
                <small>Membership saat ini</small>
              </div>
              <span className="pill">Lv.{SAMPLE.level}</span>
            </div>
          </div>
        </section>

        <section className={`mode-panel glass card${mode === "coins" ? " active" : ""}`} data-panel="coins">
          <h2>ARK Coin Wallet</h2>
          <p className="sub">Saldo yang bisa dibelanjakan di seluruh venue. Top-up dilakukan di kasir.</p>
          <div className="wallet" style={{ marginBottom: 15 }}>
            <div className="coin-big">
              <div className="coin-medal">A</div>
              <div>
                <small>Current balance</small>
                <strong>{coins}</strong>
              </div>
            </div>
          </div>
          <div className="list">
            <div className="list-row">
              <div className="list-icon">A</div>
              <div>
                <b>Riwayat transaksi</b>
                <small>Tersambung ke akun Anda di Fase B</small>
              </div>
            </div>
          </div>
        </section>

        <section className={`mode-panel glass card${mode === "history" ? " active" : ""}`} data-panel="history">
          <h2>Citizen History</h2>
          <p className="sub">Arsip kunjungan dan transaksi Anda.</p>
          <div className="list">
            <div className="list-row">
              <div className="list-icon">↗</div>
              <div>
                <b>Riwayat kunjungan</b>
                <small>Tersambung ke akun Anda di Fase B</small>
              </div>
              <span className="pill">Visit</span>
            </div>
          </div>
        </section>
      </main>

      {Object.keys(LORE).map((key) => (
        <button
          key={key}
          className={`hotspot h-${key} interactive`}
          data-label={LORE[key].title}
          aria-label={`Open ${LORE[key].title} lore`}
          onClick={() => setLore(key)}
        />
      ))}

      <div className="journey" aria-label="Section progress">
        {MODES.map((m) => (
          <button
            key={m}
            className={mode === m ? "active" : ""}
            aria-label={MODE_LABELS[m]}
            onClick={() => goMode(m)}
          />
        ))}
      </div>
      <div className="scroll-hint">
        <span className="wheel" /> Scroll to travel through your citizen profile
      </div>
      <div className={`toast${toast ? " show" : ""}`} aria-live="polite">
        {toast}
      </div>

      <div className={`overlay${activeLore ? " open" : ""}`} onClick={() => setLore(null)}>
        {activeLore && (
          <div className="lore" onClick={(e) => e.stopPropagation()}>
            <button className="close interactive" aria-label="Close" onClick={() => setLore(null)}>
              ×
            </button>
            <div className="tagline">{activeLore.tag}</div>
            <h2>{activeLore.title}</h2>
            <p>{activeLore.text}</p>
          </div>
        )}
      </div>

      <div className={`entry${entered ? " hide" : ""}`}>
        <div className="entry-inner">
          <Image
            className="entry-logo"
            src="/member-nox/logo.webp"
            alt="SULU in Wounderland"
            width={139}
            height={115}
            unoptimized
          />
          <div className="entry-kicker">Citizen profile / Nox Lab node</div>
          <h1>WELCOME, CITIZEN.</h1>
          <p>Masuk ke Nox Lab untuk melihat profil, XP, dan ARK Coins Anda.</p>
          <div className="entry-line" />
          <button
            className="enter-btn interactive"
            onClick={() => {
              setEntered(true);
              setTimeout(() => showToast("Citizen profile synchronized"), 650);
            }}
          >
            Enter Nox Lab
          </button>
        </div>
      </div>

      <div className="cursor-dot" ref={cursorDotRef} />
      <div className="cursor-ring" ref={cursorRingRef} />
    </div>
  );
}

/** Ikon SVG nav — disalin dari prototipe (stroke mengikuti CSS .nav-item svg). */
const NAV_ICONS: Record<NoxMode, React.ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 24 24">
      <path d="M4 10.5 12 4l8 6.5V20H14v-6h-4v6H4z" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.5-4 3-6 7-6s6.5 2 7 6" />
    </svg>
  ),
  coins: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M15 8.5c-.8-.7-1.8-1-3-1-1.7 0-3 1-3 2.3 0 3.6 6.5 1.2 6.5 4.9 0 1.4-1.4 2.5-3.4 2.5-1.4 0-2.6-.4-3.5-1.2M12 6v12" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24">
      <path d="M5 5v5h5M5.7 9.4A7 7 0 1 1 6 16" />
      <path d="M12 8v4l3 2" />
    </svg>
  ),
};
