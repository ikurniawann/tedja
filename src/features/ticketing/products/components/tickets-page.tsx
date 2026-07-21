"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TicketIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { CategoryAutocomplete } from "./category-autocomplete";
import { useCreateProduct, useProducts } from "../queries";

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export function TicketsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [basePrice, setBasePrice] = useState("");

  const productsQuery = useProducts(q);
  const products = productsQuery.data ?? [];

  const createMutation = useCreateProduct((result) => {
    setCreateOpen(false);
    setName("");
    setCategoryName("");
    setBasePrice("");
    router.push(`/dashboard/ticketing/tickets/${result.id}`);
  });

  const handleCreate = () => {
    if (!name.trim() || createMutation.isPending) return;
    createMutation.mutate({
      name: name.trim(),
      category_name: categoryName.trim() || null,
      base_price: Number(basePrice) || 0,
      status: "draft",
    });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Master Ticket</h1>
        <p className="mt-1 text-sm text-gray-500">
          Produk tiket theme park: varian Adult/Child ber-harga musiman,
          kalender per ticket, dan kebijakan operasional. Distribusi kanal
          diatur di Channel Manager.
        </p>
      </div>

      <PurchasingListSection
        icon={TicketIcon}
        title="Daftar Ticket"
        description="Ticket Draft belum bisa dijual — aktifkan setelah harga varian lengkap."
        toolbar={
          <div className="flex items-center gap-2">
            <Input
              placeholder="Cari nama / kode…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-48"
            />
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              Buat Ticket
            </Button>
          </div>
        }
      >
        {productsQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat ticket...</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Ticket</th>
                  <th className="px-4 py-3 text-left font-semibold">Kategori</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Base Price</th>
                  <th className="px-4 py-3 text-left font-semibold">Distribusi</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {products.map((product) => (
                  <TableRow key={product.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {product.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.thumbnail_url}
                            alt=""
                            className="h-10 w-10 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                            <TicketIcon className="h-5 w-5 text-gray-400" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-900">{product.name}</p>
                          <p className="font-mono text-xs text-gray-500">
                            {product.code}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {product.category_name || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={`border-0 font-normal ${
                          product.status === "active"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {product.status === "active" ? "Active" : "Draft"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {formatRp(product.base_price)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {product.distributed_channels.length === 0 ? (
                          <span className="text-xs text-gray-400">
                            belum didistribusi
                          </span>
                        ) : (
                          product.distributed_channels.map((channel) => (
                            <Badge
                              key={channel}
                              className="border-0 bg-blue-100 font-normal text-blue-700"
                            >
                              {channel === "walk-in" ? "POS" : "Website"}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          asChild
                        >
                          <Link href={`/dashboard/ticketing/tickets/${product.id}`}>
                            Kelola
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                ))}
                {products.length === 0 ? (
                  <TableRow>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                      Belum ada ticket — klik “Buat Ticket” untuk memulai.
                    </td>
                  </TableRow>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Ticket Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ticket_name">Nama Ticket *</Label>
              <Input
                id="ticket_name"
                placeholder="mis. Tiket Masuk Reguler"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <CategoryAutocomplete value={categoryName} onChange={setCategoryName} />
              <p className="text-xs text-gray-500">
                Ketik nama baru → kategori otomatis ditambahkan
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket_base_price">Base Price (Rp)</Label>
              <Input
                id="ticket_base_price"
                type="number"
                min={0}
                step={5000}
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-500">
              Ticket dibuat berstatus Draft dengan varian Adult & Child —
              lengkapi harga, kalender, dan kebijakan di halaman berikutnya.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Membuat…" : "Buat & Konfigurasi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
