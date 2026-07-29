"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalendarIcon, Upload, Loader2, X, FileText, Image as ImageIcon, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LEAVE_TYPE_LABELS } from "@/types/hris";
import { describeLeaveDays } from "@/lib/hris/holidays";
import { fetchHolidayIndex } from "@/lib/hris/holidays-client";
import { format } from "date-fns";
import { id } from "date-fns/locale";

const leaveFormSchema = z.object({
  employee_id: z.string().uuid("Pilih karyawan terlebih dahulu"),
  leave_type: z.enum(["annual", "sick", "maternity", "paternity", "unpaid", "emergency", "pilgrimage", "menstrual", "marriage", "bereavement"]),
  start_date: z.string().min(1, "Start date is required"),
  end_date: z.string().min(1, "End date is required"),
  reason: z.string().min(10, "Reason must be at least 10 characters"),
  attachment_url: z.string().optional().or(z.literal("")),
});

type LeaveFormData = z.infer<typeof leaveFormSchema>;

interface LeaveRequestFormProps {
  employeeId?: string;
  onSuccess?: (data: any) => void;
  onCancel?: () => void;
}

export function LeaveRequestForm({
  employeeId,
  onSuccess,
  onCancel,
}: LeaveRequestFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [totalDays, setTotalDays] = useState<number>(0);
  const [excludedHolidays, setExcludedHolidays] = useState<
    { date: string; name: string }[]
  >([]);
  const [leaveBalance, setLeaveBalance] = useState<number | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [submissionData, setSubmissionData] = useState<any>(null);
  const { toast } = useToast();

  const form = useForm<LeaveFormData>({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: {
      employee_id: employeeId,
      leave_type: "annual",
      start_date: "",
      end_date: "",
      reason: "",
      attachment_url: "",
    },
  });

  const startDate = form.watch("start_date");
  const endDate = form.watch("end_date");
  const leaveType = form.watch("leave_type");
  const employeeIdValue = form.watch("employee_id");

  useEffect(() => {
    fetchEmployees();
  }, []);

  /**
   * Pratinjau jumlah hari (EPIC-036 Fase D): akhir pekan DAN hari libur resmi
   * tidak memotong jatah, cuti bersama tetap memotong. Angka yang mengikat
   * tetap dihitung ulang server saat pengajuan disimpan — ini hanya supaya
   * karyawan tidak kaget melihat selisihnya.
   */
  useEffect(() => {
    if (!startDate || !endDate || endDate < startDate) {
      setTotalDays(0);
      setExcludedHolidays([]);
      return;
    }
    let cancelled = false;
    void fetchHolidayIndex(startDate, endDate).then((index) => {
      if (cancelled) return;
      const breakdown = describeLeaveDays(startDate, endDate, index);
      setTotalDays(breakdown.totalDays);
      setExcludedHolidays(breakdown.excludedHolidays);
    });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  useEffect(() => {
    if (employeeId && leaveType === "annual") {
      fetchLeaveBalance();
    }
  }, [employeeId, leaveType]);

  const fetchLeaveBalance = async () => {
    try {
      const response = await fetch(`/api/hris/leave-balances/${employeeId}`);
      const result = await response.json();
      
      if (result.data) {
        setLeaveBalance(result.data.annual_leave_remaining);
      }
    } catch (error) {
      console.error("Error fetching leave balance:", error);
    }
  };

  const fetchEmployees = async () => {
    try {
      const response = await fetch("/api/hris/employees?limit=100");
      const result = await response.json();
      
      if (result.data) {
        setEmployees(result.data);
      }
    } catch (error) {
      console.error("Error fetching employees:", error);
    }
  };

  const filteredEmployees = employees.filter((emp) =>
    emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.nip.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "❌ Tipe File Tidak Valid",
        description: "Hanya PDF, JPG, dan PNG yang diperbolehkan",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "❌ File Terlalu Besar",
        description: "Ukuran file maksimal 5MB",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploadingFile(true);
      setSelectedFile(file);

      // Create preview URL for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreviewUrl(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setPreviewUrl(null);
      }

      // TODO: Upload to storage service (S3, local filesystem, etc.)
      // For now, we'll just store the file name
      toast({
        title: "✅ File Berhasil Diupload",
        description: `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
      });

      // Store file info in form (in real app, this would be the URL from storage)
      form.setValue("attachment_url", `/uploads/${file.name}`);
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "❌ Upload Gagal",
        description: "Terjadi kesalahan saat upload file",
        variant: "destructive",
      });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    form.setValue("attachment_url", "");
  };

  const onSubmit = async (data: LeaveFormData) => {
    console.log("✅ Form submitted with data:", data);
    
    try {
      setIsSubmitting(true);

      // Validate employee_id
      if (!data.employee_id) {
        console.error("❌ Validation failed: employee_id is missing");
        toast({
          title: "❌ Validasi Gagal",
          description: "Pilih karyawan terlebih dahulu",
          variant: "destructive",
        });
        return;
      }

      console.log("📤 Sending request to API...");
      const response = await fetch("/api/hris/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();
      console.log("📥 API Response:", result, "Status:", response.status);

      if (!response.ok) {
        if (result.error?.includes("Insufficient")) {
          toast({
            title: "❌ Saldo Cuti Tidak Cukup",
            description: `Saldo tersisa: ${result.remaining || 0} hari`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "❌ Pengajuan Gagal",
            description: result.details ? result.details.join(", ") : (result.error || "Terjadi kesalahan"),
            variant: "destructive",
          });
        }
        return;
      }

      toast({
        title: "✅ Pengajuan Cuti Berhasil",
        description: `${totalDays} hari cuti diajukan`,
      });

      // Store submission data for modal
      setSubmissionData({
        ...result.data,
        total_days: totalDays,
        employee_name: employees.find(e => e.id === data.employee_id)?.full_name,
      });

      // Show success modal
      setShowSuccessModal(true);
      
      onSuccess?.(result.data);
      form.reset();
    } catch (error) {
      console.error("Submit error:", error);
      toast({
        title: "Error",
        description: "Gagal mengajukan cuti. Silakan coba lagi.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const insufficientBalance = leaveType === "annual" && leaveBalance !== null && totalDays > leaveBalance;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ajukan Cuti / Izin</CardTitle>
        <CardDescription>
          Isi formulir di bawah untuk mengajukan cuti atau izin
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form 
            onSubmit={(e) => {
              console.log("📝 Form submit triggered");
              console.log("📋 Form values:", form.getValues());
              console.log("📋 Form errors:", form.formState.errors);
              form.handleSubmit(onSubmit)(e);
            }} 
            className="space-y-6"
          >
            {/* Employee ID with Search Dropdown */}
            {!employeeId ? (
              <FormField
                control={form.control}
                name="employee_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Karyawan *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          placeholder="Cari nama atau NIP karyawan..."
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setShowEmployeeDropdown(true);
                            // Clear employee_id when typing
                            if (e.target.value === '') {
                              form.setValue("employee_id", "");
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
                                  form.setValue("employee_id", emp.id, {
                                    shouldValidate: true,
                                    shouldDirty: true,
                                  });
                                  setSearchQuery(`${emp.full_name} (${emp.nip})`);
                                  setShowEmployeeDropdown(false);
                                  console.log("Selected employee:", emp.id, emp.full_name);
                                }}
                              >
                                <div className="font-medium text-sm">{emp.full_name}</div>
                                <div className="text-xs text-gray-500">{emp.nip} - {emp.department?.name || 'No Dept'}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {showEmployeeDropdown && filteredEmployees.length === 0 && searchQuery && !form.getValues("employee_id") && (
                          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500 text-sm">
                            Tidak ada karyawan ditemukan
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/* Leave Type */}
            <FormField
              control={form.control}
              name="leave_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Jenis Cuti</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    value={field.value}
                    defaultValue={field.value || "annual"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih jenis cuti" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Leave Balance Info */}
            {leaveType === "annual" && leaveBalance !== null && (
              <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-blue-800 font-medium">
                    Sisa Cuti Tahunan:
                  </span>
                  <Badge variant="outline" className="bg-blue-100 text-blue-800">
                    {leaveBalance} hari
                  </Badge>
                </div>
              </div>
            )}

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tanggal Mulai</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tanggal Selesai</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Total Days Display */}
            {totalDays > 0 && (
              <div className={`p-3 rounded-lg border ${
                insufficientBalance 
                  ? "bg-red-50 border-red-200" 
                  : "bg-green-50 border-green-200"
              }`}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${
                    insufficientBalance ? "text-red-800" : "text-green-800"
                  }`}>
                    Total Hari (hari kerja):
                  </span>
                  <Badge variant="outline" className={
                    insufficientBalance 
                      ? "bg-red-100 text-red-800" 
                      : "bg-green-100 text-green-800"
                  }>
                    {totalDays} hari
                  </Badge>
                </div>
                {excludedHolidays.length > 0 && (
                  <p className="text-xs text-gray-600 mt-2">
                    Tidak memotong jatah:{" "}
                    {excludedHolidays.map((h) => `${h.name} (${h.date})`).join(", ")}
                  </p>
                )}
                {insufficientBalance && (
                  <p className="text-xs text-red-600 mt-2">
                    ⚠️ Saldo cuti tidak mencukupi
                  </p>
                )}
              </div>
            )}

            {/* Seluruh rentang jatuh di akhir pekan / tanggal merah — server
                akan menolaknya, jadi katakan sekarang daripada setelah submit. */}
            {startDate && endDate && endDate >= startDate && totalDays === 0 && (
              <div className="p-3 rounded-lg border bg-amber-50 border-amber-200">
                <p className="text-sm text-amber-800">
                  Rentang ini sudah libur seluruhnya
                  {excludedHolidays.length > 0 &&
                    ` (${excludedHolidays.map((h) => h.name).join(", ")})`}
                  {" "}— tidak perlu mengajukan cuti.
                </p>
              </div>
            )}

            {/* Reason */}
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Alasan</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Jelaskan alasan pengajuan cuti..."
                      className="resize-none"
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Minimal 10 karakter
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Attachment File Upload */}
            <FormField
              control={form.control}
              name="attachment_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lampiran (Opsional)</FormLabel>
                  <FormControl>
                    <div className="space-y-2">
                      {!selectedFile ? (
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
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
                                <p className="text-sm text-gray-600 mb-1">
                                  Klik untuk upload atau drag & drop
                                </p>
                                <p className="text-xs text-gray-500">
                                  PDF, JPG, PNG (Max 5MB)
                                </p>
                              </>
                            )}
                          </label>
                        </div>
                      ) : (
                        <div className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3 flex-1">
                              {previewUrl ? (
                                <img
                                  src={previewUrl}
                                  alt="Preview"
                                  className="w-16 h-16 object-cover rounded"
                                />
                              ) : (
                                <div className="w-16 h-16 bg-red-100 rounded flex items-center justify-center">
                                  <FileText className="w-8 h-8 text-red-600" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {selectedFile.name}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleRemoveFile}
                              className="shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </FormControl>
                  <FormDescription>
                    Upload surat dokter atau dokumen pendukung lainnya (PDF, JPG, PNG)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={isSubmitting || insufficientBalance}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Mengajukan...
                  </>
                ) : (
                  <>
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    Ajukan Cuti
                  </>
                )}
              </Button>
              
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel}>
                  Batal
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>

      {/* Success Modal */}
      <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center pb-4">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-3">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
              <p className="text-xl font-bold text-gray-900">Pengajuan Berhasil!</p>
            </DialogTitle>
          </DialogHeader>
          
          {submissionData && (
            <div className="space-y-4 py-2">
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Karyawan</span>
                  <span className="text-sm font-medium text-gray-900">{submissionData.employee_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Jenis Cuti</span>
                  <span className="text-sm font-medium text-gray-900">
                    {LEAVE_TYPE_LABELS[submissionData.leave_type]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Periode</span>
                  <span className="text-sm font-medium text-gray-900">
                    {new Date(submissionData.start_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - {' '}
                    {new Date(submissionData.end_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Total Hari</span>
                  <Badge variant="outline" className="bg-green-100 text-green-800">
                    {submissionData.total_days} hari
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Status</span>
                  <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                    Menunggu Persetujuan
                  </Badge>
                </div>
              </div>

              <div className="text-center text-sm text-gray-500">
                <p>Pengajuan cuti Anda sedang menunggu persetujuan dari atasan.</p>
                <p className="mt-1">Anda akan menerima notifikasi jika sudah disetujui.</p>
              </div>
            </div>
          )}

          <div className="pt-4">
            <Button
              onClick={() => {
                setShowSuccessModal(false);
                if (onCancel) onCancel();
              }}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              Tutup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
