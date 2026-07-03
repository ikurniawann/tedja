"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/pg/browser-client";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";

const DEMO_ACCOUNTS = [
  {
    label: "Super Admin",
    email: "super@arkivworld.com",
    password: "Arkiv2026*#",
  },
  {
    label: "Demo Sulu Dago",
    email: "demo@sulu.id",
    password: "demo",
  },
] as const;

const DEFAULT_ACCOUNT = DEMO_ACCOUNTS[0];

export default function LoginPage() {
  const router = useRouter();
  const db = createBrowserClient();

  const [email, setEmail] = useState(DEFAULT_ACCOUNT.email);
  const [password, setPassword] = useState(DEFAULT_ACCOUNT.password);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [now, setNow] = useState(new Date());
  const [wallpaper, setWallpaper] = useState("/bg.png");

  const formattedTime = useMemo(
    () => now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(".", ":"),
    [now]
  );
  const formattedDate = useMemo(
    () => now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" }),
    [now]
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    const wallpapers = {
      arkiv: "/bg.png",
      pink: "linear-gradient(135deg,#16091d,#5b1239 45%,#111827)",
      midnight: "linear-gradient(135deg,#030712,#111827 52%,#1e1b4b)",
      glass: "linear-gradient(135deg,#082f49,#0f172a 48%,#312e81)",
    } as const;
    const saved = window.localStorage.getItem("arkiv-wallpaper") as keyof typeof wallpapers | null;
    if (saved && wallpapers[saved]) setWallpaper(wallpapers[saved]);
    return () => window.clearInterval(interval);
  }, []);

  const [requestedRedirect] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const redirect = new URLSearchParams(window.location.search).get("redirect");
    return redirect?.startsWith("/dashboard") ? redirect : null;
  });
  const [requestedModule] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("module");
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { data: authData, error } = await db.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      const { data: profile } = await db
        .from("users")
        .select("role")
        .eq("id", authData.user.id)
        .single();

      const purchasingRoles = [
        "purchasing_manager",
        "purchasing_staff",
        "purchasing_admin",
        "warehouse_staff",
        "qc_staff",
        "finance_staff",
      ];

      const hrdEmails = ["demo@aapextechnology.com", "hrd@", "hr@", "humanresources@"];
      const isHrdEmail = hrdEmails.some((h) => email.toLowerCase().includes(h));

      const target = requestedRedirect || "/arkiv-os";
      setTransitioning(true);
      window.setTimeout(() => router.replace(target), 450);
    }
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#0b1020] text-white">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={wallpaper.startsWith("/") ? { backgroundImage: `url('${wallpaper}')` } : { background: wallpaper }}
      />
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-0 opacity-[0.16] transition-transform duration-500 ease-out [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:80px_80px]" />
      <div className="pointer-events-none absolute -left-24 top-24 size-72 rounded-full bg-cyan-300/14 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-16 size-80 rounded-full bg-pink-400/14 blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white/10 to-transparent" />

      <section className="relative z-10 flex min-h-dvh flex-col items-center justify-between px-6 py-8 transition-all duration-500" style={{ opacity: transitioning ? 0 : 1, transform: transitioning ? "scale(1.015)" : "scale(1)" }}>
        <div className="w-full text-center">
          <div className="text-[72px] font-semibold leading-none tracking-[-0.08em] drop-shadow-2xl sm:text-[104px]">
            {formattedTime}
          </div>
          <div className="mt-2 text-sm font-medium capitalize tracking-wide text-white/80 sm:text-base">
            {formattedDate}
          </div>
        </div>

        <div className="flex w-full max-w-[420px] flex-col items-center">
          <div className="mb-5 grid size-24 place-items-center rounded-full border border-white/20 bg-white/15 text-3xl font-semibold shadow-2xl backdrop-blur-2xl">
            {email ? email.charAt(0).toUpperCase() : "A"}
          </div>
          <h1 className="text-center text-2xl font-semibold tracking-[-0.03em] drop-shadow-lg">Arkiv OS</h1>
          <p className="mt-1 text-center text-sm text-white/70">
            {requestedModule ? `Verifikasi akun untuk membuka ${requestedModule.toUpperCase()}` : "Verifikasi akun untuk masuk ke desktop"}
          </p>

          <form
            onSubmit={handleLogin}
            className="mt-8 w-full space-y-3 rounded-[28px] border border-white/20 p-4 shadow-2xl"
            style={{
              background: "rgba(10, 10, 18, 0.22)",
              backdropFilter: "blur(28px) saturate(140%)",
              WebkitBackdropFilter: "blur(28px) saturate(140%)",
            }}
          >
            <div className="group relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-black" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/20 pl-11 pr-4 text-sm text-black shadow-lg outline-none transition placeholder:text-gray-600 focus:border-pink-400 focus:ring-4 focus:ring-pink-300/30"
                style={{ background: "rgba(255,255,255,0.82)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
                placeholder="Email"
                autoComplete="email"
                required
              />
            </div>

            <div className="group relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-black" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/20 pl-11 pr-12 text-sm text-black shadow-lg outline-none transition placeholder:text-gray-600 focus:border-pink-400 focus:ring-4 focus:ring-pink-300/30"
                style={{ background: "rgba(255,255,255,0.82)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
                placeholder="Password"
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-black transition hover:text-gray-700">
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>

            {error && <div className="rounded-2xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm text-red-50 backdrop-blur-xl">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="h-12 w-full rounded-2xl border border-pink-300/40 bg-pink-600 text-sm font-semibold text-white shadow-2xl shadow-pink-950/30 transition hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Memverifikasi..." : "Log In"}
            </button>
          </form>

          <div
            className="mt-4 w-full rounded-[20px] border border-white/15 px-4 py-3 text-left text-xs text-white/80 shadow-lg"
            style={{
              background: "rgba(10, 10, 18, 0.22)",
              backdropFilter: "blur(20px) saturate(140%)",
              WebkitBackdropFilter: "blur(20px) saturate(140%)",
            }}
          >
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/55">
              Akun demo
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-medium text-white/50">Email</p>
                <div className="mt-1 space-y-1">
                  {DEMO_ACCOUNTS.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      onClick={() => {
                        setEmail(account.email);
                        setPassword(account.password);
                        setError("");
                      }}
                      className="block w-full rounded-lg border border-transparent px-2 py-1 text-left font-mono text-[11px] text-white/90 transition hover:border-white/15 hover:bg-white/10"
                      title={`Gunakan ${account.label}`}
                    >
                      {account.email}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium text-white/50">Password</p>
                <div className="mt-1 space-y-1">
                  {DEMO_ACCOUNTS.map((account) => (
                    <button
                      key={`${account.email}-password`}
                      type="button"
                      onClick={() => {
                        setEmail(account.email);
                        setPassword(account.password);
                        setError("");
                      }}
                      className="block w-full rounded-lg border border-transparent px-2 py-1 text-left font-mono text-[11px] text-white/90 transition hover:border-white/15 hover:bg-white/10"
                      title={`Gunakan ${account.label}`}
                    >
                      {account.password}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex w-full items-center justify-between text-xs text-white/55">
          <span>Arkiv Operating System</span>
          <span>Single account session</span>
        </div>
      </section>
    </main>
  );
}
