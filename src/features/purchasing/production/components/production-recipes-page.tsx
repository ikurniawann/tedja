"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon,
  BeakerIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useRecipeProducts } from "../queries";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function displayName(value?: string | null) {
  return (value || "-").replace(/\s+\d{8,}$/g, "").trim();
}

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(toNumber(value));
}

export function ProductionRecipesPage() {
  const [search, setSearch] = useState("");

  const productsQuery = useRecipeProducts();
  const products = productsQuery.data ?? [];
  const loading = productsQuery.isLoading;
  const error = productsQuery.isError
    ? productsQuery.error instanceof Error
      ? productsQuery.error.message
      : "Gagal memuat recipe produk"
    : "";

  const loadProducts = () => productsQuery.refetch();

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return products;
    return products.filter((product) =>
      [product.nama, product.kode, product.kategori]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [products, search]);

  const withBom = products.filter((product) => toNumber(product.total_bahan_baku) > 0).length;
  const withoutBom = products.length - withBom;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950">Recipe / BOM</h1>
          <p className="text-sm text-gray-500">
            Atur komposisi raw material dan WIP untuk produk yang akan diproduksi.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={PRODUCT_ROUTES.productsInsert}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:bg-pink-50"
          >
            <PlusIcon className="h-4 w-4" />
            Produk Baru
          </Link>
          <button
            type="button"
            onClick={loadProducts}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total Produk</p>
          <p className="mt-2 text-2xl font-semibold text-gray-950">{products.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Sudah Ada BOM</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-800">{withBom}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Belum Ada BOM</p>
          <p className="mt-2 text-2xl font-semibold text-amber-800">{withoutBom}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
              <BeakerIcon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-gray-950">Daftar Recipe Produk</h2>
              <p className="text-xs text-gray-500">Pilih produk untuk mengatur raw material, WIP, waste, dan estimasi HPP.</p>
            </div>
          </div>
          <label className="relative w-full sm:w-80">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari produk..."
              className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
            />
          </label>
        </div>

        {error && (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Produk</th>
                <th className="px-4 py-3 text-left font-semibold">Status BOM</th>
                <th className="px-4 py-3 text-right font-semibold">Komponen</th>
                <th className="px-4 py-3 text-right font-semibold">HPP Estimasi</th>
                <th className="px-4 py-3 text-right font-semibold">Harga Jual</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Memuat recipe produk...
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Produk tidak ditemukan.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
                  const componentCount = toNumber(product.total_bahan_baku);
                  const hasBom = componentCount > 0;
                  return (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-950">{displayName(product.nama)}</p>
                        <p className="text-xs text-gray-500">{product.kategori || "Tanpa kategori"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            hasBom
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                        >
                          {hasBom ? "Siap Produksi" : "Belum Lengkap"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{componentCount}</td>
                      <td className="px-4 py-3 text-right font-semibold text-pink-700">
                        {formatCurrency(product.hpp_estimasi)}
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(product.harga_jual)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`${PRODUCT_ROUTES.productsBom(product.id)}?from=production`}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-pink-200 px-3 text-xs font-semibold text-pink-700 hover:bg-pink-50"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                          Edit Recipe
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
