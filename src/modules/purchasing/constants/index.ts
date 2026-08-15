// ============================================================
// Purchasing Module Constants
// ============================================================

// --- Role-based access control ---
export const PURCHASING_ROLES = {
  admin: "purchasing_admin",
  manager: "purchasing_manager",
  staff: "purchasing_staff",
  warehouse: "warehouse_staff",
  finance: "finance_staff",
  direksi: "direksi",
  superAdmin: "super_admin",
} as const;

export type PurchasingRole = typeof PURCHASING_ROLES[keyof typeof PURCHASING_ROLES];

export const ALLOWED_PURCHASING_ROLES: PurchasingRole[] = [
  "purchasing_admin",
  "purchasing_manager",
  "purchasing_staff",
  "warehouse_staff",
  "finance_staff",
  "direksi",
  "super_admin",
];

export const ROLE_LABELS: Record<PurchasingRole | string, string> = {
  purchasing_admin: "Admin Purchasing",
  purchasing_manager: "Manager Purchasing",
  purchasing_staff: "Staff Purchasing",
  warehouse_staff: "Staff Warehouse",
  finance_staff: "Finance Staff",
  direksi: "Direksi",
  super_admin: "Super Admin",
};

// ============================================================
// Vendor / Supplier Constants
// ============================================================

export const VENDOR_STATUS = {
  active: "active",
  inactive: "inactive",
  blocked: "blocked",
  probation: "probation",
} as const;
export type VendorStatus = typeof VENDOR_STATUS[keyof typeof VENDOR_STATUS];

export const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = {
  active: "Aktif",
  inactive: "Tidak Aktif",
  blocked: "Diblokir",
  probation: "Masa Percobaan",
};

export const VENDOR_TYPE = {
  distributor: "distributor",
  wholesaler: "wholesaler",
  retailer: "retailer",
  manufacturer: "manufacturer",
  importer: "importer",
  agent: "agent",
} as const;
export type VendorType = typeof VENDOR_TYPE[keyof typeof VENDOR_TYPE];

// ============================================================
// Raw Material Constants
// ============================================================

export const MATERIAL_UNIT = {
  kg: "kg",
  gram: "g",
  liter: "L",
  ml: "mL",
  piece: "pcs",
  roll: "roll",
  sheet: "lembar",
  meter: "m",
  pack: "pack",
  drum: "drum",
  sack: "zak",
} as const;
export type MaterialUnit = typeof MATERIAL_UNIT[keyof typeof MATERIAL_UNIT];

export const MATERIAL_STATUS = {
  active: "active",
  discontinued: "discontinued",
  out_of_stock: "out_of_stock",
  restricted: "restricted",
} as const;
export type MaterialStatus = typeof MATERIAL_STATUS[keyof typeof MATERIAL_STATUS];

export const STOCK_WARNING_THRESHOLD = {
  low: "low",      // < minimum_stok → red alert
  medium: "medium", // between min and reorder
  adequate: "adequate",
  over: "over",     // > maximum_stok
} as const;
export type StockWarningThreshold = typeof STOCK_WARNING_THRESHOLD[keyof typeof STOCK_WARNING_THRESHOLD];

// ============================================================
// Purchase Request (PR) Status
// ============================================================

export const PR_STATUS = {
  draft: "draft",
  pending_head: "pending_head",
  pending_finance: "pending_finance",
  pending_direksi: "pending_direksi",
  approved: "approved",
  converted: "converted",
  rejected: "rejected",
  cancelled: "cancelled",
} as const;
export type PRStatus = typeof PR_STATUS[keyof typeof PR_STATUS];

export const PR_STATUS_LABELS: Record<PRStatus, string> = {
  draft: "Draf",
  pending_head: "Menunggu Kepala Departemen",
  pending_finance: "Menunggu Finance",
  pending_direksi: "Menunggu Direktur",
  approved: "Disetujui",
  converted: "Purchase Order Dibuat",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

export const PR_STATUS_COLORS: Record<PRStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_head: "bg-yellow-100 text-yellow-800",
  pending_finance: "bg-orange-100 text-orange-800",
  pending_direksi: "bg-purple-100 text-purple-800",
  approved: "bg-green-100 text-green-800",
  converted: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-500",
};

export const PR_PRIORITY = {
  low: "low",
  normal: "normal",
  urgent: "urgent",
  critical: "critical",
} as const;
export type PRPriority = typeof PR_PRIORITY[keyof typeof PR_PRIORITY];

export const PR_PRIORITY_LABELS: Record<PRPriority, string> = {
  low: "Rendah",
  normal: "Normal",
  urgent: "Mendesak",
  critical: "Kritis",
};

export const PR_PRIORITY_COLORS: Record<PRPriority, string> = {
  low: "bg-gray-100 text-gray-600",
  normal: "bg-blue-100 text-blue-700",
  urgent: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

// ============================================================
// Purchase Order (PO) Status
// ============================================================

export const PO_STATUS = {
  draft: "draft",
  sent: "sent",
  partial: "partial",
  received: "received",
  closed: "closed",
  cancelled: "cancelled",
} as const;
export type POStatus = typeof PO_STATUS[keyof typeof PO_STATUS];

export const PO_STATUS_LABELS: Record<POStatus, string> = {
  draft: "Draft",
  sent: "Terkirim",
  partial: "Partial / Parsial",
  received: "Diterima Semua",
  closed: "Selesai",
  cancelled: "Dibatalkan",
};

export const PO_STATUS_COLORS: Record<POStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  partial: "bg-orange-100 text-orange-700",
  received: "bg-green-100 text-green-700",
  closed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

// ============================================================
// QC (Quality Control) Status
// ============================================================

export const QC_STATUS = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  conditional: "conditional",
} as const;
export type QCStatus = typeof QC_STATUS[keyof typeof QC_STATUS];

export const QC_STATUS_LABELS: Record<QCStatus, string> = {
  pending: "Menunggu QC",
  approved: "Disetujui",
  rejected: "Ditolak",
  conditional: "Bersyarat",
};

export const QC_STATUS_COLORS: Record<QCStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  conditional: "bg-orange-100 text-orange-800",
};

// ============================================================
// GRN / Receiving Status
// ============================================================

export const GRN_STATUS = {
  pending: "pending",
  partial: "partial",
  completed: "completed",
  cancelled: "cancelled",
} as const;
export type GRNStatus = typeof GRN_STATUS[keyof typeof GRN_STATUS];

export const GRN_STATUS_LABELS: Record<GRNStatus, string> = {
  pending: "Menunggu",
  partial: "Partial",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

// ============================================================
// Inventory Adjustment Reason
// ============================================================

export const ADJUSTMENT_REASONS = {
  stock_opname: "stock_opname",
  damaged: "damaged",
  expired: "expired",
  theft: "theft",
  correction: "correction",
  return_to_supplier: "return_to_supplier",
  production_use: "production_use",
  other: "other",
} as const;
export type AdjustmentReason = typeof ADJUSTMENT_REASONS[keyof typeof ADJUSTMENT_REASONS];

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  stock_opname: "Stok Opname",
  damaged: "Barang Rusak",
  expired: "Barang Kadaluarsa",
  theft: "Pencurian / Kehilangan",
  correction: "Koreksi Pencatatan",
  return_to_supplier: "Retur ke Supplier",
  production_use: "Pemakaian Produksi",
  other: "Lainnya",
};

// ============================================================
// COGS / Additional Cost Types
// ============================================================

export const COST_TYPES = {
  freight: "freight",
  handling: "handling",
  insurance: "insurance",
  customs_duty: "customs_duty",
  storage: "storage",
  loading_unloading: "loading_unloading",
  transportation: "transportation",
  packaging: "packaging",
  other: "other",
} as const;
export type CostType = typeof COST_TYPES[keyof typeof COST_TYPES];

export const COST_TYPE_LABELS: Record<CostType, string> = {
  freight: "Freight / Ongkos Kirim",
  handling: "Handling Fee",
  insurance: "Asuransi",
  customs_duty: "Bea Masuk / PPN Import",
  storage: "Penyimpanan",
  loading_unloading: "Bongkar / Muat",
  transportation: "Transportasi Lokal",
  packaging: "Pengemasan",
  other: "Lainnya",
};

export const COST_ALLOCATION_METHOD = {
  by_value: "by_value",
  by_weight: "by_weight",
  by_quantity: "by_quantity",
  equally: "equally",
} as const;
export type CostAllocationMethod = typeof COST_ALLOCATION_METHOD[keyof typeof COST_ALLOCATION_METHOD];

export const COST_ALLOCATION_LABELS: Record<CostAllocationMethod, string> = {
  by_value: "Proporsional berdasarkan Nilai",
  by_weight: "Proporsional berdasarkan Berat",
  by_quantity: "Proporsional berdasarkan Jumlah",
  equally: "Sama Rata per Item",
};

// ============================================================
// Report Types
// ============================================================

export const REPORT_FORMAT = {
  view: "view",
  csv: "csv",
  excel: "excel",
} as const;
export type ReportFormat = typeof REPORT_FORMAT[keyof typeof REPORT_FORMAT];

export const REPORT_TYPES = {
  inventory_valuation: "inventory_valuation",
  po_summary: "po_summary",
  supplier_performance: "supplier_performance",
  material_movement: "material_movement",
  hpp_breakdown: "hpp_breakdown",
} as const;
export type ReportType = typeof REPORT_TYPES[keyof typeof REPORT_TYPES];

// ============================================================
// Pagination defaults
// ============================================================

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
