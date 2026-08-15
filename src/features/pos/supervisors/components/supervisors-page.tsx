'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  KeyRound,
  Loader2,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { POS_PIN_PATTERN } from '@/lib/pos/supervisor-pin';

/**
 * Kelola supervisor POS + PIN void/merge (permintaan owner 2026-08-16).
 * Sebelumnya PIN hanya bisa diisi manual ke database — halaman ini pintunya:
 * tunjuk supervisor, set/reset PIN (tersimpan ter-hash), cabut akses.
 */

interface SupervisorRow {
  id: string;
  full_name: string | null;
  email: string | null;
  has_pin: boolean;
  legacy_pin: boolean;
}

interface CandidateRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
}

export function SupervisorsPage() {
  const [supervisors, setSupervisors] = useState<SupervisorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pinTarget, setPinTarget] = useState<SupervisorRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [demoteTarget, setDemoteTarget] = useState<SupervisorRow | null>(null);

  const reload = useCallback(async () => {
    try {
      setError('');
      const res = await fetch('/api/pos/supervisors');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Gagal memuat supervisor');
      setSupervisors(json.data.supervisors ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat supervisor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function post(body: Record<string, unknown>, successMessage?: string) {
    const res = await fetch('/api/pos/supervisors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Gagal menyimpan');
    toast.success(successMessage ?? json.data?.message ?? 'Tersimpan');
    await reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Supervisor POS
          </h1>
          <p className="text-sm text-muted-foreground">
            PIN supervisor dipakai untuk otorisasi void &amp; gabung order di kasir.
          </p>
        </div>
        <Button type="button" onClick={() => setShowAdd(true)} className="bg-primary hover:bg-primary/90">
          <UserPlus className="mr-2 h-4 w-4" />
          Tambah Supervisor
        </Button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-gray-200/70 bg-card">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat…
          </div>
        ) : supervisors.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Belum ada supervisor POS. Tambahkan dulu, lalu set PIN-nya — tanpa ini
            tombol void di halaman Orders tidak bisa dipakai.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200/70">
            {supervisors.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {(row.full_name || row.email || '?').slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {row.full_name || 'Tanpa nama'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{row.email}</span>
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold',
                    row.has_pin
                      ? row.legacy_pin
                        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80'
                        : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80'
                      : 'bg-red-50 text-red-700 ring-1 ring-red-200/80'
                  )}
                >
                  {row.has_pin ? (row.legacy_pin ? 'PIN lama — reset dianjurkan' : 'PIN aktif') : 'Belum ada PIN'}
                </span>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-border"
                    onClick={() => setPinTarget(row)}
                  >
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                    {row.has_pin ? 'Reset PIN' : 'Set PIN'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-red-200/80 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => setDemoteTarget(row)}
                  >
                    <UserMinus className="mr-1.5 h-3.5 w-3.5" />
                    Cabut
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        PIN tersimpan ter-enkripsi (hash) dan tidak bisa dilihat kembali — kalau lupa,
        reset saja. Mencabut supervisor mengembalikan role user menjadi kasir POS dan
        menghapus PIN-nya.
      </p>

      <SetPinDialog
        target={pinTarget}
        onClose={() => setPinTarget(null)}
        onSubmit={async (pin) => {
          if (!pinTarget) return;
          await post({ action: 'set_pin', user_id: pinTarget.id, pin }, 'PIN tersimpan');
          setPinTarget(null);
        }}
      />

      <AddSupervisorDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onPromote={async (candidate) => {
          await post({ action: 'promote', user_id: candidate.id });
          setShowAdd(false);
          // Langsung tawarkan set PIN untuk supervisor baru
          const fresh = await fetch('/api/pos/supervisors').then((r) => r.json()).catch(() => null);
          const created = fresh?.data?.supervisors?.find((s: SupervisorRow) => s.id === candidate.id);
          if (created) setPinTarget(created);
        }}
      />

      <Dialog open={Boolean(demoteTarget)} onOpenChange={(open) => !open && setDemoteTarget(null)}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Cabut akses supervisor?</DialogPanelTitle>
            <DialogPanelDescription>
              {demoteTarget?.full_name || demoteTarget?.email} akan kembali menjadi kasir
              POS dan PIN-nya dihapus.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="border-border" onClick={() => setDemoteTarget(null)}>
              Batal
            </Button>
            <Button
              type="button"
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={async () => {
                if (!demoteTarget) return;
                try {
                  await post({ action: 'demote', user_id: demoteTarget.id });
                  setDemoteTarget(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Gagal mencabut');
                }
              }}
            >
              Cabut
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}

function SetPinDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: SupervisorRow | null;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setPin('');
      setConfirm('');
    }
  }, [target]);

  const valid = POS_PIN_PATTERN.test(pin);
  const match = pin === confirm;

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>
            {target?.has_pin ? 'Reset PIN' : 'Set PIN'} — {target?.full_name || target?.email}
          </DialogPanelTitle>
          <DialogPanelDescription>
            PIN 4-6 digit angka, dipakai supervisor saat otorisasi void di kasir.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">PIN baru</label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="border-gray-200/80 text-center text-lg tracking-[0.5em]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Ulangi PIN</label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="border-gray-200/80 text-center text-lg tracking-[0.5em]"
            />
          </div>
          {pin && !valid ? (
            <p className="text-xs font-medium text-red-600">PIN harus 4-6 digit angka.</p>
          ) : confirm && !match ? (
            <p className="text-xs font-medium text-red-600">PIN tidak sama.</p>
          ) : null}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" className="border-border" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            type="button"
            className="bg-primary hover:bg-primary/90"
            disabled={!valid || !match || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(pin);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Gagal menyimpan PIN');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            Simpan PIN
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

function AddSupervisorDialog({
  open,
  onClose,
  onPromote,
}: {
  open: boolean;
  onClose: () => void;
  onPromote: (candidate: CandidateRow) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/pos/supervisors?candidates=1&search=${encodeURIComponent(search.trim())}`
        );
        const json = await res.json();
        setCandidates(json.data?.candidates ?? []);
      } catch {
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, search]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Tambah Supervisor POS</DialogPanelTitle>
          <DialogPanelDescription>
            Role user terpilih akan berubah menjadi supervisor POS. Akun admin tidak
            bisa dipilih.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau email…"
              className="border-gray-200/80 pl-9"
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200/70">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Mencari…
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Tidak ada user yang cocok.
              </div>
            ) : (
              <ul className="divide-y divide-gray-200/70">
                {candidates.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {row.full_name || 'Tanpa nama'}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.email} · {row.role}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-primary/30 text-primary hover:bg-primary/5"
                      disabled={busyId !== null}
                      onClick={async () => {
                        setBusyId(row.id);
                        try {
                          await onPromote(row);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Gagal menambah supervisor');
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Jadikan'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" className="border-border" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
