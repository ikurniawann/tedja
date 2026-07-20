import { describe, expect, it } from "vitest";
import {
  evaluateReviewSla,
  extractReviewId,
  isComplaintRating,
  normalizeReview,
  parseStarRating,
  validateReply,
} from "@/lib/crm/google-reviews";

describe("parseStarRating — Google mengirim enum kata", () => {
  it("enum kata dipetakan ke angka", () => {
    expect(parseStarRating("ONE")).toBe(1);
    expect(parseStarRating("FIVE")).toBe(5);
    expect(parseStarRating("three")).toBe(3);
  });

  it("angka & angka dalam string tetap diterima", () => {
    expect(parseStarRating(4)).toBe(4);
    expect(parseStarRating("2")).toBe(2);
  });

  it("nilai tak dikenal / di luar 1-5 → null", () => {
    expect(parseStarRating("STAR_RATING_UNSPECIFIED")).toBeNull();
    expect(parseStarRating(0)).toBeNull();
    expect(parseStarRating(9)).toBeNull();
    expect(parseStarRating(undefined)).toBeNull();
  });
});

describe("normalizeReview", () => {
  const base = {
    name: "accounts/1/locations/2/reviews/abc",
    reviewer: { displayName: "Budi", profilePhotoUrl: "https://x/y.jpg" },
    starRating: "FOUR",
    comment: "  Tempatnya seru  ",
    createTime: "2026-07-19T10:00:00Z",
  };

  it("resource lengkap dipetakan benar", () => {
    const result = normalizeReview(base);

    expect(result?.reviewName).toBe("accounts/1/locations/2/reviews/abc");
    expect(result?.reviewerName).toBe("Budi");
    expect(result?.starRating).toBe(4);
    expect(result?.comment).toBe("Tempatnya seru");
    expect(result?.createdAt).toEqual(new Date("2026-07-19T10:00:00Z"));
    expect(result?.replyComment).toBeNull();
  });

  it("ulasan anonim tetap disimpan dengan nama disamarkan", () => {
    const result = normalizeReview({
      ...base,
      reviewer: { isAnonymous: true, displayName: "Nama Asli" },
    });

    expect(result?.reviewerName).toBe("Pengguna Google");
  });

  it("ulasan tanpa teks (rating saja) tetap sah", () => {
    const result = normalizeReview({ ...base, comment: "   " });

    expect(result).not.toBeNull();
    expect(result?.comment).toBeNull();
  });

  it("balasan existing ikut terbaca", () => {
    const result = normalizeReview({
      ...base,
      reviewReply: { comment: "Terima kasih!", updateTime: "2026-07-19T12:00:00Z" },
    });

    expect(result?.replyComment).toBe("Terima kasih!");
    expect(result?.replyUpdatedAt).toEqual(new Date("2026-07-19T12:00:00Z"));
  });

  it("tanpa nama resource / rating tak sah / tanpa waktu → null", () => {
    expect(normalizeReview({ ...base, name: undefined, reviewId: undefined })).toBeNull();
    expect(normalizeReview({ ...base, starRating: "STAR_RATING_UNSPECIFIED" })).toBeNull();
    expect(normalizeReview({ ...base, createTime: "bukan-tanggal" })).toBeNull();
  });
});

describe("isComplaintRating", () => {
  it("bintang <= ambang dianggap komplain", () => {
    expect(isComplaintRating(1, 3)).toBe(true);
    expect(isComplaintRating(3, 3)).toBe(true);
    expect(isComplaintRating(4, 3)).toBe(false);
    expect(isComplaintRating(5, 3)).toBe(false);
  });
});

describe("evaluateReviewSla", () => {
  const created = "2026-07-19T10:00:00Z";
  const now = new Date("2026-07-19T11:00:00Z"); // 60 menit kemudian

  it("belum dibalas & masih dalam batas → tidak melanggar", () => {
    const result = evaluateReviewSla(created, 120, null, now);

    expect(result?.waitingSeconds).toBe(3600);
    expect(result?.breached).toBe(false);
    expect(result?.remainingSeconds).toBe(3600);
  });

  it("belum dibalas & lewat batas → melanggar", () => {
    const result = evaluateReviewSla(created, 30, null, now);

    expect(result?.breached).toBe(true);
    expect(result?.remainingSeconds).toBe(0);
  });

  it("sudah dibalas tidak pernah melanggar, durasi dihitung sampai waktu balas", () => {
    const replied = new Date("2026-07-19T10:15:00Z");
    const result = evaluateReviewSla(created, 5, replied, now);

    expect(result?.breached).toBe(false);
    expect(result?.waitingSeconds).toBe(900);
  });

  it("SLA dihitung dari waktu terbit Google, bukan waktu sinkronisasi", () => {
    // Ulasan lama baru tertarik sekarang — harus langsung terlihat melanggar.
    const lama = "2026-07-01T10:00:00Z";
    expect(evaluateReviewSla(lama, 1440, null, now)?.breached).toBe(true);
  });

  it("tanggal tidak valid → null", () => {
    expect(evaluateReviewSla("ngawur", 60, null, now)).toBeNull();
  });
});

describe("validateReply", () => {
  it("teks wajar diterima", () => {
    expect(validateReply("Terima kasih atas ulasannya!").valid).toBe(true);
  });

  it("kosong / hanya spasi ditolak", () => {
    expect(validateReply("").valid).toBe(false);
    expect(validateReply("    ").valid).toBe(false);
  });

  it("melebihi 4000 karakter ditolak", () => {
    const result = validateReply("a".repeat(4001));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("4000");
  });
});

describe("extractReviewId — kunci tahan ganti akun Google", () => {
  it("mengambil segmen terakhir dari resource path", () => {
    expect(extractReviewId("accounts/111/locations/222/reviews/ABC-xyz")).toBe("ABC-xyz");
  });

  it("id sama walau akun & lokasi berbeda — dedup tetap bekerja", () => {
    const lama = extractReviewId("accounts/111/locations/222/reviews/SAMA");
    const baru = extractReviewId("accounts/999/locations/888/reviews/SAMA");
    expect(lama).toBe(baru);
  });

  it("nama tanpa pola resource dipakai apa adanya", () => {
    expect(extractReviewId("hanya-id")).toBe("hanya-id");
  });

  it("normalizeReview mengisi reviewId", () => {
    const result = normalizeReview({
      name: "accounts/1/locations/2/reviews/rev-9",
      starRating: "FIVE",
      createTime: "2026-07-19T10:00:00Z",
    });
    expect(result?.reviewId).toBe("rev-9");
  });
});
