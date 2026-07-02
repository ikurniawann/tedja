"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Loader2, Building2, User, FileText, Phone } from "lucide-react";
import {
  PaymentTerms,
  Currency,
  PAYMENT_TERMS_OPTIONS,
  CURRENCY_OPTIONS,
  KOTA_OPTIONS,
  formatNPWP,
} from "@/types/supplier";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { useSupplier } from "../queries";
import { useUpdateSupplier } from "../mutations";
import { toast } from "sonner";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function EditSupplierPage() {
  const router = useRouter();
  const params = useParams();
  const supplierId = params.id as string;

  const supplierQuery = useSupplier(supplierId);
  const updateMutation = useUpdateSupplier();
  const loading = supplierQuery.isLoading;
  const isSubmitting = updateMutation.isPending;

  const [formData, setFormData] = useState({
    nama_supplier: "",
    kode_supplier: "",
    kota: "",
    alamat: "",
    telepon: "",
    email: "",
    pic_name: "",
    pic_phone: "",
    pic_email: "",
    payment_terms: "TOP30" as PaymentTerms,
    currency: "IDR" as Currency,
    npwp: "",
    catatan: "",
  });

  useEffect(() => {
    const data = supplierQuery.data;
    if (!data) return;
    setFormData({
      nama_supplier: data.nama_supplier || "",
      kode_supplier: data.kode_supplier || "",
      kota: data.kota || "",
      alamat: data.alamat || "",
      telepon: data.telepon || "",
      email: data.email || "",
      pic_name: data.pic_name || "",
      pic_phone: data.pic_phone || "",
      pic_email: data.pic_email || "",
      payment_terms: (data.payment_terms as PaymentTerms) || "TOP30",
      currency: (data.currency as Currency) || "IDR",
      npwp: data.npwp || "",
      catatan: data.catatan || "",
    });
  }, [supplierQuery.data]);

  useEffect(() => {
    if (supplierQuery.isError) {
      toast.error("Failed to load supplier data.");
    }
  }, [supplierQuery.isError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nama_supplier || !formData.kota) {
      toast.error("Supplier name and city are required.");
      return;
    }

    try {
      await updateMutation.mutateAsync({ id: supplierId, payload: formData });
      toast.success("Supplier updated successfully.");
      router.push("/dashboard/purchasing/suppliers");
    } catch (error: unknown) {
      console.error("Error updating supplier:", error);
      toast.error(getErrorMessage(error, "Failed to update supplier."));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-pink-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref="/dashboard/purchasing/suppliers"
        title="Edit Supplier"
        description="Update supplier record details."
      />

      <form id="edit-supplier-form" onSubmit={handleSubmit}>
        <div className="space-y-6">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" />
                Supplier Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="kode" className="text-xs">Supplier Code</Label>
                  <Input
                    id="kode"
                    value={formData.kode_supplier}
                    disabled
                    className="h-9 bg-gray-50 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kota" className="text-xs">
                    City <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={KOTA_OPTIONS.map((k) => ({ value: k, label: k }))}
                    value={formData.kota}
                    onChange={(v) => setFormData({ ...formData, kota: v })}
                    placeholder="Select city..."
                    searchPlaceholder="Search..."
                    emptyMessage="City not found"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nama" className="text-xs">
                  Supplier Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="nama"
                  value={formData.nama_supplier}
                  onChange={(e) => setFormData({ ...formData, nama_supplier: e.target.value })}
                  required
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="alamat" className="text-xs">Full Address</Label>
                <Textarea
                  id="alamat"
                  value={formData.alamat}
                  onChange={(e) => setFormData({ ...formData, alamat: e.target.value })}
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="h-4 w-4" />
                Supplier Contact
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="telepon" className="text-xs">Phone</Label>
                  <Input
                    id="telepon"
                    value={formData.telepon}
                    onChange={(e) => setFormData({ ...formData, telepon: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Contact Person
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pic_name" className="text-xs">Contact Name</Label>
                  <Input
                    id="pic_name"
                    value={formData.pic_name}
                    onChange={(e) => setFormData({ ...formData, pic_name: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pic_phone" className="text-xs">Contact Phone</Label>
                  <Input
                    id="pic_phone"
                    value={formData.pic_phone}
                    onChange={(e) => setFormData({ ...formData, pic_phone: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pic_email" className="text-xs">Contact Email</Label>
                  <Input
                    id="pic_email"
                    type="email"
                    value={formData.pic_email}
                    onChange={(e) => setFormData({ ...formData, pic_email: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Payment Terms & Administration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="payment_terms" className="text-xs">
                    Payment Terms <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={PAYMENT_TERMS_OPTIONS.map((pt) => ({ value: pt, label: pt }))}
                    value={formData.payment_terms}
                    onChange={(v) => setFormData({ ...formData, payment_terms: v as PaymentTerms })}
                    placeholder="Select terms..."
                    searchPlaceholder="Search..."
                    emptyMessage="Not found"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="currency" className="text-xs">
                    Currency <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
                    value={formData.currency}
                    onChange={(v) => setFormData({ ...formData, currency: v as Currency })}
                    placeholder="Select currency..."
                    searchPlaceholder="Search..."
                    emptyMessage="Not found"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="npwp" className="text-xs">Tax ID (NPWP)</Label>
                <Input
                  id="npwp"
                  value={formData.npwp}
                  onChange={(e) => setFormData({ ...formData, npwp: formatNPWP(e.target.value) })}
                  placeholder="XX.XXX.XXX.X-XXX.XXX"
                  maxLength={20}
                  className="h-9 font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="catatan" className="text-xs">Additional Notes</Label>
                <Textarea
                  id="catatan"
                  value={formData.catatan}
                  onChange={(e) => setFormData({ ...formData, catatan: e.target.value })}
                  rows={3}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <PurchasingFormFooter
          onCancel={() => router.back()}
          submitLabel="Save Changes"
          loading={isSubmitting}
          formId="edit-supplier-form"
        />
      </form>
    </div>
  );
}
