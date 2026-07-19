"use client";

import { useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Login OTP WhatsApp 2 langkah (nomor → kode). EPIC-011 Fase D. */
export function MemberLoginCard({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function requestOtp() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/member-portal/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Gagal mengirim kode");
        return;
      }
      setInfo("Kode dikirim ke WhatsApp Anda — berlaku 5 menit.");
      setStep("code");
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/member-portal/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Kode salah");
        return;
      }
      onSuccess();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-purple-500">
          Sulu Wonderland
        </p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Portal Member</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cek saldo ARK Coin, XP, tier & riwayat transaksi Anda
        </p>
      </div>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4 text-emerald-500" />
            Masuk dengan WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {step === "phone" ? (
            <>
              <div className="space-y-1">
                <Label>No. WhatsApp terdaftar</Label>
                <Input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="08xxxxxxxxxx"
                  onKeyDown={(event) => event.key === "Enter" && requestOtp()}
                />
              </div>
              <Button className="w-full" onClick={requestOtp} disabled={busy || !phone}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kirim Kode OTP"}
              </Button>
            </>
          ) : (
            <>
              {info && <p className="text-xs text-emerald-600">{info}</p>}
              <div className="space-y-1">
                <Label>Kode OTP (6 digit)</Label>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="••••••"
                  className="text-center text-xl tracking-[0.5em]"
                  onKeyDown={(event) => event.key === "Enter" && verify()}
                />
              </div>
              <Button
                className="w-full"
                onClick={verify}
                disabled={busy || code.length !== 6}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Masuk"}
              </Button>
              <button
                className="w-full text-center text-xs text-gray-400 underline"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setInfo("");
                }}
              >
                Ganti nomor / kirim ulang
              </button>
            </>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-gray-400">
        Belum jadi member? Daftar gratis di kasir venue kami.
      </p>
    </div>
  );
}
