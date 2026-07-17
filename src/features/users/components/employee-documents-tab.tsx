"use client";

import { useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  BriefcaseIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  IdentificationIcon,
  TrashIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  useEmployeeContracts,
  useEmployeeDocuments,
  useEmployeeRecruitmentDocs,
} from "../queries";
import {
  useCreateEmployeeDocument,
  useDeleteEmployeeDocument,
} from "../mutations";

/**
 * Tab "Dokumen" di detail karyawan (HRD/super admin) — menampilkan SEMUA
 * lampiran milik karyawan dalam satu tempat: dokumen asal rekrutmen
 * (CV, Laporan Pipeline), dokumen kontrak (draft PDF + kontrak bertanda
 * tangan per kontrak), dan dokumen kepegawaian yang diupload manual.
 */

const DOC_TYPE_LABELS: Record<string, string> = {
  ktp: "National ID (KTP)",
  npwp: "Tax ID (NPWP)",
  ijazah: "Diploma",
  cv: "CV / Resume",
  kontrak: "Employment Contract",
  bpjs_tk: "BPJS Employment",
  bpjs_kes: "BPJS Health",
  sertifikat: "Certificate",
  other: "Other",
};

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  pkwtt: "PKWTT",
  pkwt: "PKWT",
};

const CONTRACT_STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  active: { label: "Aktif", className: "bg-green-100 text-green-700" },
  ended: { label: "Berakhir", className: "bg-blue-100 text-blue-700" },
  terminated: { label: "Diputus", className: "bg-red-100 text-red-700" },
  converted: { label: "Konversi ke Tetap", className: "bg-purple-100 text-purple-700" },
};

function formatDate(d: string | null | undefined) {
  if (!d) return "-";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

const EMPTY_DOC_FORM = {
  document_type: "ktp",
  document_name: "",
  file_url: "",
  issue_date: "",
  expiry_date: "",
  notes: "",
};

function DocumentRow({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">{title}</p>
          {subtitle ? <p className="text-xs text-gray-500">{subtitle}</p> : null}
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export function EmployeeDocumentsTab({ employeeId }: { employeeId: string }) {
  const { toasts, showToast, removeToast } = useToast();

  const { data: documents = [], isLoading: documentsLoading } =
    useEmployeeDocuments(employeeId);
  const { data: contracts = [], isLoading: contractsLoading } =
    useEmployeeContracts(employeeId);
  const { data: recruitmentDocs, isLoading: recruitmentLoading } =
    useEmployeeRecruitmentDocs(employeeId);

  const createDocumentMutation = useCreateEmployeeDocument(employeeId);
  const deleteDocumentMutation = useDeleteEmployeeDocument(employeeId);

  const [docDialog, setDocDialog] = useState(false);
  const [docForm, setDocForm] = useState(EMPTY_DOC_FORM);
  const [savingDoc, setSavingDoc] = useState(false);

  const loading = documentsLoading || contractsLoading || recruitmentLoading;

  async function handleSaveDocument() {
    if (!docForm.document_name || !docForm.file_url) {
      showToast("Nama dokumen dan URL file wajib diisi", "error");
      return;
    }
    setSavingDoc(true);
    try {
      await createDocumentMutation.mutateAsync(docForm);
      showToast("Dokumen berhasil disimpan");
      setDocDialog(false);
      setDocForm(EMPTY_DOC_FORM);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menyimpan dokumen", "error");
    } finally {
      setSavingDoc(false);
    }
  }

  async function handleDeleteDocument(docId: string) {
    if (!confirm("Hapus dokumen ini?")) return;
    try {
      await deleteDocumentMutation.mutateAsync(docId);
      showToast("Dokumen dihapus");
    } catch {
      showToast("Gagal menghapus dokumen", "error");
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Dokumen rekrutmen: CV + Laporan Pipeline ── */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 font-semibold text-gray-700">
          <UserPlusIcon className="w-4 h-4 text-gray-400" /> Dokumen Rekrutmen
        </h3>
        {recruitmentDocs ? (
          <div className="space-y-2">
            {recruitmentDocs.cv_url ? (
              <DocumentRow
                icon={<DocumentTextIcon className="w-7 h-7 shrink-0 text-red-500" />}
                title="CV / Resume"
                subtitle={
                  <>
                    {recruitmentDocs.cv_url.split(".").pop()?.toUpperCase()}
                    {recruitmentDocs.position_title
                      ? ` · Lamaran: ${recruitmentDocs.position_title}`
                      : ""}
                    {` · ${formatDate(recruitmentDocs.applied_at)}`}
                  </>
                }
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(recruitmentDocs.cv_url!, "_blank")}
                    className="gap-1"
                  >
                    <ArrowDownTrayIcon className="w-4 h-4" /> Unduh
                  </Button>
                }
              />
            ) : (
              <p className="text-sm text-gray-400">CV belum diupload saat rekrutmen.</p>
            )}
            {recruitmentDocs.report_available && (
              <DocumentRow
                icon={<DocumentTextIcon className="w-7 h-7 shrink-0 text-sky-600" />}
                title="Laporan Pipeline"
                subtitle="PDF · seluruh tahapan rekrutmen yang dilalui kandidat"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.open(
                        `/api/candidates/${recruitmentDocs.candidate_id}/report`,
                        "_blank"
                      )
                    }
                    className="gap-1"
                  >
                    <ArrowDownTrayIcon className="w-4 h-4" /> Unduh
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            Karyawan ini tidak berasal dari modul rekrutmen — tidak ada CV/laporan pipeline.
          </p>
        )}
      </div>

      {/* ── Dokumen kontrak: draft PDF + kontrak bertanda tangan ── */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 font-semibold text-gray-700">
          <BriefcaseIcon className="w-4 h-4 text-gray-400" /> Dokumen Kontrak
        </h3>
        {contracts.length === 0 ? (
          <p className="text-sm text-gray-400">Belum ada kontrak untuk karyawan ini.</p>
        ) : (
          <div className="space-y-2">
            {contracts.map((contract) => {
              const statusBadge =
                CONTRACT_STATUS_BADGES[contract.status] ?? {
                  label: contract.status,
                  className: "bg-gray-100 text-gray-600",
                };
              return (
                <div key={contract.id} className="space-y-2">
                  <DocumentRow
                    icon={<DocumentTextIcon className="w-7 h-7 shrink-0 text-amber-600" />}
                    title={`${contract.status === "draft" ? "Draft Kontrak" : "Surat Perjanjian Kerja"} — ${contract.contract_number}`}
                    subtitle={
                      <span className="flex flex-wrap items-center gap-1.5">
                        {CONTRACT_TYPE_LABELS[contract.contract_type] ?? contract.contract_type}
                        <Badge className={statusBadge.className}>{statusBadge.label}</Badge>
                        {`Mulai ${formatDate(contract.start_date)}`}
                        {contract.end_date ? ` s.d. ${formatDate(contract.end_date)}` : ""}
                      </span>
                    }
                    action={
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          window.open(`/api/hris/contracts/${contract.id}/document`, "_blank")
                        }
                        className="gap-1"
                      >
                        <ArrowDownTrayIcon className="w-4 h-4" /> PDF
                      </Button>
                    }
                  />
                  {contract.signed_document_url ? (
                    <DocumentRow
                      icon={<CheckCircleIcon className="w-7 h-7 shrink-0 text-green-600" />}
                      title={`Kontrak Bertanda Tangan — ${contract.contract_number}`}
                      subtitle={
                        contract.signed_at
                          ? `Ditandatangani ${formatDate(contract.signed_at)}`
                          : "Dokumen hasil scan yang diupload"
                      }
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            window.open(
                              `/api/hris/contracts/${contract.id}/signed-document`,
                              "_blank"
                            )
                          }
                          className="gap-1"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4" /> Lihat
                        </Button>
                      }
                    />
                  ) : (
                    <p className="pl-2 text-xs text-gray-400">
                      Dokumen bertanda tangan belum diunggah — kelola lewat tab Kontrak.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Dokumen kepegawaian (upload manual) ── */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="flex items-center gap-2 font-semibold text-gray-700">
            <IdentificationIcon className="w-4 h-4 text-gray-400" /> Dokumen Kepegawaian
          </h3>
          <Button size="sm" onClick={() => setDocDialog(true)} className="gap-1">
            <ArrowUpTrayIcon className="w-4 h-4" /> Upload Dokumen
          </Button>
        </div>
        {documents.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-400">
              <DocumentTextIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              Belum ada dokumen. Klik &quot;Upload Dokumen&quot; untuk menambahkan.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {documents.map((doc) => (
              <Card key={doc.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">
                        {DOC_TYPE_LABELS[doc.document_type] || doc.document_type}
                      </p>
                      <p className="font-medium text-gray-900 text-sm mt-0.5 truncate">
                        {doc.document_name}
                      </p>
                      {doc.issue_date && (
                        <p className="text-xs text-gray-400 mt-1">
                          Terbit: {formatDate(doc.issue_date)}
                        </p>
                      )}
                      {doc.expiry_date && (
                        <p
                          className={`text-xs mt-0.5 ${new Date(doc.expiry_date) < new Date() ? "text-red-500" : "text-gray-400"}`}
                        >
                          Kedaluwarsa: {formatDate(doc.expiry_date)}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => window.open(doc.file_url, "_blank")}
                        className="text-blue-600 hover:bg-blue-50 p-1.5"
                        title="Lihat dokumen"
                      >
                        <IdentificationIcon className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="text-red-500 hover:bg-red-50 p-1.5"
                        title="Hapus"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  {doc.is_verified && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-green-600">
                      <CheckCircleIcon className="w-3.5 h-3.5" /> Terverifikasi
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialog upload dokumen manual */}
      <Dialog open={docDialog} onOpenChange={(o) => !o && setDocDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Dokumen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-gray-600">Jenis Dokumen *</label>
              <Combobox
                options={Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                value={docForm.document_type}
                onChange={(value) => setDocForm((f) => ({ ...f, document_type: value }))}
                placeholder="Pilih jenis dokumen"
                searchPlaceholder="Cari jenis..."
                emptyMessage="Jenis tidak ditemukan"
                className="!w-full h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Nama Dokumen *</label>
              <Input
                value={docForm.document_name}
                onChange={(e) => setDocForm((f) => ({ ...f, document_name: e.target.value }))}
                placeholder="cth. KTP - Budi Santoso"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">URL File *</label>
              <Input
                value={docForm.file_url}
                onChange={(e) => setDocForm((f) => ({ ...f, file_url: e.target.value }))}
                placeholder="https://... atau path file"
              />
              <p className="text-xs text-gray-400 mt-1">
                Upload file ke storage, lalu tempel URL-nya di sini
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Tanggal Terbit</label>
                <Input
                  type="date"
                  value={docForm.issue_date}
                  onChange={(e) => setDocForm((f) => ({ ...f, issue_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Tanggal Kedaluwarsa</label>
                <Input
                  type="date"
                  value={docForm.expiry_date}
                  onChange={(e) => setDocForm((f) => ({ ...f, expiry_date: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Catatan</label>
              <Input
                value={docForm.notes}
                onChange={(e) => setDocForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Opsional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocDialog(false)}>
              Batal
            </Button>
            <Button onClick={handleSaveDocument} disabled={savingDoc}>
              {savingDoc ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
