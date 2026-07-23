"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { MemberMe } from "./member-portal-page";

/**
 * Form profil member — profil 100% lengkap → Free XP sekali seumur hidup.
 * Nomor WA tidak bisa diubah (identitas login OTP). Foto profil diunggah
 * langsung dari galeri/kamera HP; URL manual dihapus karena tidak realistis
 * diisi customer dari ponsel.
 */
export function MemberProfileCard({
  me,
  onSaved,
}: {
  me: MemberMe;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: me.profile.name ?? "",
    email: me.profile.email ?? "",
    birth_date: me.profile.birth_date ?? "",
    gender: me.profile.gender ?? "",
    city: me.profile.city ?? "",
    photo_url: me.profile.photo_url ?? "",
    wa_consent: me.profile.wa_consent,
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadPhoto(file: File) {
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/member-portal/profile/photo", {
        method: "POST",
        body,
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || "Gagal mengunggah foto");
        return;
      }
      setForm((current) => ({ ...current, photo_url: json.data.photo_url }));
      setMessage("Foto profil diperbarui.");
      onSaved();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/member-portal/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          gender: form.gender || "",
          wa_consent: form.wa_consent ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Gagal menyimpan profil");
        return;
      }
      setMessage(json.message || "Profil tersimpan");
      onSaved();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-2xl border-0 bg-white/85 shadow-sm ring-1 ring-black/5 backdrop-blur">
      <CardHeader>
        <CardTitle className="text-base">
          Profil Saya{" "}
          <span className="ml-1 text-sm font-normal text-gray-400">
            ({me.completion.percent}% lengkap)
          </span>
        </CardTitle>
        {!me.free_xp_granted && me.free_xp_amount > 0 && (
          <p className="text-xs text-amber-600">
            Lengkapi 100% untuk mendapat {me.free_xp_amount} Free XP 🎁
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label>Nama</Label>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>No. WhatsApp</Label>
          <Input value={me.profile.phone ?? ""} disabled />
        </div>
        <div className="space-y-1">
          <Label>Email</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="nama@email.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Tanggal lahir</Label>
            <Input
              type="date"
              value={form.birth_date}
              onChange={(event) =>
                setForm({ ...form, birth_date: event.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Jenis kelamin</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={form.gender}
              onChange={(event) => setForm({ ...form, gender: event.target.value })}
            >
              <option value="">Pilih...</option>
              <option value="male">Laki-laki</option>
              <option value="female">Perempuan</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Kota/domisili</Label>
          <Input
            value={form.city}
            onChange={(event) => setForm({ ...form, city: event.target.value })}
            placeholder="Bandung"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Foto profil</Label>
          <div className="flex items-center gap-3">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-full ring-2 ring-[color:var(--mp-line)]">
              {form.photo_url ? (
                // Foto berasal dari /api/files (host sendiri); <img> dipakai
                // agar tidak perlu mendaftarkan remote pattern next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.photo_url}
                  alt="Foto profil"
                  className="size-full object-cover"
                />
              ) : (
                <div className="grid size-full place-items-center bg-[color:var(--mp-line)] text-[color:var(--brand-primary)]">
                  <UserRound className="size-7" />
                </div>
              )}
              {uploading && (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <Loader2 className="size-5 animate-spin text-white" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: "var(--brand-primary)" }}
                >
                  <Camera className="size-3.5" />
                  {form.photo_url ? "Ganti Foto" : "Pilih Foto"}
                </button>
                {form.photo_url && (
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, photo_url: "" }))}
                    disabled={uploading}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                  >
                    <Trash2 className="size-3.5" />
                    Hapus
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400">JPG, PNG, atau WEBP · maks 5 MB</p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset supaya memilih file yang sama dua kali tetap memicu event.
              event.target.value = "";
              if (file) void uploadPhoto(file);
            }}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Promo via WhatsApp</p>
            <p className="text-xs text-gray-400">
              Terima info promo & event dari kami
            </p>
          </div>
          <Switch
            checked={form.wa_consent === true}
            onCheckedChange={(checked) =>
              setForm({ ...form, wa_consent: checked })
            }
          />
        </div>

        {message && <p className="text-xs text-emerald-600">{message}</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}

        <Button className="w-full" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Profil"}
        </Button>
      </CardContent>
    </Card>
  );
}
