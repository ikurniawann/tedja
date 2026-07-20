"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  ArrowUpTrayIcon,
} from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelToolbar,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TableRow } from "@/components/ui/table";
import { ToastContainer, useToast } from "@/components/ui/toast";
import {
  FormFieldLabel,
  formInputClassName,
} from "@/components/layout/form-field";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { MasterDeleteDialog } from "@/features/master-data/components/master-delete-dialog";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import { useAccountTypeList } from "@/features/accounting/account-types/queries";
import {
  buildCoaTree,
  collectExpandableCoaIds,
  flattenCoaTree,
} from "@/lib/accounting/coa-tree";
import { CASH_FLOW_CATEGORIES } from "@/lib/accounting/coa-types";
import { formatAccountCodeDisplay } from "@/lib/accounting/account-code";
import { useCoaList } from "../queries";
import {
  useCreateCoaAccount,
  useUpdateCoaAccount,
  useDeleteCoaAccount,
  useImportCoa,
} from "../mutations";
import type { CoaAccountItem, CoaImportResult } from "../types";

const EMPTY_FORM = {
  code: "",
  name: "",
  parent_id: "" as string,
  account_type_id: "",
  is_contra: false,
  cash_flow_category: "" as string,
  description: "",
  is_active: true,
};

export function ChartOfAccountsPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [postableFilter, setPostableFilter] = useState("");
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);
  const [selected, setSelected] = useState<CoaAccountItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<CoaImportResult | null>(null);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      account_type_id: typeFilter || undefined,
      is_postable: postableFilter || undefined,
    }),
    [search, typeFilter, postableFilter]
  );

  const { data, isLoading } = useCoaList(filters);
  const { data: accountTypes } = useAccountTypeList();
  const createMutation = useCreateCoaAccount();
  const updateMutation = useUpdateCoaAccount();
  const deleteMutation = useDeleteCoaAccount();
  const importMutation = useImportCoa();

  const rows = useMemo(() => data ?? [], [data]);
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;
  const isImporting = importMutation.isPending;

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const tree = useMemo(() => buildCoaTree(rows), [rows]);
  const expandableIds = useMemo(() => collectExpandableCoaIds(tree), [tree]);

  useEffect(() => {
    setExpandedIds((prev) => {
      if (prev.size === 0 && expandableIds.length > 0) {
        return new Set(expandableIds);
      }
      const next = new Set(prev);
      for (const id of expandableIds) {
        if (!next.has(id) && prev.size === 0) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [expandableIds]);

  const flatRows = useMemo(
    () => flattenCoaTree(tree, expandedIds),
    [tree, expandedIds]
  );

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAdd(parent?: CoaAccountItem | null) {
    setSelected(null);
    setForm({
      ...EMPTY_FORM,
      parent_id: parent?.id ?? "",
      account_type_id:
        parent?.account_type_id || accountTypes?.[0]?.id || "",
    });
    setDialog("add");
  }

  function openEdit(item: CoaAccountItem) {
    setSelected(item);
    setForm({
      code: item.code_display || item.code,
      name: item.name,
      parent_id: item.parent_id ?? "",
      account_type_id: item.account_type_id,
      is_contra: item.is_contra,
      cash_flow_category: item.cash_flow_category ?? "",
      description: item.description ?? "",
      is_active: item.is_active,
    });
    setDialog("edit");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!form.code.trim() || !form.name.trim() || !form.account_type_id) {
      showToast("Kode, nama, dan account type wajib diisi", "error");
      return;
    }
    const payload = {
      code: form.code,
      name: form.name,
      parent_id: form.parent_id || null,
      account_type_id: form.account_type_id,
      is_contra: form.is_contra,
      cash_flow_category: (form.cash_flow_category || null) as
        | "OPERATING"
        | "INVESTING"
        | "FINANCING"
        | "NON_CASH"
        | null,
      description: form.description || null,
      is_active: form.is_active,
    };
    try {
      if (dialog === "edit" && selected) {
        const res = await updateMutation.mutateAsync({
          id: selected.id,
          ...payload,
        });
        showToast(res.message || "Akun berhasil diperbarui", "success");
      } else {
        const res = await createMutation.mutateAsync(payload);
        showToast(res.message || "Akun berhasil ditambahkan", "success");
      }
      setDialog(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menyimpan", "error");
    }
  }

  async function handleDelete() {
    if (!deleteId || isDeleting) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      showToast("Akun berhasil dihapus", "success");
      setDeleteId(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menghapus", "error");
    }
  }

  async function runImport(mode: "preview" | "commit") {
    if (!importFile || isImporting) return;
    try {
      const res = await importMutation.mutateAsync({ file: importFile, mode });
      setImportResult(res.data);
      if (mode === "commit") {
        showToast(res.message || "Import berhasil", "success");
        setImportOpen(false);
        setImportFile(null);
        setImportResult(null);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Import gagal", "error");
    }
  }

  const parentOptions = useMemo(
    () => rows.filter((r) => !r.is_postable || r.level < 4),
    [rows]
  );

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Chart of Accounts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Master akun hierarkis — {rows.length} akun
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setImportResult(null);
              setImportFile(null);
              setImportOpen(true);
            }}
            className="h-10 gap-2 rounded-lg border-gray-200/80"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            Import Excel
          </Button>
          <Button
            type="button"
            onClick={() => openAdd(null)}
            className="h-10 gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <PlusIcon className="h-4 w-4" />
            Tambah Akun
          </Button>
        </div>
      </div>

      <PurchasingListSection
        icon={PlusIcon}
        title="Daftar Akun"
        description="Tree Chart of Accounts. Hanya akun leaf yang postable."
        toolbar={
          <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center">
            <label className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari kode / nama..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-card pl-9 pr-9 text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label="Clear"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-10 rounded-lg border border-gray-200/80 bg-card px-3 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="">Semua type</option>
              {(accountTypes ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code}
                </option>
              ))}
            </select>
            <select
              value={postableFilter}
              onChange={(e) => setPostableFilter(e.target.value)}
              className="h-10 rounded-lg border border-gray-200/80 bg-card px-3 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="">Semua</option>
              <option value="true">Postable</option>
              <option value="false">Header</option>
            </select>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg border-gray-200/80"
              onClick={() => setExpandedIds(new Set(expandableIds))}
            >
              Expand all
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg border-gray-200/80"
              onClick={() => setExpandedIds(new Set())}
            >
              Collapse
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Memuat COA...</p>
          </div>
        ) : flatRows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-muted-foreground">Belum ada akun</p>
            <Button
              type="button"
              className="mt-4 h-10 rounded-lg bg-primary text-primary-foreground"
              onClick={() => openAdd(null)}
            >
              Tambah akun pertama
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-3">Kode / Nama</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Cash Flow</th>
                  <th className="px-3 py-3">Flags</th>
                  <th className="px-3 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {flatRows.map(({ item, depth, hasChildren }) => (
                  <TableRow
                    key={item.id}
                    className="border-b border-gray-200/70 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2.5">
                      <div
                        className="flex items-center gap-1"
                        style={{ paddingLeft: depth * 16 }}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(item.id)}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                            aria-label="Toggle"
                          >
                            {expandedIds.has(item.id) ? (
                              <ChevronDownIcon className="h-4 w-4" />
                            ) : (
                              <ChevronRightIcon className="h-4 w-4" />
                            )}
                          </button>
                        ) : (
                          <span className="inline-block w-5" />
                        )}
                        <div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {item.code_display ||
                              formatAccountCodeDisplay(item.code)}
                          </div>
                          <div
                            className={
                              item.is_postable
                                ? "font-medium text-foreground"
                                : "font-semibold text-foreground"
                            }
                          >
                            {item.name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="border-gray-200/80">
                        {item.account_type_code || "—"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {item.cash_flow_category || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant="outline"
                          className={
                            item.is_postable
                              ? "border-emerald-200/80 text-emerald-700"
                              : "border-gray-200/80 text-muted-foreground"
                          }
                        >
                          {item.is_postable ? "Postable" : "Header"}
                        </Badge>
                        {item.is_contra ? (
                          <Badge
                            variant="outline"
                            className="border-amber-200/80 text-amber-700"
                          >
                            Contra
                          </Badge>
                        ) : null}
                        {!item.is_active ? (
                          <Badge
                            variant="outline"
                            className="border-gray-200/80 text-muted-foreground"
                          >
                            Nonaktif
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs text-muted-foreground hover:text-primary"
                          onClick={() => openAdd(item)}
                        >
                          + Child
                        </Button>
                        <MasterTableActions
                          onEdit={() => openEdit(item)}
                          onDelete={() => setDeleteId(item.id)}
                        />
                      </div>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogPanel size="md">
          <DialogPanelForm onSubmit={handleSave}>
            <DialogPanelHeader>
              <DialogPanelTitle>
                {dialog === "edit" ? "Edit Akun" : "Tambah Akun"}
              </DialogPanelTitle>
              <DialogPanelDescription>
                Kode compact 7 digit (contoh 1101001) atau format spasi.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-1">
                <FormFieldLabel required>Kode</FormFieldLabel>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value }))
                  }
                  className={formInputClassName}
                  placeholder="1 1 01 001"
                  required
                />
              </div>
              <div className="space-y-1.5 sm:col-span-1">
                <FormFieldLabel required>Account Type</FormFieldLabel>
                <select
                  value={form.account_type_id}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      account_type_id: e.target.value,
                    }))
                  }
                  className={formInputClassName}
                  required
                >
                  <option value="">Pilih type</option>
                  {(accountTypes ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <FormFieldLabel required>Nama</FormFieldLabel>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <FormFieldLabel>Parent</FormFieldLabel>
                <select
                  value={form.parent_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, parent_id: e.target.value }))
                  }
                  className={formInputClassName}
                >
                  <option value="">— Root —</option>
                  {parentOptions
                    .filter((p) => p.id !== selected?.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code_display || p.code} — {p.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel>Cash Flow Category</FormFieldLabel>
                <select
                  value={form.cash_flow_category}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      cash_flow_category: e.target.value,
                    }))
                  }
                  className={formInputClassName}
                >
                  <option value="">—</option>
                  {CASH_FLOW_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel>Deskripsi</FormFieldLabel>
                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  className={formInputClassName}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_contra}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_contra: Boolean(v) }))
                  }
                />
                Contra account
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_active: Boolean(v) }))
                  }
                />
                Aktif
              </label>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog(null)}
                disabled={isSaving}
                className="h-10 rounded-lg border-gray-200/80"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Simpan"
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogPanel size="lg">
          <DialogPanelHeader>
            <DialogPanelTitle>Import Chart of Accounts</DialogPanelTitle>
            <DialogPanelDescription>
              Upload format standar (header code/name) atau file SULU sheet COA.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelToolbar>
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setImportFile(e.target.files?.[0] ?? null);
                setImportResult(null);
              }}
              className="h-10 max-w-md border-gray-200/80"
            />
          </DialogPanelToolbar>
          <DialogPanelBody>
            {importResult ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="outline" className="border-emerald-200/80">
                    create {importResult.summary.create}
                  </Badge>
                  <Badge variant="outline" className="border-sky-200/80">
                    update {importResult.summary.update}
                  </Badge>
                  <Badge variant="outline" className="border-gray-200/80">
                    skip {importResult.summary.skip}
                  </Badge>
                  <Badge variant="outline" className="border-red-200/80">
                    error {importResult.summary.error}
                  </Badge>
                </div>
                <div className="max-h-64 overflow-auto rounded-lg border border-gray-200/70">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200/70 bg-muted/40 text-left">
                        <th className="px-2 py-2">Row</th>
                        <th className="px-2 py-2">Code</th>
                        <th className="px-2 py-2">Name</th>
                        <th className="px-2 py-2">Action</th>
                        <th className="px-2 py-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.preview.slice(0, 100).map((p) => (
                        <tr
                          key={`${p.source_row}-${p.code}`}
                          className="border-b border-gray-200/70"
                        >
                          <td className="px-2 py-1.5">{p.source_row}</td>
                          <td className="px-2 py-1.5 font-mono">{p.code}</td>
                          <td className="px-2 py-1.5">{p.name}</td>
                          <td className="px-2 py-1.5">{p.action}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {p.message || ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {importResult.issues.length > 0 ? (
                  <p className="text-xs text-red-600">
                    {importResult.issues.length} issue parse — lihat console /
                    perbaiki file.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pilih file lalu Preview untuk melihat ringkasan sebelum commit.
              </p>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setImportOpen(false)}
              disabled={isImporting}
              className="h-10 rounded-lg border-gray-200/80"
            >
              Tutup
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!importFile || isImporting}
              onClick={() => runImport("preview")}
              className="h-10 rounded-lg border-gray-200/80"
            >
              {isImporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Preview"
              )}
            </Button>
            <Button
              type="button"
              disabled={
                !importFile ||
                isImporting ||
                !importResult ||
                importResult.summary.error > 0
              }
              onClick={() => runImport("commit")}
              className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isImporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Commit"
              )}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <MasterDeleteDialog
        open={Boolean(deleteId)}
        title="Hapus akun?"
        description="Akun yang masih punya child aktif tidak dapat dihapus."
        isDeleting={isDeleting}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
