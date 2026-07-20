/**
 * EPIC-013 Fase A — aturan Google Review. Fungsi murni, tanpa jaringan/DB,
 * supaya seluruh pemetaan data Google bisa diuji sebelum kredensial turun.
 */

/** Google mengirim rating sebagai enum kata, bukan angka. */
export const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export interface GoogleReviewResource {
  /** accounts/{a}/locations/{l}/reviews/{r} */
  name?: string;
  reviewId?: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean };
  starRating?: string | number;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

export interface NormalizedReview {
  /** Id ulasan (segmen terakhir) — stabil walau akun Google diganti. */
  reviewId: string;
  reviewName: string;
  reviewerName: string;
  reviewerPhotoUrl: string | null;
  starRating: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  replyComment: string | null;
  replyUpdatedAt: Date | null;
}

/**
 * Ambil id ulasan dari resource name. Nama penuh memuat id akun, jadi hanya
 * segmen terakhir yang layak dijadikan kunci dedup lintas akun.
 */
export function extractReviewId(reviewName: string): string {
  const afterReviews = reviewName.split("/reviews/").pop() ?? "";
  const id = afterReviews.trim() || reviewName.trim();
  return id;
}

export function parseStarRating(value: string | number | undefined): number | null {
  if (typeof value === "number") {
    return value >= 1 && value <= 5 ? Math.round(value) : null;
  }
  if (typeof value === "string") {
    const mapped = STAR_RATING_MAP[value.toUpperCase()];
    if (mapped) return mapped;
    // Sebagian respons memakai angka dalam string.
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 5) return Math.round(numeric);
  }
  return null;
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Ubah resource Google jadi bentuk siap simpan. Mengembalikan null bila
 * ulasan tidak layak disimpan (tanpa identitas atau tanpa rating yang sah).
 */
export function normalizeReview(resource: GoogleReviewResource): NormalizedReview | null {
  const reviewName = resource.name?.trim() || resource.reviewId?.trim();
  if (!reviewName) return null;

  const starRating = parseStarRating(resource.starRating);
  if (!starRating) return null;

  const createdAt = toDate(resource.createTime);
  if (!createdAt) return null;

  const comment = resource.comment?.trim();
  const replyComment = resource.reviewReply?.comment?.trim();

  return {
    reviewId: extractReviewId(reviewName),
    reviewName,
    // Ulasan anonim tetap disimpan — hanya namanya yang disamarkan.
    reviewerName: resource.reviewer?.isAnonymous
      ? "Pengguna Google"
      : resource.reviewer?.displayName?.trim() || "Pengguna Google",
    reviewerPhotoUrl: resource.reviewer?.profilePhotoUrl?.trim() || null,
    starRating,
    comment: comment || null,
    createdAt,
    updatedAt: toDate(resource.updateTime),
    replyComment: replyComment || null,
    replyUpdatedAt: toDate(resource.reviewReply?.updateTime),
  };
}

/** Ulasan bintang rendah diperlakukan sebagai komplain. */
export function isComplaintRating(starRating: number, maxComplaintRating: number): boolean {
  return starRating <= maxComplaintRating;
}

export interface ReviewSlaState {
  waitingSeconds: number;
  breached: boolean;
  remainingSeconds: number;
}

/**
 * SLA waktu membalas — dihitung dari waktu ulasan terbit menurut Google,
 * bukan waktu kita menariknya (kalau sinkronisasi telat, SLA tidak ikut mundur).
 */
export function evaluateReviewSla(
  reviewCreatedAt: Date | string,
  slaMinutes: number,
  repliedAt: Date | null,
  now: Date = new Date()
): ReviewSlaState | null {
  const created =
    reviewCreatedAt instanceof Date ? reviewCreatedAt : new Date(reviewCreatedAt);
  if (Number.isNaN(created.getTime())) return null;

  const until = repliedAt ?? now;
  const waitingSeconds = Math.max(0, Math.floor((until.getTime() - created.getTime()) / 1000));
  const limitSeconds = Math.max(0, slaMinutes) * 60;

  return {
    waitingSeconds,
    breached: !repliedAt && waitingSeconds > limitSeconds,
    remainingSeconds: Math.max(0, limitSeconds - waitingSeconds),
  };
}

export const MAX_REPLY_LENGTH = 4000;

/** Validasi balasan sebelum dikirim ke Google. */
export function validateReply(comment: string): { valid: boolean; error?: string } {
  const trimmed = comment.trim();
  if (!trimmed) return { valid: false, error: "Balasan tidak boleh kosong" };
  if (trimmed.length > MAX_REPLY_LENGTH) {
    return { valid: false, error: `Balasan maksimal ${MAX_REPLY_LENGTH} karakter` };
  }
  return { valid: true };
}

export const RATING_LABELS: Record<number, string> = {
  1: "Sangat buruk",
  2: "Buruk",
  3: "Biasa",
  4: "Bagus",
  5: "Sangat bagus",
};
