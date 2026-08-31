"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, Plus, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";

/**
 * Task Departemen (owner 2026-08-30) — konsep MBO / task compliance:
 * departemen menyusun daftar tugas (rutin harian/mingguan/bulanan atau
 * sekali jalan), penanggung jawab menandai selesai, HRD mereview, dan
 * hasilnya menjadi indikator KPI "Penyelesaian Tugas Departemen".
 */

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  recurrence: "once" | "daily" | "weekly" | "monthly";
  weekly_day: number | null;
  monthly_day: number | null;
  due_date: string | null;
  assignee_employee_id: string | null;
  assignee_name: string | null;
  created_by_name: string | null;
}
interface OccurrenceRow {
  id: string;
  task_id: string;
  occurrence_date: string;
  status: "pending" | "done" | "approved" | "rejected";
  done_by_name: string | null;
  review_notes: string | null;
  reviewed_by_name: string | null;
}
interface PageData {
  department_id: string | null;
  tasks: TaskRow[];
  occurrences: OccurrenceRow[];
  members: { id: string; full_name: string }[];
  departments: { id: string; name: string }[];
  can_manage: boolean;
  is_hr: boolean;
  my_employee_id?: string | null;
}

const HARI = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const RECURRENCE_LABEL: Record<TaskRow["recurrence"], string> = {
  once: "Sekali",
  daily: "Harian",
  weekly: "Mingguan",
  monthly: "Bulanan",
};
const STATUS_META: Record<OccurrenceRow["status"], { label: string; cls: string }> = {
  pending: { label: "Belum", cls: "bg-gray-100 text-gray-600" },
  done: { label: "Selesai — tunggu review", cls: "bg-blue-100 text-blue-700" },
  approved: { label: "Disetujui", cls: "bg-green-100 text-green-700" },
  rejected: { label: "Ditolak", cls: "bg-red-100 text-red-700" },
};

const bulanIni = () => {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
  );
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function DeptTasksPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [month, setMonth] = useState(bulanIni());
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [data, setData] = useState<PageData | null>(null);
  const loading = data === null;
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // form tambah task
  const [fTitle, setFTitle] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fRecurrence, setFRecurrence] = useState<TaskRow["recurrence"]>("daily");
  const [fWeeklyDay, setFWeeklyDay] = useState("1");
  const [fMonthlyDay, setFMonthlyDay] = useState("1");
  const [fDueDate, setFDueDate] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [fSaving, setFSaving] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams({ month });
    if (deptFilter) params.set("department_id", deptFilter);
    apiGet<{ data: PageData }>(`/api/hris/dept-tasks?${params}`)
      .then((res) => setData(res.data))
      .catch((err) =>
        showToast(err instanceof Error ? err.message : "Gagal memuat task", "error")
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, deptFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const taskById = useMemo(
    () => new Map((data?.tasks ?? []).map((t) => [t.id, t])),
    [data?.tasks]
  );
  const todayIso = useMemo(() => {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  async function act(occId: string, action: "done" | "approve" | "reject") {
    setBusyId(occId);
    try {
      let notes: string | null = null;
      if (action === "reject") {
        notes = window.prompt("Alasan penolakan (opsional):") ?? null;
      }
      const res = await apiPatch<{ message: string }>(
        `/api/hris/dept-tasks/occurrences/${occId}`,
        { action, notes }
      );
      showToast(res.message ?? "Tersimpan");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function submitTask() {
    setFSaving(true);
    try {
      await apiPost<{ message: string }>("/api/hris/dept-tasks", {
        department_id: deptFilter || data?.department_id || undefined,
        title: fTitle,
        description: fDesc || null,
        recurrence: fRecurrence,
        weekly_day: fRecurrence === "weekly" ? Number(fWeeklyDay) : null,
        monthly_day: fRecurrence === "monthly" ? Number(fMonthlyDay) : null,
        due_date: fRecurrence === "once" ? fDueDate : null,
        assignee_employee_id: fAssignee || null,
      });
      showToast("Task dibuat");
      setAddOpen(false);
      setFTitle("");
      setFDesc("");
      setFDueDate("");
      setFAssignee("");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal membuat task", "error");
    } finally {
      setFSaving(false);
    }
  }

  const occurrences = useMemo(() => data?.occurrences ?? [], [data?.occurrences]);
  const ringkas = useMemo(() => {
    const due = occurrences.length;
    const approved = occurrences.filter((o) => o.status === "approved").length;
    const waiting = occurrences.filter((o) => o.status === "done").length;
    return { due, approved, waiting };
  }, [occurrences]);

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Task Departemen
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Tugas rutin & sekali jalan departemen — ditandai selesai oleh
            penanggung jawab, direview HRD, dan dihitung ke KPI
            &quot;Penyelesaian Tugas Departemen&quot;.
          </p>
        </div>
        <div className="flex items-end gap-2">
          {data?.is_hr && (data?.departments?.length ?? 0) > 0 ? (
            <div className="w-52">
              <Combobox
                value={deptFilter}
                onChange={setDeptFilter}
                options={(data?.departments ?? []).map((d) => ({
                  value: d.id,
                  label: d.name,
                }))}
                placeholder="Pilih departemen…"
              />
            </div>
          ) : null}
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 w-40"
          />
          {data?.can_manage ? (
            <Button onClick={() => setAddOpen(true)} disabled={!data?.department_id}>
              <Plus className="mr-1.5 h-4 w-4" /> Tambah Task
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Jatuh tempo bulan ini", value: ringkas.due },
          { label: "Menunggu review HRD", value: ringkas.waiting },
          { label: "Disetujui", value: ringkas.approved },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </CardContent>
        </Card>
      ) : !data?.department_id ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-gray-500">
            {data?.is_hr
              ? "Pilih departemen untuk melihat task-nya."
              : "Akun Anda belum terhubung ke departemen — hubungi HRD."}
          </CardContent>
        </Card>
      ) : occurrences.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-gray-500">
            Belum ada task pada bulan ini.
            {data.can_manage ? " Mulai dengan Tambah Task." : ""}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {occurrences.map((occ) => {
              const task = taskById.get(occ.task_id);
              const meta = STATUS_META[occ.status];
              const lewatTempo = occ.status === "pending" && occ.occurrence_date < todayIso;
              const bolehTandai =
                occ.status === "pending" || occ.status === "rejected";
              return (
                <div key={occ.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="w-24 text-xs tabular-nums text-gray-500">
                    {occ.occurrence_date.slice(8, 10)}/{occ.occurrence_date.slice(5, 7)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {task?.title ?? "—"}
                      <span className="ml-2 text-xs text-gray-400">
                        {task ? RECURRENCE_LABEL[task.recurrence] : ""}
                        {task?.recurrence === "weekly" && task.weekly_day
                          ? ` · ${HARI[task.weekly_day]}`
                          : ""}
                        {task?.recurrence === "monthly" && task.monthly_day
                          ? ` · tgl ${task.monthly_day}`
                          : ""}
                      </span>
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      PJ: {task?.assignee_name ?? "Departemen"}
                      {occ.done_by_name ? ` · diselesaikan ${occ.done_by_name}` : ""}
                      {occ.status === "rejected" && occ.review_notes
                        ? ` · alasan: ${occ.review_notes}`
                        : ""}
                    </p>
                  </div>
                  <Badge className={meta.cls}>
                    {lewatTempo ? "Lewat tempo" : meta.label}
                  </Badge>
                  <div className="flex gap-1.5">
                    {bolehTandai ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === occ.id}
                        onClick={() => act(occ.id, "done")}
                      >
                        Tandai Selesai
                      </Button>
                    ) : null}
                    {data.is_hr && occ.status === "done" ? (
                      <>
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          disabled={busyId === occ.id}
                          onClick={() => act(occ.id, "approve")}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Setujui
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-200 text-red-600"
                          disabled={busyId === occ.id}
                          onClick={() => act(occ.id, "reject")}
                        >
                          <XCircle className="mr-1 h-3.5 w-3.5" /> Tolak
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Task Departemen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Judul task</label>
              <Input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="mis. Cek suhu chiller" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Deskripsi (opsional)</label>
              <Input value={fDesc} onChange={(e) => setFDesc(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Pengulangan</label>
              <div className="mt-1 flex gap-1.5">
                {(["daily", "weekly", "monthly", "once"] as const).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={fRecurrence === r ? "default" : "outline"}
                    onClick={() => setFRecurrence(r)}
                  >
                    {RECURRENCE_LABEL[r]}
                  </Button>
                ))}
              </div>
            </div>
            {fRecurrence === "weekly" ? (
              <div>
                <label className="text-xs font-medium text-gray-600">Setiap hari</label>
                <Combobox
                  value={fWeeklyDay}
                  onChange={setFWeeklyDay}
                  options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: HARI[d] }))}
                />
              </div>
            ) : null}
            {fRecurrence === "monthly" ? (
              <div>
                <label className="text-xs font-medium text-gray-600">Setiap tanggal (1–28)</label>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  value={fMonthlyDay}
                  onChange={(e) => setFMonthlyDay(e.target.value)}
                />
              </div>
            ) : null}
            {fRecurrence === "once" ? (
              <div>
                <label className="text-xs font-medium text-gray-600">Jatuh tempo</label>
                <Input type="date" value={fDueDate} onChange={(e) => setFDueDate(e.target.value)} />
              </div>
            ) : null}
            <div>
              <label className="text-xs font-medium text-gray-600">
                Penanggung jawab (opsional — kosong = seluruh departemen)
              </label>
              <Combobox
                value={fAssignee}
                onChange={setFAssignee}
                options={(data?.members ?? []).map((m) => ({ value: m.id, label: m.full_name }))}
                placeholder="Pilih karyawan…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={fSaving}>
              Batal
            </Button>
            <Button onClick={submitTask} disabled={fSaving || fTitle.trim().length < 3}>
              {fSaving ? "Menyimpan…" : "Simpan Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
