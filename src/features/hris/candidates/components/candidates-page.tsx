"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useForm, Controller } from "react-hook-form";
import { Loader2, Plus, Download, Search, User, Trash2, Upload, FileText, Menu, X, ScanText } from "lucide-react";
import type { Candidate, CandidateStatus } from "@/types";
import { useCandidateList, useCandidateBrands } from "../queries";
import { useCreateCandidate, useDeleteCandidate } from "../mutations";
import { fetchCandidatesForExport } from "../api";

import {
  CANDIDATE_STATUS_LABELS as STATUS_LABELS,
  CANDIDATE_STATUS_BADGES,
} from "@/lib/recruitment/status";

const SOURCE_LABELS: Record<string, string> = {
  portal: "Portal",
  internal: "Internal",
  referral: "Rekomendasi",
  jobstreet: "JobStreet",
  instagram: "Instagram",
  jobfair: "Job Fair",
  walk_in: "Walk-in",
  internal_referral: "Referral Internal",
  headhunter: "Headhunter",
  other: "Lainnya",
};

const STATUS_COLORS = CANDIDATE_STATUS_BADGES;

export function CandidatesPage() {
  const [filter, setFilter] = useState<{
    status: string;
    brand_id: string;
    position_id: string;
    search: string;
    date_from: string;
    date_to: string;
  }>({
    status: "",
    brand_id: "",
    position_id: "",
    search: "",
    date_from: "",
    date_to: "",
  });
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Candidate | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const cvFileRef = useRef<HTMLInputElement>(null);
  const perPage = 20;

  const listParams = useMemo(
    () => ({ ...filter, page, perPage }),
    [filter, page]
  );
  const listQuery = useCandidateList(listParams);
  const brandsQuery = useCandidateBrands();

  const candidates = listQuery.data?.data ?? [];
  const totalCount = listQuery.data?.count ?? 0;
  const loading = listQuery.isLoading;
  const brands = brandsQuery.data ?? [];

  const createMutation = useCreateCandidate();
  const deleteMutation = useDeleteCandidate();
  const uploadingCv = createMutation.isPending;

  // New candidate form
  type AddFormValues = {
    full_name: string;
    email: string;
    phone: string;
    domicile: string;
    source: string;
    brand_id?: string;
    position_id?: string;
    status: string;
    notes?: string;
    // New fields
    last_experience?: string;
    last_education?: string;
    availability?: string;
    expected_salary?: string;
  };

  const addForm = useForm<AddFormValues>({
    defaultValues: { status: "applied", source: "walk_in" },
  });

  useEffect(() => {
    const t = setTimeout(() => {
      setFilter(f => ({ ...f, search: searchInput }));
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleAddCandidate = async (values: AddFormValues) => {
    const normalizedSource = values.source || 'walk_in';

    try {
      await createMutation.mutateAsync({
        payload: {
          full_name: values.full_name,
          email: values.email,
          phone: values.phone,
          domicile: values.domicile,
          source: normalizedSource,
          brand_id: values.brand_id || null,
          position_id: values.position_id || null,
          status: values.status,
          notes: values.notes || null,
          last_experience: values.last_experience || null,
          last_education: values.last_education || null,
          availability: values.availability || null,
          expected_salary: values.expected_salary ? parseInt(values.expected_salary, 10) : null,
        },
        cvFile,
      });
    } catch (error) {
      alert(`Gagal menyimpan: ${error instanceof Error ? error.message : "Unknown error"}`);
      return;
    }

    setCvFile(null);
    setOcrEnabled(false);
    setOcrError(null);
    setShowAddDialog(false);
    addForm.reset({ status: "applied", source: "walk_in" });
  };

  // OCR CV via OpenAI: isi otomatis Nama, Email, No HP, Domisili
  const runCvOcr = async (file: File) => {
    setOcrLoading(true);
    setOcrError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/candidates/cv-extract", {
        method: "POST",
        body: formData,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "OCR CV gagal");
      }
      const fields = json?.data ?? {};
      if (fields.full_name) addForm.setValue("full_name", fields.full_name, { shouldValidate: true });
      if (fields.email) addForm.setValue("email", fields.email, { shouldValidate: true });
      if (fields.phone) addForm.setValue("phone", fields.phone, { shouldValidate: true });
      if (fields.domicile) addForm.setValue("domicile", fields.domicile, { shouldValidate: true });
      if (fields.last_experience) addForm.setValue("last_experience", fields.last_experience);
      if (fields.last_education) addForm.setValue("last_education", fields.last_education);
      const hasAnyField =
        fields.full_name || fields.email || fields.phone || fields.domicile ||
        fields.last_experience || fields.last_education;
      if (!hasAnyField) {
        setOcrError("Tidak ada data yang terbaca dari CV. Silakan isi manual.");
      }
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : "OCR CV gagal");
    } finally {
      setOcrLoading(false);
    }
  };

  const handleCvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCvFile(file);
    setOcrError(null);
    if (ocrEnabled) void runCvOcr(file);
  };

  const handleOcrToggle = (checked: boolean) => {
    setOcrEnabled(checked);
    setOcrError(null);
    if (checked && cvFile) void runCvOcr(cvFile);
  };

  const handleExportCSV = async () => {
    const data = await fetchCandidatesForExport({
      status: filter.status,
      brand_id: filter.brand_id,
      search: filter.search,
    });
    if (!data || data.length === 0) return;

    const headers = ["Nama", "Email", "Telepon", "Domisili", "Posisi", "Brand", "Status", "Sumber", "Tanggal"];
    const rows = data.map((c: any) => [
      c.full_name,
      c.email,
      c.phone,
      c.domicile,
      c.positions?.title ?? "",
      c.brands?.name ?? "",
      STATUS_LABELS[c.status as CandidateStatus] ?? c.status,
      SOURCE_LABELS[c.source] ?? c.source,
      new Date(c.created_at).toLocaleDateString("id-ID"),
    ]);

    const csvContent = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kandidat_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteCandidate = async () => {
    if (!deleteCandidate) return;
    try {
      await deleteMutation.mutateAsync(deleteCandidate.id);
      setDeleteCandidate(null);
    } catch {
      // keep dialog open on failure
    }
  };

  const totalPages = Math.ceil(totalCount / perPage);

  return (
    <div className="space-y-6">
      {/* Mobile Header with Hamburger Menu */}
      <div className="lg:hidden sticky top-0 z-50 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between h-14 px-4">
          {/* Left - Logo + Title */}
          <div className="flex items-center gap-3">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger
                className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0">
                <div className="border-b border-gray-200 p-4">
                  <h2 className="font-semibold text-lg">HRIS Menu</h2>
                </div>
                <nav className="p-4 space-y-2">
                  <Link
                    href="/dashboard/hris/candidates"
                    className="block px-4 py-2 text-sm font-medium rounded-lg bg-green-50 text-green-700"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    👤 Kandidat
                  </Link>
                  <Link
                    href="/dashboard/hris/pipeline"
                    className="block px-4 py-2 text-sm font-medium rounded-lg hover:bg-gray-50"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    📋 Pipeline
                  </Link>
                  <Link
                    href="/dashboard/hris/talent-pool"
                    className="block px-4 py-2 text-sm font-medium rounded-lg hover:bg-gray-50"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    ⭐ Talent Pool
                  </Link>
                  <Link
                    href="/dashboard/employees"
                    className="block px-4 py-2 text-sm font-medium rounded-lg hover:bg-gray-50"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    💼 Staff
                  </Link>
                  <Link
                    href="/dashboard/hris/attendance"
                    className="block px-4 py-2 text-sm font-medium rounded-lg hover:bg-gray-50"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    📅 Absensi
                  </Link>
                  <Link
                    href="/dashboard/hris/leaves"
                    className="block px-4 py-2 text-sm font-medium rounded-lg hover:bg-gray-50"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    📄 Cuti & Izin
                  </Link>
                  <Link
                    href="/dashboard/employees"
                    className="block px-4 py-2 text-sm font-medium rounded-lg hover:bg-gray-50"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    👨‍👩‍‍👦 Karyawan
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Kandidat</h1>
              <p className="text-xs text-gray-500">{totalCount} kandidat</p>
            </div>
          </div>

          {/* Right - Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="hidden sm:flex items-center justify-center p-2 hover:bg-gray-100 rounded-lg"
              aria-label="Export CSV"
            >
              <Download className="w-4 h-4" />
            </button>
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
      {/* Desktop Header - Hidden on Mobile */}
      <div className="hidden lg:flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kandidat</h1>
          <p className="text-gray-500 text-sm mt-1">
            {totalCount} kandidat ditemukan
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="w-4 h-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">CSV</span>
          </Button>
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="w-4 h-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Tambah Kandidat</span>
            <span className="sm:hidden">Tambah</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Cari nama, email, telepon..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
            {/* Dropdown filters - horizontal scroll on mobile */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              <Select
                value={filter.status}
                onValueChange={(v) => { setFilter((f) => ({ ...f, status: v === "all" ? "" : (v as string) })); setPage(1); }}
              >
                <SelectTrigger className="w-[140px] flex-shrink-0">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filter.brand_id}
                onValueChange={(v) => { setFilter((f) => ({ ...f, brand_id: v === "all" ? "" : (v as string) })); setPage(1); }}
              >
                <SelectTrigger className="w-[140px] flex-shrink-0">
                  <SelectValue placeholder={filter.brand_id && filter.brand_id !== "all" ? (brands.find(b => String(b.id) === filter.brand_id)?.name ?? 'Pilih Outlet') : "Pilih Outlet"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Outlet</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={filter.date_from}
                onChange={(e) => { setFilter((f) => ({ ...f, date_from: e.target.value })); setPage(1); }}
                className="w-[130px] flex-shrink-0 text-sm"
                title="Dari tanggal"
              />
              <Input
                type="date"
                value={filter.date_to}
                onChange={(e) => { setFilter((f) => ({ ...f, date_to: e.target.value })); setPage(1); }}
                className="w-[130px] flex-shrink-0 text-sm"
                title="Sampai tanggal"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Desktop Table / Mobile Cards */}
      <Card>
        <CardContent className="p-0">
          {/* Desktop Table — hidden on mobile */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">No</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Posisi</TableHead>
                  <TableHead>Outlet</TableHead>
                  <TableHead>Sumber</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="w-20">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      Memuat...
                    </TableCell>
                  </TableRow>
                ) : candidates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      Tidak ada kandidat ditemukan
                    </TableCell>
                  </TableRow>
                ) : (
                  candidates.map((c, index) => (
                    <TableRow key={c.id} className="hover:bg-gray-50">
                      <TableCell className="text-center text-gray-500 text-sm">
                        {(page - 1) * perPage + index + 1}
                      </TableCell>                      <TableCell>
                        <div>
                          <p className="font-medium text-gray-900">{c.full_name}</p>
                          <p className="text-gray-500 text-xs">{c.email}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {(c as any).positions?.title ?? "-"}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {(c as any).brands?.name ?? "-"}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {SOURCE_LABELS[c.source] ?? c.source}
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[c.status]}>
                          {STATUS_LABELS[c.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-500 text-xs">
                        {new Date(c.created_at).toLocaleDateString("id-ID")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Link href={`/dashboard/hris/candidates/${c.id}`}>
                            <Button variant="ghost" size="sm" title="Detail">
                              <User className="w-4 h-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => setDeleteCandidate(c)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards — hidden on desktop */}
          <div className="md:hidden divide-y divide-gray-100">
            {loading ? (
              <div className="p-6 text-center text-gray-500">Memuat...</div>
            ) : candidates.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                Tidak ada kandidat ditemukan
              </div>
            ) : (
              candidates.map((c) => (
                <div
                  key={c.id}
                  className="p-4 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{c.full_name}</p>
                      <p className="text-gray-500 text-xs truncate">{c.email}</p>
                    </div>
                    <Badge className={`${STATUS_COLORS[c.status]} flex-shrink-0`}>
                      {STATUS_LABELS[c.status]}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>{(c as any).positions?.title ?? "-"}</span>
                    <span>{(c as any).brands?.name ?? "-"}</span>
                    <span>{SOURCE_LABELS[c.source] ?? c.source}</span>
                    <span>{new Date(c.created_at).toLocaleDateString("id-ID")}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Link href={`/dashboard/hris/candidates/${c.id}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full text-xs h-8">
                        <User className="w-3.5 h-3.5 mr-1" />
                        Detail
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                      onClick={() => setDeleteCandidate(c)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Enhanced Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-sm text-gray-500">
                Menampilkan {(page - 1) * perPage + 1} - {Math.min(page * perPage, totalCount)} dari {totalCount} kandidat
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="h-8 w-8 p-0"
                >
                  ←
                </Button>
                
                {/* Page numbers */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  
                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                      className={`h-8 w-8 p-0 text-xs ${
                        pageNum === page ? "bg-pink-600 hover:bg-pink-700" : ""
                      }`}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="h-8 w-8 p-0"
                >
                  →
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Candidate Dialog */}
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          setShowAddDialog(open);
          if (!open) {
            setCvFile(null);
            setOcrEnabled(false);
            setOcrError(null);
          }
        }}
      >
        <DialogContent className="w-[90vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Tambah Kandidat Manual</DialogTitle>
            <DialogDescription className="text-sm">
              Input kandidat dari walk-in, referral, dll.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={addForm.handleSubmit(handleAddCandidate)} className="space-y-4 mt-4">
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
              <Label className="text-xs font-medium">CV / Resume</Label>
              <input
                ref={cvFileRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={handleCvFileChange}
                className="hidden"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => cvFileRef.current?.click()}
                  disabled={uploadingCv || ocrLoading}
                  className="h-9 text-sm"
                >
                  {cvFile ? (
                    <FileText className="w-4 h-4 mr-2 text-blue-600" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  {cvFile ? "Ganti File" : "Pilih File"}
                </Button>
                {cvFile && (
                  <span className="text-sm text-gray-600 truncate max-w-[200px]">
                    {cvFile.name}
                  </span>
                )}
                <span className="text-xs text-gray-400">PDF, DOC, DOCX, JPG, PNG (max 10MB)</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={ocrEnabled}
                  onCheckedChange={(checked) => handleOcrToggle(checked === true)}
                  disabled={ocrLoading}
                />
                <span className="text-xs text-gray-700 flex items-center gap-1">
                  <ScanText className="w-3.5 h-3.5 text-pink-600" />
                  Isi otomatis dari CV (OCR AI) — Nama, Email, No. HP, Domisili, Pengalaman & Pendidikan Terakhir
                </span>
              </label>
              {ocrLoading && (
                <p className="text-xs text-blue-600 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Membaca CV dengan AI...
                </p>
              )}
              {ocrError && <p className="text-xs text-red-500">{ocrError}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Nama Lengkap <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="Nama lengkap"
                  {...addForm.register("full_name", { required: "Nama lengkap wajib diisi" })}
                  className="h-9 text-sm"
                />
                {addForm.formState.errors.full_name && (
                  <p className="text-xs text-red-500">{addForm.formState.errors.full_name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Email <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="email"
                  placeholder="email@contoh.com"
                  {...addForm.register("email", { 
                    required: "Email wajib diisi",
                    pattern: { value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, message: "Email tidak valid" }
                  })}
                  className="h-9 text-sm"
                />
                {addForm.formState.errors.email && (
                  <p className="text-xs text-red-500">{addForm.formState.errors.email.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  No. WhatsApp <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="081234567890"
                  {...addForm.register("phone", { required: "No. WhatsApp wajib diisi" })}
                  className="h-9 text-sm"
                />
                {addForm.formState.errors.phone && (
                  <p className="text-xs text-red-500">{addForm.formState.errors.phone.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Domisili <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="Kota"
                  {...addForm.register("domicile", { required: "Domisili wajib diisi" })}
                  className="h-9 text-sm"
                />
                {addForm.formState.errors.domicile && (
                  <p className="text-xs text-red-500">{addForm.formState.errors.domicile.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Outlet / Brand</Label>
                <Controller
                  name="brand_id"
                  control={addForm.control}
                  render={({ field }) => {
                      return (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder={field.value ? (brands.find(b => String(b.id) === field.value)?.name ?? 'Pilih Outlet') : "Pilih Outlet"} />
                        </SelectTrigger>
                        <SelectContent>
                          {brands.map((b) => (
                            <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Sumber</Label>
                <Controller
                  name="source"
                  control={addForm.control}
                  defaultValue="walk_in"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Pilih Sumber" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="walk_in">Walk-in</SelectItem>
                        <SelectItem value="referral">Rekomendasi</SelectItem>
                        <SelectItem value="internal_referral">Referral Internal</SelectItem>
                        <SelectItem value="jobfair">Job Fair</SelectItem>
                        <SelectItem value="headhunter">Headhunter</SelectItem>
                        <SelectItem value="portal">Portal</SelectItem>
                        <SelectItem value="instagram">Instagram</SelectItem>
                        <SelectItem value="jobstreet">JobStreet</SelectItem>
                        <SelectItem value="other">Lainnya</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Status Awal</Label>
              <Controller
                name="status"
                control={addForm.control}
                defaultValue="applied"
                render={({ field }) => (
                  <Select value={field.value || "applied"} onValueChange={field.onChange}>
                    <SelectTrigger className="h-9 text-sm w-[180px]">
                      <SelectValue placeholder="Pilih Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="applied">Applied</SelectItem>
                      <SelectItem value="screening">Screening</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Catatan</Label>
              <Textarea
                placeholder="Catatan internal (opsional)"
                rows={3}
                {...addForm.register("notes")}
                className="text-sm resize-none"
              />
            </div>

            {/* New Profile Fields Section */}
            <div className="border-t border-gray-200 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Informasi Tambahan</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Pengalaman Kerja Terakhir</Label>
                  <Input
                    placeholder="PT Company - Position (2 tahun)"
                    {...addForm.register("last_experience")}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Pendidikan Terakhir</Label>
                  <Input
                    placeholder="S1/D3/SMA - Jurusan - Universitas/Sekolah"
                    {...addForm.register("last_education")}
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Status Ketersediaan</Label>
                  <Controller
                    name="availability"
                    control={addForm.control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Pilih ketersediaan" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="immediate">Secepatnya</SelectItem>
                          <SelectItem value="1_week">1 Minggu</SelectItem>
                          <SelectItem value="2_weeks">2 Minggu</SelectItem>
                          <SelectItem value="1_month">1 Bulan</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Ekspektasi Gaji (Rp)</Label>
                  <Input
                    type="number"
                    placeholder="5000000"
                    {...addForm.register("expected_salary")}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowAddDialog(false);
                  setCvFile(null);
                  setOcrEnabled(false);
                  setOcrError(null);
                }}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={addForm.formState.isSubmitting || uploadingCv || ocrLoading}
                className="bg-pink-600 hover:bg-pink-700"
              >
                {addForm.formState.isSubmitting || uploadingCv ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Simpan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteCandidate} onOpenChange={(v) => !v && setDeleteCandidate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus Kandidat</DialogTitle>
            <DialogDescription>
              Apakah kamu yakin ingin menghapus kandidat{" "}
              <span className="font-medium text-gray-900">{deleteCandidate?.full_name}</span>?
              Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteCandidate(null)}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteCandidate}
            >
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
