'use client';

// EPIC-039 Fase D — storefront publik: katalog → varian → keranjang →
// checkout (area + ongkir live) → redirect invoice Xendit.
// Keranjang disimpan di localStorage per slug.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from 'lucide-react';

type CatalogSku = {
  id: string;
  sku: string;
  name: string;
  price: number;
  stock: number;
};

type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  longDescription: string | null;
  imageUrl: string | null;
  images: string[];
  price: number;
  stock: number;
  skus: CatalogSku[];
};

type Storefront = { slug: string; name: string; description: string | null };

type CartLine = {
  key: string;
  productId: string;
  skuId: string | null;
  name: string;
  variantName: string | null;
  price: number;
  quantity: number;
};

type AreaSuggestion = { id: string; label: string; postalCode: string | null };

type RateQuote = {
  courierCode: string;
  courierName: string;
  serviceCode: string;
  serviceName: string;
  etd: string | null;
  total_price: number;
};

function formatRp(value: number): string {
  return `Rp ${Math.round(value).toLocaleString('id-ID')}`;
}

async function parseJson<T>(response: Response, fallback: string): Promise<T> {
  const json = await response.json();
  if (!response.ok || json.success === false) {
    throw new Error(json.error || fallback);
  }
  return json as T;
}

export function ShopStorefrontPage({ slug }: { slug: string }) {
  const cartStorageKey = `shop-cart-${slug}`;

  const [storefront, setStorefront] = useState<Storefront | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [detailProduct, setDetailProduct] = useState<CatalogProduct | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Checkout state
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [address, setAddress] = useState('');
  const [areaQuery, setAreaQuery] = useState('');
  const [areaSuggestions, setAreaSuggestions] = useState<AreaSuggestion[]>([]);
  const [selectedArea, setSelectedArea] = useState<AreaSuggestion | null>(null);
  const [rates, setRates] = useState<RateQuote[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [selectedRate, setSelectedRate] = useState<RateQuote | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // ── Load katalog ──
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`/api/public/shop/${slug}/catalog`, { cache: 'no-store' });
        const json = await parseJson<{
          data: { storefront: Storefront; products: CatalogProduct[] };
        }>(response, 'Gagal memuat katalog');
        setStorefront(json.data.storefront);
        setProducts(json.data.products);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Gagal memuat katalog');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  // ── Cart persist ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cartStorageKey);
      if (raw) setCart(JSON.parse(raw) as CartLine[]);
    } catch {
      /* keranjang korup → mulai kosong */
    }
  }, [cartStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    } catch {
      /* storage penuh — abaikan */
    }
  }, [cart, cartStorageKey]);

  const cartCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.price * line.quantity, 0),
    [cart]
  );

  const addToCart = useCallback((product: CatalogProduct, sku: CatalogSku | null) => {
    const key = sku ? `${product.id}::${sku.id}` : product.id;
    setCart((prev) => {
      const existing = prev.find((line) => line.key === key);
      if (existing) {
        return prev.map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...prev,
        {
          key,
          productId: product.id,
          skuId: sku?.id ?? null,
          name: product.name,
          variantName: sku?.name ?? null,
          price: sku ? sku.price : product.price,
          quantity: 1,
        },
      ];
    });
    setDetailProduct(null);
    setCartOpen(true);
  }, []);

  const updateQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + delta } : line
        )
        .filter((line) => line.quantity > 0)
    );
    setSelectedRate(null);
    setRates([]);
  };

  const removeLine = (key: string) => {
    setCart((prev) => prev.filter((line) => line.key !== key));
    setSelectedRate(null);
    setRates([]);
  };

  // ── Area autocomplete ──
  useEffect(() => {
    if (selectedArea || areaQuery.trim().length < 3) {
      setAreaSuggestions([]);
      return;
    }
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/public/shop/${slug}/shipping/areas?q=${encodeURIComponent(areaQuery.trim())}`,
          { cache: 'no-store' }
        );
        const json = await parseJson<{ data: AreaSuggestion[] }>(response, 'Gagal mencari area');
        setAreaSuggestions(json.data ?? []);
      } catch {
        setAreaSuggestions([]);
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [areaQuery, selectedArea, slug]);

  // ── Ongkir setelah area dipilih ──
  const fetchRates = useCallback(async (area: AreaSuggestion) => {
    setRatesLoading(true);
    setRates([]);
    setSelectedRate(null);
    setCheckoutError(null);
    try {
      const response = await fetch(`/api/public/shop/${slug}/shipping/rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination_id: area.id,
          destination_postal_code: area.postalCode,
          items: cart.map((line) => ({ product_id: line.productId, quantity: line.quantity })),
        }),
      });
      const json = await parseJson<{ data: RateQuote[] }>(response, 'Gagal cek ongkir');
      setRates(json.data ?? []);
      if ((json.data ?? []).length === 0) {
        setCheckoutError('Tidak ada layanan kurir ke area ini');
      }
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Gagal cek ongkir');
    } finally {
      setRatesLoading(false);
    }
  }, [cart, slug]);

  const submitCheckout = async () => {
    setCheckoutError(null);
    if (!custName.trim() || custName.trim().length < 2) {
      setCheckoutError('Nama penerima wajib diisi');
      return;
    }
    if (custPhone.replace(/\D/g, '').length < 8) {
      setCheckoutError('Nomor WA tidak valid');
      return;
    }
    if (!selectedArea) {
      setCheckoutError('Pilih area tujuan dulu');
      return;
    }
    if (address.trim().length < 10) {
      setCheckoutError('Alamat lengkap minimal 10 karakter');
      return;
    }
    if (!selectedRate) {
      setCheckoutError('Pilih kurir dulu');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/public/shop/${slug}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((line) => ({
            product_id: line.productId,
            sku_id: line.skuId,
            quantity: line.quantity,
          })),
          customer: {
            name: custName.trim(),
            phone: custPhone.trim(),
            email: custEmail.trim() || null,
          },
          destination: {
            area_id: selectedArea.id,
            label: selectedArea.label,
            postal_code: selectedArea.postalCode,
            address: address.trim(),
          },
          courier: {
            code: selectedRate.courierCode,
            service_code: selectedRate.serviceCode,
          },
          notes: notes.trim() || null,
        }),
      });
      const json = await parseJson<{ data: { invoice_url: string } }>(
        response,
        'Checkout gagal'
      );
      setCart([]);
      localStorage.removeItem(cartStorageKey);
      window.location.href = json.data.invoice_url;
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Checkout gagal');
      setSubmitting(false);
    }
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
      </div>
    );
  }
  if (loadError || !storefront) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-gray-50 px-6 text-center">
        <Package className="h-10 w-10 text-gray-300" />
        <p className="text-sm text-gray-500">{loadError || 'Toko tidak ditemukan'}</p>
      </div>
    );
  }

  const grandTotal = cartSubtotal + (selectedRate?.total_price ?? 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{storefront.name}</h1>
            {storefront.description ? (
              <p className="text-xs text-gray-400">{storefront.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="relative rounded-full bg-pink-600 p-2.5 text-white shadow hover:bg-pink-700"
            aria-label="Keranjang"
          >
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-900 px-1 text-xs font-bold">
                {cartCount}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      {/* Katalog */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24 text-gray-400">
            <ShoppingBag className="h-10 w-10 opacity-40" />
            <p className="text-sm">Belum ada produk di toko ini</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => setDetailProduct(product)}
                disabled={product.stock <= 0}
                className="group flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-sm transition hover:shadow-md disabled:opacity-60"
              >
                <div className="flex aspect-square items-center justify-center bg-gray-100">
                  {product.imageUrl || product.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.images[0] || product.imageUrl || ''}
                      alt={product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Package className="h-10 w-10 text-gray-300" />
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <p className="line-clamp-2 text-sm font-medium text-gray-900">{product.name}</p>
                  <p className="text-sm font-semibold text-pink-600">{formatRp(product.price)}</p>
                  <p className="text-xs text-gray-400">
                    {product.stock > 0 ? `Stok ${product.stock}` : 'Stok habis'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Detail produk + pilih varian */}
      {detailProduct ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">{detailProduct.name}</h2>
              <button type="button" onClick={() => setDetailProduct(null)} aria-label="Tutup">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            {detailProduct.longDescription || detailProduct.description ? (
              <p className="mb-4 whitespace-pre-line text-sm text-gray-600">
                {detailProduct.longDescription || detailProduct.description}
              </p>
            ) : null}
            {detailProduct.skus.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Pilih varian
                </p>
                {detailProduct.skus.map((sku) => (
                  <button
                    key={sku.id}
                    type="button"
                    disabled={sku.stock <= 0}
                    onClick={() => addToCart(detailProduct, sku)}
                    className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left transition hover:border-pink-300 hover:bg-pink-50/40 disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-gray-900">{sku.name}</span>
                    <span className="flex items-center gap-3 text-sm">
                      <span className={sku.stock > 0 ? 'text-gray-400' : 'text-red-500'}>
                        {sku.stock > 0 ? `Stok ${sku.stock}` : 'Habis'}
                      </span>
                      <span className="font-semibold text-pink-600">{formatRp(sku.price)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => addToCart(detailProduct, null)}
                className="w-full rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-700"
              >
                Tambah ke Keranjang — {formatRp(detailProduct.price)}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Keranjang drawer */}
      {cartOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
          <div className="flex h-full w-full max-w-md flex-col bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">Keranjang</h2>
              <button type="button" onClick={() => setCartOpen(false)} aria-label="Tutup">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {cart.length === 0 ? (
                <p className="py-16 text-center text-sm text-gray-400">Keranjang kosong</p>
              ) : (
                cart.map((line) => (
                  <div key={line.key} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{line.name}</p>
                      {line.variantName ? (
                        <p className="text-xs text-gray-400">{line.variantName}</p>
                      ) : null}
                      <p className="text-sm font-semibold text-pink-600">{formatRp(line.price)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateQty(line.key, -1)}
                        className="rounded-full border border-gray-200 p-1"
                        aria-label="Kurangi"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQty(line.key, 1)}
                        className="rounded-full border border-gray-200 p-1"
                        aria-label="Tambah"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        aria-label="Hapus"
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {cart.length > 0 ? (
              <div className="border-t border-gray-100 px-5 py-4">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-semibold text-gray-900">{formatRp(cartSubtotal)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCartOpen(false);
                    setCheckoutOpen(true);
                  }}
                  className="w-full rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-700"
                >
                  Lanjut ke Pengiriman
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Checkout */}
      {checkoutOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
          <div className="flex h-full w-full max-w-md flex-col bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">Pengiriman & Pembayaran</h2>
              <button type="button" onClick={() => setCheckoutOpen(false)} aria-label="Tutup">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="space-y-3">
                <input
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="Nama penerima"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-pink-400"
                />
                <input
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="No. WhatsApp (utk konfirmasi & member)"
                  inputMode="tel"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-pink-400"
                />
                <input
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                  placeholder="Email (opsional)"
                  inputMode="email"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-pink-400"
                />
              </div>

              <div className="relative">
                <input
                  value={selectedArea ? selectedArea.label : areaQuery}
                  onChange={(e) => {
                    setSelectedArea(null);
                    setRates([]);
                    setSelectedRate(null);
                    setAreaQuery(e.target.value);
                  }}
                  placeholder="Cari kecamatan/kota tujuan..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-pink-400"
                />
                {!selectedArea && areaSuggestions.length > 0 ? (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                    {areaSuggestions.map((area) => (
                      <button
                        key={area.id}
                        type="button"
                        onClick={() => {
                          setSelectedArea(area);
                          setAreaSuggestions([]);
                          fetchRates(area);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-pink-50"
                      >
                        {area.label}
                        {area.postalCode ? ` (${area.postalCode})` : ''}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Alamat lengkap (jalan, nomor, RT/RW, patokan)"
                rows={3}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-pink-400"
              />

              {/* Pilihan kurir */}
              {ratesLoading ? (
                <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Menghitung ongkir...
                </div>
              ) : rates.length > 0 ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    <Truck className="h-3.5 w-3.5" /> Pilih kurir
                  </p>
                  {rates.map((rate, index) => {
                    const active =
                      selectedRate?.courierCode === rate.courierCode &&
                      selectedRate?.serviceCode === rate.serviceCode;
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setSelectedRate(rate)}
                        className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition ${
                          active
                            ? 'border-pink-500 bg-pink-50'
                            : 'border-gray-200 hover:border-pink-300'
                        }`}
                      >
                        <span>
                          <span className="font-medium text-gray-900">{rate.courierName}</span>{' '}
                          <span className="text-gray-500">{rate.serviceName}</span>
                          {rate.etd ? (
                            <span className="block text-xs text-gray-400">{rate.etd}</span>
                          ) : null}
                        </span>
                        <span className="font-semibold text-gray-900">
                          {formatRp(rate.total_price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan (opsional)"
                rows={2}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-pink-400"
              />

              {checkoutError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{checkoutError}</p>
              ) : null}
            </div>

            <div className="border-t border-gray-100 px-5 py-4">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="text-gray-900">{formatRp(cartSubtotal)}</span>
              </div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-gray-500">Ongkir</span>
                <span className="text-gray-900">
                  {selectedRate ? formatRp(selectedRate.total_price) : '—'}
                </span>
              </div>
              <div className="mb-3 flex items-center justify-between text-base font-semibold">
                <span>Total</span>
                <span className="text-pink-600">{formatRp(grandTotal)}</span>
              </div>
              <button
                type="button"
                onClick={submitCheckout}
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-700 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Bayar Sekarang
              </button>
              <p className="mt-2 text-center text-xs text-gray-400">
                Pembayaran aman via Xendit (QRIS, VA, e-wallet, kartu)
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
