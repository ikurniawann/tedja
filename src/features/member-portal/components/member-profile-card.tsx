"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { MemberMe } from "./member-portal-page";

/**
 * Form profil member — profil 100% lengkap → Free XP sekali seumur hidup.
 * Nomor WA tidak bisa diubah (identitas login OTP). Foto profil: URL/emoji
 * upload menyusul; sementara input URL sederhana.
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
    <Card>
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
        <div className="space-y-1">
          <Label>Foto profil (URL)</Label>
          <Input
            value={form.photo_url}
            onChange={(event) =>
              setForm({ ...form, photo_url: event.target.value })
            }
            placeholder="https://..."
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
