"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { CheckIcon } from "@heroicons/react/24/solid";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { useSalaryEmployees } from "../queries";
import { useCreateSalary } from "../mutations";

export function NewSalaryPage() {
  const router = useRouter();
  const { toasts, showToast, removeToast } = useToast();

  const employeesQuery = useSalaryEmployees();
  const employees = employeesQuery.data ?? [];
  // NIP ditaruh di `description` agar karyawan bisa dicari lewat nama ATAU NIP.
  const employeeOptions = employees.map((emp) => ({
    value: emp.id,
    label: emp.full_name,
    description: emp.nip ?? undefined,
  }));
  const createMutation = useCreateSalary();
  const saving = createMutation.isPending;

  const [formData, setFormData] = useState({
    employee_id: "",
    base_salary: "",
    fixed_allowance: "0",
    variable_allowance: "0",
    transport_allowance: "0",
    meal_allowance: "0",
    housing_allowance: "0",
    loan_deduction: "0",
    other_deduction: "0",
    ptkp_status: "TK/0",
    is_taxable: true,
    bpjs_tk_enrolled: true,
    bpjs_kes_enrolled: true,
    tapera_enrolled: true,
  });

  // Helper function to format number to IDR string
  const formatToIDR = (value: string): string => {
    const num = parseInt(value.replace(/[^0-9]/g, '')) || 0;
    return num.toLocaleString('id-ID');
  };

  // Helper function to parse IDR string to number
  const parseFromIDR = (value: string): number => {
    return parseInt(value.replace(/[^0-9]/g, '')) || 0;
  };

  // Handle change for currency inputs
  const handleCurrencyChange = (field: string, value: string) => {
    const formatted = formatToIDR(value);
    setFormData({ ...formData, [field]: formatted });
  };

  async function handleSave() {
    if (!formData.employee_id || !formData.base_salary) {
      showToast("Karyawan dan gaji pokok wajib diisi", "error");
      return;
    }

    try {
      await createMutation.mutateAsync({
        employee_id: formData.employee_id,
        base_salary: parseFromIDR(formData.base_salary),
        fixed_allowance: parseFromIDR(formData.fixed_allowance),
        variable_allowance: parseFromIDR(formData.variable_allowance),
        transport_allowance: parseFromIDR(formData.transport_allowance),
        meal_allowance: parseFromIDR(formData.meal_allowance),
        housing_allowance: parseFromIDR(formData.housing_allowance),
        loan_deduction: parseFromIDR(formData.loan_deduction),
        other_deduction: parseFromIDR(formData.other_deduction),
        ptkp_status: formData.ptkp_status,
        is_taxable: formData.is_taxable,
        bpjs_tk_enrolled: formData.bpjs_tk_enrolled,
        bpjs_kes_enrolled: formData.bpjs_kes_enrolled,
        tapera_enrolled: formData.tapera_enrolled,
      });

      showToast("Salary structure berhasil dibuat", "success");
      setTimeout(() => {
        router.push("/dashboard/hris/salary");
      }, 1000);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Terjadi kesalahan", "error");
    }
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Button
          variant="outline"
          onClick={() => router.push("/dashboard/hris/salary")}
        >
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Kembali
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tambah Salary Structure</h1>
          <p className="text-sm text-gray-500">Tambahkan struktur gaji baru untuk karyawan</p>
        </div>
      </div>

      {/* Salary Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Informasi Salary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Employee Selection */}
          <div>
            <Label htmlFor="employee_id">Karyawan *</Label>
            <div className="mt-1">
              <Combobox
                options={employeeOptions}
                value={formData.employee_id}
                onChange={(value) => setFormData({ ...formData, employee_id: value })}
                placeholder={
                  employeesQuery.isLoading ? "Memuat karyawan…" : "Pilih karyawan"
                }
                searchPlaceholder="Cari nama atau NIP…"
                emptyMessage="Karyawan tidak ditemukan"
                disabled={employeesQuery.isLoading}
                allowClear
              />
            </div>
          </div>

          {/* Penghasilan */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Penghasilan</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="base_salary">Gaji Pokok (Rp) *</Label>
                <Input
                  id="base_salary"
                  type="text"
                  value={formData.base_salary}
                  onChange={(e) => handleCurrencyChange('base_salary', e.target.value)}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="fixed_allowance">Tunjangan Tetap (Rp)</Label>
                <Input
                  id="fixed_allowance"
                  type="text"
                  value={formData.fixed_allowance}
                  onChange={(e) => handleCurrencyChange('fixed_allowance', e.target.value)}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="variable_allowance">Tunjangan Variabel (Rp)</Label>
                <Input
                  id="variable_allowance"
                  type="text"
                  value={formData.variable_allowance}
                  onChange={(e) => handleCurrencyChange('variable_allowance', e.target.value)}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="transport_allowance">Tunjangan Transport (Rp)</Label>
                <Input
                  id="transport_allowance"
                  type="text"
                  value={formData.transport_allowance}
                  onChange={(e) => handleCurrencyChange('transport_allowance', e.target.value)}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="meal_allowance">Tunjangan Makan (Rp)</Label>
                <Input
                  id="meal_allowance"
                  type="text"
                  value={formData.meal_allowance}
                  onChange={(e) => handleCurrencyChange('meal_allowance', e.target.value)}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="housing_allowance">Tunjangan Rumah (Rp)</Label>
                <Input
                  id="housing_allowance"
                  type="text"
                  value={formData.housing_allowance}
                  onChange={(e) => handleCurrencyChange('housing_allowance', e.target.value)}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Potongan */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Potongan</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="loan_deduction">Cicilan Pinjaman (Rp)</Label>
                <Input
                  id="loan_deduction"
                  type="text"
                  value={formData.loan_deduction}
                  onChange={(e) => handleCurrencyChange('loan_deduction', e.target.value)}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="other_deduction">Potongan Lain (Rp)</Label>
                <Input
                  id="other_deduction"
                  type="text"
                  value={formData.other_deduction}
                  onChange={(e) => handleCurrencyChange('other_deduction', e.target.value)}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Tax & Benefits */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Tax & Benefits</h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="ptkp_status">Status PTKP</Label>
                <p className="text-xs text-gray-500 mb-1">Penghasilan Tidak Kena Pajak</p>
                <select
                  id="ptkp_status"
                  value={formData.ptkp_status}
                  onChange={(e) => setFormData({ ...formData, ptkp_status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                >
                  <option value="TK/0">TK/0 (Tidak Kawin, 0 tanggungan)</option>
                  <option value="TK/1">TK/1 (Tidak Kawin, 1 tanggungan)</option>
                  <option value="TK/2">TK/2 (Tidak Kawin, 2 tanggungan)</option>
                  <option value="TK/3">TK/3 (Tidak Kawin, 3 tanggungan)</option>
                  <option value="K/0">K/0 (Kawin, 0 tanggungan)</option>
                  <option value="K/1">K/1 (Kawin, 1 tanggungan)</option>
                  <option value="K/2">K/2 (Kawin, 2 tanggungan)</option>
                  <option value="K/3">K/3 (Kawin, 3 tanggungan)</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="is_taxable"
                  checked={formData.is_taxable}
                  onChange={(e) => setFormData({ ...formData, is_taxable: e.target.checked })}
                  className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                />
                <Label htmlFor="is_taxable" className="text-sm font-medium text-gray-700 cursor-pointer">
                  Subjek Pajak (Kena PPh 21)
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="bpjs_tk"
                  checked={formData.bpjs_tk_enrolled}
                  onChange={(e) => setFormData({ ...formData, bpjs_tk_enrolled: e.target.checked })}
                  className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                />
                <Label htmlFor="bpjs_tk" className="text-sm font-medium text-gray-700 cursor-pointer">
                  BPJS Ketenagakerjaan (JHT, JP, JKK, JKM)
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="bpjs_kes"
                  checked={formData.bpjs_kes_enrolled}
                  onChange={(e) => setFormData({ ...formData, bpjs_kes_enrolled: e.target.checked })}
                  className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                />
                <Label htmlFor="bpjs_kes" className="text-sm font-medium text-gray-700 cursor-pointer">
                  BPJS Kesehatan
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="tapera"
                  checked={formData.tapera_enrolled}
                  onChange={(e) => setFormData({ ...formData, tapera_enrolled: e.target.checked })}
                  className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                />
                <Label htmlFor="tapera" className="text-sm font-medium text-gray-700 cursor-pointer">
                  Tapera (Tabungan Perumahan Rakyat)
                </Label>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => router.push("/dashboard/hris/salary")}
            >
              Batal
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-pink-600 hover:bg-pink-700"
            >
              {saving ? (
                "Menyimpan..."
              ) : (
                <>
                  <CheckIcon className="w-4 h-4 mr-2" />
                  Simpan
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
