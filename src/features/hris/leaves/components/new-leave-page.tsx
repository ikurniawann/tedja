"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeftIcon, CheckCircle2, Upload, Loader2, X, FileText } from "lucide-react";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { LEAVE_TYPE_LABELS } from "@/types/hris";
import { useLeaveEmployees } from "../queries";
import { useCreateLeave } from "../mutations";

export function NewLeavePage() {
  const router = useRouter();
  const { toasts, showToast, removeToast } = useToast();

  const { data: employeesData } = useLeaveEmployees();
  const employees = employeesData ?? [];
  const createMutation = useCreateLeave();
  const submitting = createMutation.isPending;

  const [searchQuery, setSearchQuery] = useState("");
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [totalDays, setTotalDays] = useState(1);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [submissionData, setSubmissionData] = useState<any>(null);

  const [formData, setFormData] = useState({
    employee_id: "",
    leave_type: "annual",
    start_date: "",
    end_date: "",
    reason: "",
    attachment_url: "",
  });

  useEffect(() => {
    if (formData.start_date && formData.end_date) {
      const days = calculateBusinessDays(formData.start_date, formData.end_date);
      setTotalDays(days);
    } else {
      setTotalDays(0);
    }
  }, [formData.start_date, formData.end_date]);

  const filteredEmployees = employees.filter((emp) =>
    emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.nip.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const calculateBusinessDays = (startDate: string, endDate: string): number => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    let count = 0;
    const current = new Date(start);

    while (current <= end) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) {
        count++;
      }
      current.setDate(current.getDate() + 1);
    }
    return count || 1;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showToast("Tipe File Tidak Valid: gunakan gambar JPG/PNG/WebP (foto dokumen)", "error");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast("File Terlalu Besar: Ukuran file maksimal 5MB", "error");
      return;
    }

    if (!formData.employee_id) {
      showToast("Pilih karyawan dulu sebelum meng-upload lampiran", "error");
      return;
    }

    try {
      setUploadingFile(true);
      setSelectedFile(file);

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Gagal membaca file"));
        reader.readAsDataURL(file);
      });
      setPreviewUrl(dataUrl);

      const res = await fetch("/api/hris/leaves/attachment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: dataUrl, employee_id: formData.employee_id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal upload lampiran");

      setFormData({ ...formData, attachment_url: json.data.path });
      showToast(`Lampiran "${file.name}" tersimpan`, "success");
    } catch (error) {
      console.error("Upload error:", error);
      setSelectedFile(null);
      setPreviewUrl(null);
      setFormData({ ...formData, attachment_url: "" });
      showToast(
        error instanceof Error ? error.message : "Upload Gagal: Terjadi kesalahan saat upload file",
        "error"
      );
    } finally {
      setUploadingFile(false);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setFormData({ ...formData, attachment_url: "" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.employee_id) {
      showToast("Validasi Gagal: Pilih karyawan terlebih dahulu", "error");
      return;
    }

    if (!formData.start_date || !formData.end_date) {
      showToast("Validasi Gagal: Tanggal mulai dan selesai harus diisi", "error");
      return;
    }

    if (formData.end_date < formData.start_date) {
      showToast("Validasi Gagal: Tanggal selesai tidak boleh sebelum tanggal mulai", "error");
      return;
    }

    if (!formData.reason || formData.reason.length < 10) {
      showToast("Validasi Gagal: Alasan minimal 10 karakter", "error");
      return;
    }

    try {
      const result = await createMutation.mutateAsync(formData);

      const employee = employees.find((e) => e.id === formData.employee_id);
      setSubmissionData({
        ...result.data,
        total_days: totalDays,
        employee_name: employee?.full_name,
      });
      setShowSuccessModal(true);
    } catch (error) {
      console.error("Submit error:", error);
      showToast(
        error instanceof Error ? `Pengajuan Gagal: ${error.message}` : "Gagal mengajukan cuti. Silakan coba lagi.",
        "error"
      );
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-3xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Button variant="outline" onClick={() => router.push("/dashboard/hris/leaves")}>
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Kembali
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ajukan Cuti / Izin</h1>
          <p className="text-sm text-gray-500">Form pengajuan cuti atau izin karyawan</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Form Pengajuan Cuti</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Employee Selection */}
            <div>
              <Label htmlFor="employee_id">Karyawan *</Label>
              <div className="relative mt-1">
                <Input
                  id="employee_id"
                  placeholder="Cari nama atau NIP karyawan..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowEmployeeDropdown(true);
                    if (e.target.value === '') {
                      setFormData({ ...formData, employee_id: "" });
                    }
                  }}
                  onFocus={() => setShowEmployeeDropdown(true)}
                  onBlur={() => setTimeout(() => setShowEmployeeDropdown(false), 200)}
                />
                {showEmployeeDropdown && filteredEmployees.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                    {filteredEmployees.map((emp) => (
                      <div
                        key={emp.id}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                        onClick={() => {
                          setFormData({ ...formData, employee_id: emp.id });
                          setSearchQuery(`${emp.full_name} (${emp.nip})`);
                          setShowEmployeeDropdown(false);
                        }}
                      >
                        <div className="font-medium text-sm">{emp.full_name}</div>
                        <div className="text-xs text-gray-500">{emp.nip} - {emp.department?.name || 'No Dept'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Leave Type */}
            <div>
              <Label htmlFor="leave_type">Jenis Cuti *</Label>
              <Select
                value={formData.leave_type}
                onValueChange={(value) => setFormData({ ...formData, leave_type: value })}
              >
                <SelectTrigger className="mt-1" id="leave_type">
                  <SelectValue placeholder="Pilih jenis cuti" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start_date">Tanggal Mulai *</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="end_date">Tanggal Selesai *</Label>
                <Input
                  id="end_date"
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>

            {/* Total Days Display */}
            {totalDays > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-green-800">Total Hari (hari kerja):</span>
                  <Badge variant="outline" className="bg-green-100 text-green-800">
                    {totalDays} hari
                  </Badge>
                </div>
              </div>
            )}

            {/* Reason */}
            <div>
              <Label htmlFor="reason">Alasan *</Label>
              <Textarea
                id="reason"
                placeholder="Jelaskan alasan pengajuan cuti..."
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                rows={4}
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">Minimal 10 karakter</p>
            </div>

            {/* File Upload */}
            <div>
              <Label>Lampiran (Opsional)</Label>
              {!selectedFile ? (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors mt-1">
                  <input
                    type="file"
                    id="file-upload"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileUpload}
                    disabled={uploadingFile}
                    className="hidden"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    {uploadingFile ? (
                      <>
                        <Loader2 className="w-8 h-8 mx-auto text-gray-400 animate-spin mb-2" />
                        <p className="text-sm text-gray-500">Uploading...</p>
                      </>
                    ) : (
                      <>
                        <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                        <p className="text-sm text-gray-600 mb-1">Klik untuk upload atau drag & drop</p>
                        <p className="text-xs text-gray-500">PDF, JPG, PNG (Max 5MB)</p>
                      </>
                    )}
                  </label>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg p-4 mt-1">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      {previewUrl ? (
                        <img src={previewUrl} alt="Preview" className="w-16 h-16 object-cover rounded" />
                      ) : (
                        <div className="w-16 h-16 bg-red-100 rounded flex items-center justify-center">
                          <FileText className="w-8 h-8 text-red-600" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{selectedFile.name}</p>
                        <p className="text-xs text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={handleRemoveFile}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">Upload surat dokter atau dokumen pendukung lainnya</p>
            </div>

            {/* Submit Button */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/dashboard/hris/leaves")}
                className="flex-1"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-pink-600 hover:bg-pink-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Mengajukan...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Ajukan Cuti
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Success Modal */}
      {showSuccessModal && submissionData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="text-center mb-4">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-3">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Pengajuan Berhasil!</h2>
            </div>

            <div className="space-y-3 mb-4">
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Karyawan</span>
                  <span className="font-medium">{submissionData.employee_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Jenis Cuti</span>
                  <span className="font-medium">{LEAVE_TYPE_LABELS[submissionData.leave_type as keyof typeof LEAVE_TYPE_LABELS]}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Periode</span>
                  <span className="font-medium">
                    {new Date(submissionData.start_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - {new Date(submissionData.end_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total Hari</span>
                  <Badge variant="outline" className="bg-green-100 text-green-800">{submissionData.total_days} hari</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Status</span>
                  <Badge variant="outline" className="bg-yellow-100 text-yellow-800">Menunggu Persetujuan</Badge>
                </div>
              </div>
              <p className="text-sm text-gray-500 text-center">
                Pengajuan cuti Anda sedang menunggu persetujuan dari atasan.
              </p>
            </div>

            <Button
              onClick={() => router.push("/dashboard/hris/leaves")}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              Tutup
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
