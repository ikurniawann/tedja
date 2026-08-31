"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, Plus, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
interface SubtaskRow {
  id: string;
  task_id: string;
  title: string;
  weight: number | string;
  sort_order: number;
}
interface CheckedItemRow {
  occurrence_id: string;
  subtask_id: string;
  is_checked: boolean;
  checked_by_name?: string | null;
  checked_at?: string | null;
}
interface PageData {
  department_id: string | null;
  tasks: TaskRow[];
  occurrences: OccurrenceRow[];
  subtasks?: SubtaskRow[];
  checked_items?: CheckedItemRow[];
  members: { id: string; full_name: string }[];
  departments: { id: string; name: string }[];
  can_manage: boolean;
  can_review?: boolean;
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
  done: { label: "Selesai — tunggu review Head", cls: "bg-blue-100 text-blue-700" },
  approved: { label: "Disetujui", cls: "bg-green-100 text-green-700" },
  rejected: { label: "Ditolak", cls: "bg-red-100 text-red-700" },
};

// Seksi daftar task (owner 2026-08-31): dipisah per jenis pengulangan.
const SECTION_ORDER = [
  { key: "daily", label: "Harian" },
  { key: "weekly", label: "Mingguan" },
  { key: "monthly", label: "Bulanan" },
  { key: "once", label: "Task Tambahan" },
] as const;

/** Grup task yang bisa di-expand — state terbuka/tutup lokal per grup. */
function TaskGroup({
  header,
  defaultOpen = false,
  children,
}: {
  header: (open: boolean) => React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
      >
        {header(open)}
      </button>
      {open ? children : null}
    </div>
  );
}

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
  const [fSubtasks, setFSubtasks] = useState<{ title: string }[]>([]);
  const [fSaving, setFSaving] = useState(false);
  const [expandedOcc, setExpandedOcc] = useState<string | null>(null);

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

  const subtasksByTask = useMemo(() => {
    const map = new Map<string, SubtaskRow[]>();
    for (const st of data?.subtasks ?? []) {
      const list = map.get(st.task_id) ?? [];
      list.push(st);
      map.set(st.task_id, list);
    }
    return map;
  }, [data?.subtasks]);
  // key `${occurrence_id}:${subtask_id}` → info pengceklis (jejak audit)
  const checkedByOcc = useMemo(() => {
    const map = new Map<string, { name: string | null; at: string | null }>();
    for (const item of data?.checked_items ?? []) {
      if (!item.is_checked) continue;
      map.set(`${item.occurrence_id}:${item.subtask_id}`, {
        name: item.checked_by_name ?? null,
        at: item.checked_at ?? null,
      });
    }
    return map;
  }, [data?.checked_items]);

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

  async function toggleSubtask(occId: string, subtaskId: string, checked: boolean) {
    if (busyId !== null) return; // cegah badai event/klik ganda
    setBusyId(occId);
    try {
      const res = await apiPatch<{ message: string }>(
        `/api/hris/dept-tasks/occurrences/${occId}`,
        { action: "check_subtask", subtask_id: subtaskId, checked }
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
        subtasks: fSubtasks
          .filter((st) => st.title.trim())
          .map((st) => ({ title: st.title.trim() })),
      });
      showToast("Task dibuat");
      setAddOpen(false);
      setFTitle("");
      setFDesc("");
      setFDueDate("");
      setFAssignee("");
      setFSubtasks([]);
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal membuat task", "error");
    } finally {
      setFSaving(false);
    }
  }

  const occurrences = useMemo(() => data?.occurrences ?? [], [data?.occurrences]);
  const occByTask = useMemo(() => {
    const map = new Map<string, OccurrenceRow[]>();
    for (const occ of occurrences) {
      const list = map.get(occ.task_id) ?? [];
      list.push(occ);
      map.set(occ.task_id, list);
    }
    return map;
  }, [occurrences]);
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
            penanggung jawab, direview Head Division, dan dihitung ke KPI
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
          { label: "Menunggu review Head", value: ringkas.waiting },
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
        <div className="space-y-4">
          {SECTION_ORDER.map((section) => {
            const sectionTasks = (data?.tasks ?? []).filter(
              (t) => t.recurrence === section.key && occByTask.has(t.id)
            );
            if (sectionTasks.length === 0) return null;
            return (
              <Card key={section.key}>
                <CardContent className="p-0">
                  <div className="border-b bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {section.label}
                  </div>
                  <div className="divide-y">
            {sectionTasks.map((groupTask) => (
              <TaskGroup
                key={groupTask.id}
                defaultOpen={groupTask.recurrence === "once"}
                header={(terbukaGrup) => {
              const groupOccs = occByTask.get(groupTask.id) ?? [];
              const ringkasGrup = {
                approved: groupOccs.filter((o) => o.status === "approved").length,
                waiting: groupOccs.filter((o) => o.status === "done").length,
                total: groupOccs.length,
              };
              const adaHariIni = groupOccs.some(
                (o) => o.occurrence_date === todayIso && o.status !== "approved"
              );
              return (
                  <>
                    <span className="w-4 text-gray-400">{terbukaGrup ? "▾" : "▸"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900">
                        {groupTask.title}
                        <span className="ml-2 text-xs text-gray-400">
                          {RECURRENCE_LABEL[groupTask.recurrence]}
                          {groupTask.recurrence === "weekly" && groupTask.weekly_day
                            ? ` · ${HARI[groupTask.weekly_day]}`
                            : ""}
                          {groupTask.recurrence === "monthly" && groupTask.monthly_day
                            ? ` · tgl ${groupTask.monthly_day}`
                            : ""}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        PJ: {groupTask.assignee_name ?? "Departemen"}
                      </span>
                    </span>
                    {adaHariIni ? (
                      <Badge className="bg-primary/10 text-primary">Ada tugas hari ini</Badge>
                    ) : null}
                    <span className="text-xs tabular-nums text-gray-500">
                      {ringkasGrup.approved} disetujui
                      {ringkasGrup.waiting ? ` · ${ringkasGrup.waiting} tunggu review` : ""}
                      {" · "}
                      {ringkasGrup.total} jadwal
                    </span>
                  </>
              );
                }}
              >
                    <div className="divide-y border-t bg-muted/10">
                      {(occByTask.get(groupTask.id) ?? []).map((occ) => {
              const meta = STATUS_META[occ.status];
              const lewatTempo = occ.status === "pending" && occ.occurrence_date < todayIso;
              const bolehTandai =
                occ.status === "pending" || occ.status === "rejected";
              const subs = subtasksByTask.get(occ.task_id) ?? [];
              const progress = subs.reduce(
                (sum, st) =>
                  sum + (checkedByOcc.has(`${occ.id}:${st.id}`) ? Number(st.weight) : 0),
                0
              );
              const terbuka = expandedOcc === occ.id;
              return (
                <div key={occ.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="w-24 pl-6 text-xs tabular-nums text-gray-600">
                    {occ.occurrence_date.slice(8, 10)}/{occ.occurrence_date.slice(5, 7)}
                    {occ.occurrence_date === todayIso ? (
                      <span className="ml-1 font-semibold text-primary">hari ini</span>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-gray-500">
                      {occ.done_by_name ? `diselesaikan ${occ.done_by_name}` : ""}
                      {occ.status === "rejected" && occ.review_notes
                        ? ` · alasan: ${occ.review_notes}`
                        : ""}
                    </p>
                  </div>
                  {subs.length > 0 ? (
                    <button
                      type="button"
                      className="text-xs font-semibold tabular-nums text-primary hover:underline"
                      onClick={() => setExpandedOcc(terbuka ? null : occ.id)}
                      title="Lihat sub-task"
                    >
                      {Math.round(progress)}%
                    </button>
                  ) : null}
                  <Badge className={meta.cls}>
                    {lewatTempo ? "Lewat tempo" : meta.label}
                  </Badge>
                  <div className="flex gap-1.5">
                    {bolehTandai && subs.length === 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === occ.id}
                        onClick={() => act(occ.id, "done")}
                      >
                        Tandai Selesai
                      </Button>
                    ) : null}
                    {bolehTandai && subs.length > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === occ.id}
                        onClick={() => setExpandedOcc(terbuka ? null : occ.id)}
                      >
                        {terbuka ? "Tutup" : "Kerjakan"}
                      </Button>
                    ) : null}
                    {(data.can_review ?? data.is_hr) && occ.status === "done" ? (
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
                  {terbuka && subs.length > 0 ? (
                    <div className="w-full space-y-1.5 rounded-lg bg-muted/40 p-3 pl-8">
                      {subs.map((st) => {
                        const info = checkedByOcc.get(`${occ.id}:${st.id}`);
                        const checked = Boolean(info);
                        const bolehCeklis =
                          occ.status !== "approved" && busyId === null;
                        return (
                          <div key={st.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              disabled={!bolehCeklis}
                              onCheckedChange={(v) =>
                                toggleSubtask(occ.id, st.id, v === true)
                              }
                            />
                            <span className={checked ? "text-gray-400 line-through" : "text-gray-800"}>
                              {st.title}
                            </span>
                            {info?.name ? (
                              <span className="ml-auto text-xs text-gray-400">
                                ✓ {info.name}
                                {info.at
                                  ? ` · ${new Date(info.at).toLocaleString("id-ID", {
                                      day: "2-digit", month: "short",
                                      hour: "2-digit", minute: "2-digit",
                                      timeZone: "Asia/Jakarta",
                                    })}`
                                  : ""}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
                    </div>
              </TaskGroup>
            ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
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
                Sub-task (opsional)
              </label>
              <div className="mt-1 space-y-1.5">
                {fSubtasks.map((st, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={st.title}
                      placeholder={`Sub-task ${i + 1}`}
                      onChange={(e) =>
                        setFSubtasks((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))
                        )
                      }
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="px-2 text-red-500"
                      onClick={() => setFSubtasks((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setFSubtasks((prev) => [...prev, { title: "" }])}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Sub-task
                  </Button>
                  {fSubtasks.filter((st) => st.title.trim()).length > 0 ? (
                    <span className="text-xs text-gray-500">
                      {fSubtasks.filter((st) => st.title.trim()).length} sub-task
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
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
