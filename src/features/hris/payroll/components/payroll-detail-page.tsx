"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeftIcon,
  BanknotesIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { usePayrollRun } from "../queries";

interface PayrollDetail {
  id: string;
  employee_id: string;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  pph21_deduction: number;
  bpjs_tk_jht_deduction: number;
  bpjs_kes_deduction: number;
  status: string;
  payslip_sent?: boolean;
  employee?: {
    id: string;
    full_name: string;
    nip: string;
    department?: {
      name: string;
    };
  };
}

interface PayrollRun {
  id: string;
  run_name: string;
  period_month: number;
  period_year: number;
  status: string;
  total_employees: number;
  total_gross: number;
  total_net: number;
  total_deductions: number;
  total_pph21: number;
  total_bjtk_employee: number;
  total_bjtk_employer: number;
  notes?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

function getMonthName(month: number): string {
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  return months[month - 1] || "";
}

interface PayrollPageProps {
  params: Promise<{ id: string }>;
}

export function PayrollDetailPage({ params }: PayrollPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { toasts, showToast, removeToast } = useToast();

  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  const runQuery = usePayrollRun(id);
  const payrollRun = (runQuery.data as PayrollRun | undefined) ?? null;
  const details: PayrollDetail[] = runQuery.data?.payroll_details ?? [];
  const loading = runQuery.isLoading;


  async function handleNotify(detailId: string) {
    setNotifyingId(detailId);
    try {
      const res = await fetch("/api/hris/payslips/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payroll_detail_id: detailId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengirim notifikasi");
      if (json.data?.wa_link) {
        window.open(json.data.wa_link, "_blank");
      }
      showToast(json.message || "Slip ditandai terkirim");
      runQuery.refetch();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal mengirim notifikasi", "error");
    } finally {
      setNotifyingId(null);
    }
  }

  async function handleExportCSV() {
    if (!details || details.length === 0) {
      showToast("Tidak ada data untuk diekspor", "error");
      return;
    }

    const headers = [
      "NIP",
      "Nama Karyawan",
      "Departemen",
      "Gaji Kotor",
      "Total Potongan",
      "Gaji Bersih",
      "PPh 21",
      "BPJS TK",
      "BPJS Kes",
    ];

    const rows = details.map((d) => [
      d.employee?.nip || "",
      d.employee?.full_name || "",
      d.employee?.department?.name || "",
      d.gross_salary,
      d.total_deductions,
      d.net_salary,
      d.pph21_deduction,
      d.bpjs_tk_jht_deduction,
      d.bpjs_kes_deduction,
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${payrollRun?.period_month}-${payrollRun?.period_year}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast("CSV berhasil diunduh", "success");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-600" />
      </div>
    );
  }

  if (!payrollRun) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Payroll tidak ditemukan</h2>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/dashboard/hris/payroll")}>
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Kembali
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/hris/payroll")}>
          <ArrowLeftIcon className="w-4 h-4 mr-1" />
          Kembali
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{payrollRun.run_name}</h1>
          <p className="text-sm text-gray-500">
            {getMonthName(payrollRun.period_month)} {payrollRun.period_year} • {payrollRun.total_employees} karyawan
          </p>
        </div>
        <Button onClick={handleExportCSV} variant="outline">
          <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Total Gross</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">
              {formatCurrency(payrollRun.total_gross)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Total Potongan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(payrollRun.total_deductions)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              PPh 21: {formatCurrency(payrollRun.total_pph21)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Total Net (Take Home Pay)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(payrollRun.total_net)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Employer BPJS</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-blue-600">
              {formatCurrency(payrollRun.total_bjtk_employer)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Employee: {formatCurrency(payrollRun.total_bjtk_employee)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Employee Details Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detail Payroll per Karyawan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Karyawan</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Departemen</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Gaji Kotor</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Potongan</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Gaji Bersih</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {details.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">
                      Belum ada detail payroll. Klik &quot;Calculate&quot; di halaman sebelumnya.
                    </td>
                  </tr>
                ) : (
                  details.map((detail) => (
                    <tr key={detail.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div>
                          <div className="font-medium">{detail.employee?.full_name}</div>
                          <div className="text-xs text-gray-500">{detail.employee?.nip}</div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {detail.employee?.department?.name || "-"}
                      </td>
                      <td className="text-right py-3 px-4 font-medium">
                        {formatCurrency(detail.gross_salary)}
                      </td>
                      <td className="text-right py-3 px-4 text-red-600">
                        {formatCurrency(detail.total_deductions)}
                      </td>
                      <td className="text-right py-3 px-4 font-medium text-green-600">
                        {formatCurrency(detail.net_salary)}
                      </td>
                      <td className="text-right py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          {payrollRun?.status === "paid" && (
                            <Button
                              size="sm"
                              variant={detail.payslip_sent ? "ghost" : "outline"}
                              className={detail.payslip_sent ? "text-green-600" : ""}
                              disabled={notifyingId === detail.id}
                              title={
                                detail.payslip_sent
                                  ? "Notifikasi sudah dikirim — klik utk kirim ulang"
                                  : "Kirim notifikasi WhatsApp slip terbit"
                              }
                              onClick={() => handleNotify(detail.id)}
                            >
                              {detail.payslip_sent ? "✓ WA" : "WA"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/dashboard/hris/payroll/${id}/payslip/${detail.employee_id}`)}
                          >
                            <DocumentTextIcon className="w-4 h-4" />
                            Slip
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
