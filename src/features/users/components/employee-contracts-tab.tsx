"use client";

import { useState } from "react";
import { ArrowDownTrayIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { useEmployeeContracts } from "../queries";
import {
  useContractAction,
  useCreateEmployeeContract,
  useDeleteEmployeeContract,
} from "../mutations";
import type { EmployeeContractRow } from "../api";

/**
 * Tab "Kontrak" di detail karyawan — daftar kontrak PKWTT/PKWT + aksi siklus
 * hidup (aktifkan, akhiri, putus, konversi). Aturan compliance (batas PKWT
 * 5 tahun, larangan probation PKWT) ditegakkan server-side; UI menampilkan
 * pesan errornya apa adanya.
 */

const TYPE_LABELS: Record<string, string> = {
  pkwtt: "PKWTT — Karyawan Tetap",
  pkwt: "PKWT — Kontrak Waktu Tertentu",
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  active: { label: "Aktif", className: "bg-green-100 text-green-700" },
  ended: { label: "Berakhir", className: "bg-blue-100 text-blue-700" },
  terminated: { label: "Diputus", className: "bg-red-100 text-red-700" },
  converted: { label: "Konversi ke Tetap", className: "bg-purple-100 text-purple-700" },
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

function formatIdr(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `Rp ${new Intl.NumberFormat("id-ID").format(num)}`;
}

const EMPTY_FORM = {
  contract_type: "pkwt" as "pkwt" | "pkwtt",
  start_date: "",
  end_date: "",
  probation_end_date: "",
  work_location: "",
  base_salary: "",
  notes: "",
};

export function EmployeeContractsTab({ employeeId }: { employeeId: string }) {
  const { toasts, showToast, removeToast } = useToast();
  const { data: contracts = [], isLoading } = useEmployeeContracts(employeeId);
  const createMutation = useCreateEmployeeContract(employeeId);
  const actionMutation = useContractAction(employeeId);
  const deleteMutation = useDeleteEmployeeContract(employeeId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const isPkwt = form.contract_type === "pkwt";
  const [renewTarget, setRenewTarget] = useState<EmployeeContractRow | null>(null);
  const [renewEndDate, setRenewEndDate] = useState("");

  async function handleCreate() {
    if (!form.start_date) {
      showToast("Tanggal mulai wajib diisi", "error");
      return;
    }
    try {
      const res = await createMutation.mutateAsync({
        contract_type: form.contract_type,
        start_date: form.start_date,
        end_date: isPkwt ? form.end_date || null : null,
        probation_end_date: !isPkwt ? form.probation_end_date || null : null,
        work_location: form.work_location || null,
        base_salary: form.base_salary ? Number(form.base_salary) : null,
        notes: form.notes || null,
      });
      showToast(res.message ?? "Draft kontrak dibuat");
      setDialogOpen(false);
      setForm(EMPTY_FORM);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal membuat kontrak", "error");
    }
  }

  async function handleAction(
    contract: EmployeeContractRow,
    action: "activate" | "end" | "convert" | "terminate"
  ) {
    let reason: string | undefined;
    if (action === "terminate") {
      const input = prompt("Alasan pemutusan kontrak:");
      if (!input?.trim()) return;
      reason = input.trim();
    }
    try {
      const res = await actionMutation.mutateAsync({ contractId: contract.id, action, reason });
      const kompensasi =
        res.compensation_amount != null && res.compensation_amount > 0
          ? ` — uang kompensasi ${formatIdr(res.compensation_amount)}`
          : "";
      showToast(`${res.message}${kompensasi}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Aksi gagal", "error");
    }
  }

  async function handleRenew() {
    if (!renewTarget || !renewEndDate) {
      showToast("Tanggal berakhir perpanjangan wajib diisi", "error");
      return;
    }
    try {
      const res = await actionMutation.mutateAsync({
        contractId: renewTarget.id,
        action: "renew",
        end_date: renewEndDate,
      });
      showToast(res.message ?? "Draft perpanjangan dibuat");
      setRenewTarget(null);
      setRenewEndDate("");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal memperpanjang", "error");
    }
  }

  async function handleDelete(contract: EmployeeContractRow) {
    if (!confirm(`Hapus draft kontrak ${contract.contract_number}?`)) return;
    try {
      await deleteMutation.mutateAsync(contract.id);
      showToast("Draft kontrak dihapus");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menghapus", "error");
    }
  }

  return (
    <div className="space-y-4">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Kontrak Kerja</h3>
          <p className="text-xs text-gray-500">
            PKWT maksimal total 5 tahun & tanpa masa percobaan; PKWTT probation maks 3 bulan
            (UU 13/2003 jo. PP 35/2021).
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <PlusIcon className="h-4 w-4" /> Buat Kontrak
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : contracts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
          Belum ada kontrak. Buat kontrak pertama untuk karyawan ini.
        </p>
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => {
            const badge = STATUS_BADGES[contract.status] ?? STATUS_BADGES.draft;
            return (
              <div
                key={contract.id}
                className="rounded-xl border border-gray-200/70 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900">
                      {contract.contract_number}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      title="Unduh PDF surat perjanjian kerja"
                      onClick={() =>
                        window.open(`/api/hris/contracts/${contract.id}/document`, "_blank")
                      }
                    >
                      <ArrowDownTrayIcon className="h-4 w-4" /> PDF
                    </Button>
                    {contract.status === "draft" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionMutation.isPending}
                          onClick={() => handleAction(contract, "activate")}
                        >
                          Aktifkan
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600"
                          disabled={deleteMutation.isPending}
                          onClick={() => handleDelete(contract)}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {contract.status === "active" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionMutation.isPending}
                          onClick={() => handleAction(contract, "end")}
                        >
                          Akhiri
                        </Button>
                        {contract.contract_type === "pkwt" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionMutation.isPending}
                              onClick={() => setRenewTarget(contract)}
                            >
                              Perpanjang
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionMutation.isPending}
                              onClick={() => handleAction(contract, "convert")}
                            >
                              Konversi ke Tetap
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600"
                          disabled={actionMutation.isPending}
                          onClick={() => handleAction(contract, "terminate")}
                        >
                          Putus
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-gray-500">Tipe</p>
                    <p className="font-medium">{TYPE_LABELS[contract.contract_type]}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Periode</p>
                    <p className="font-medium">
                      {formatDate(contract.start_date)}
                      {" — "}
                      {contract.contract_type === "pkwt"
                        ? formatDate(contract.end_date)
                        : "tanpa batas"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Gaji pokok</p>
                    <p className="font-medium">{formatIdr(contract.base_salary)}</p>
                  </div>
                  {contract.probation_end_date && (
                    <div>
                      <p className="text-xs text-gray-500">Masa percobaan s.d.</p>
                      <p className="font-medium">{formatDate(contract.probation_end_date)}</p>
                    </div>
                  )}
                  {contract.position_title && (
                    <div>
                      <p className="text-xs text-gray-500">Jabatan</p>
                      <p className="font-medium">{contract.position_title}</p>
                    </div>
                  )}
                  {contract.compensation_amount && (
                    <div>
                      <p className="text-xs text-gray-500">Uang kompensasi (PP 35/2021)</p>
                      <p className="font-medium">{formatIdr(contract.compensation_amount)}</p>
                    </div>
                  )}
                  {contract.terminated_reason && (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-500">Alasan pemutusan</p>
                      <p className="font-medium">{contract.terminated_reason}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={renewTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenewTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Perpanjang Kontrak PKWT</DialogTitle>
          </DialogHeader>
          {renewTarget && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Kontrak <span className="font-mono">{renewTarget.contract_number}</span>{" "}
                berakhir {formatDate(renewTarget.end_date)}. Draft perpanjangan akan mulai
                sehari setelahnya, dalam rantai kontrak yang sama.
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Tanggal berakhir perpanjangan
                </label>
                <Input
                  type="date"
                  value={renewEndDate}
                  onChange={(e) => setRenewEndDate(e.target.value)}
                />
              </div>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Total seluruh PKWT karyawan (termasuk perpanjangan ini) maksimal 5 tahun —
                sistem menolak otomatis bila terlampaui.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewTarget(null)}>
              Batal
            </Button>
            <Button onClick={handleRenew} disabled={actionMutation.isPending}>
              {actionMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Buat Draft Perpanjangan"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Kontrak Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Tipe kontrak</label>
              <Combobox
                options={[
                  { value: "pkwt", label: TYPE_LABELS.pkwt },
                  { value: "pkwtt", label: TYPE_LABELS.pkwtt },
                ]}
                value={form.contract_type}
                onChange={(value) =>
                  setForm((f) => ({ ...f, contract_type: value as "pkwt" | "pkwtt" }))
                }
                placeholder="Pilih tipe"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Tanggal mulai
                </label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              {isPkwt ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Tanggal berakhir
                  </label>
                  <Input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Akhir masa percobaan (ops.)
                  </label>
                  <Input
                    type="date"
                    value={form.probation_end_date}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, probation_end_date: e.target.value }))
                    }
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Gaji pokok (ops. — default gaji aktif)
                </label>
                <Input
                  type="number"
                  placeholder="cth. 4500000"
                  value={form.base_salary}
                  onChange={(e) => setForm((f) => ({ ...f, base_salary: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Lokasi kerja (ops.)
                </label>
                <Input
                  placeholder="cth. Kantor Pusat Jakarta"
                  value={form.work_location}
                  onChange={(e) => setForm((f) => ({ ...f, work_location: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Catatan (ops.)</label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            {isPkwt && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                PKWT wajib punya tanggal berakhir, tidak boleh ada masa percobaan, dan total
                seluruh PKWT karyawan ini maksimal 5 tahun — sistem menolak otomatis bila
                terlampaui.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Simpan Draft"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
