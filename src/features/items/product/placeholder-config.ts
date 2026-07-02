export const PRODUCT_PLACEHOLDER_PAGES: Record<
  string,
  { title: string; description: string }
> = {
  // Inventory
  "inventory/transfer": {
    title: "Product Stock Transfer",
    description:
      "Halaman transfer stok produk jadi antar gudang, outlet, atau lokasi penyimpanan.",
  },
  // Purchasing
  "purchasing/vendor": {
    title: "Vendor",
    description: "Master vendor untuk pengadaan produk jadi dan bahan terkait produk.",
  },
  "purchasing/price-list": {
    title: "Price List",
    description: "Daftar harga vendor untuk produk dan komponen pengadaan produk jadi.",
  },
  "purchasing/pr": {
    title: "Purchase Request",
    description: "Permintaan pembelian untuk kebutuhan produk dan pengadaan terkait.",
  },
  "purchasing/po": {
    title: "Purchase Order",
    description: "Purchase order ke vendor untuk pengadaan produk.",
  },
  "purchasing/delivery": {
    title: "Track Shipment",
    description: "Pelacakan pengiriman purchase order produk dari vendor.",
  },
  "purchasing/receive": {
    title: "Receive",
    description: "Penerimaan barang produk dari vendor (goods receipt).",
  },
  "purchasing/returns": {
    title: "Return",
    description: "Retur produk ke vendor untuk item tidak sesuai atau rusak.",
  },
  "purchasing/invoice": {
    title: "Invoice",
    description: "Invoice dan pembayaran vendor untuk pengadaan produk.",
  },
  // Approval
  "approval/pr": {
    title: "Approval PR",
    description: "Persetujuan purchase request untuk modul produk.",
  },
  "approval/po": {
    title: "Approval PO",
    description: "Persetujuan purchase order untuk modul produk.",
  },
};

export function getProductPlaceholder(path: string) {
  return PRODUCT_PLACEHOLDER_PAGES[path] ?? null;
}
