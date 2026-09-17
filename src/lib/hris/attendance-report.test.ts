import { describe, expect, it } from "vitest";
import { parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";
import {
  buildAttendancePdf,
  buildAttendanceXlsx,
  buildPeriodLabel,
  formatJamWib,
  statusLabel,
  type AttendanceReportRow,
} from "./attendance-report";

const contoh = (over: Partial<AttendanceReportRow> = {}): AttendanceReportRow => ({
  date: "2026-08-27",
  employeeName: "Nanda Romdona",
  nip: "TMP-001",
  department: "Kitchen",
  position: "CDP Kitchen",
  clockIn: "2026-08-27T01:58:00Z",
  clockOut: "2026-08-27T08:58:00Z",
  workHours: 7,
  status: "present",
  isLate: false,
  lateMinutes: 0,
  notes: null,
  clockInPhotoPath: null,
  clockOutPhotoPath: null,
  ...over,
});

describe("buildPeriodLabel", () => {
  it("satu bulan penuh jadi ringkas", () => {
    expect(buildPeriodLabel("2026-08-01", "2026-08-31")).toBe("1–31 Agustus 2026");
  });
  it("lintas bulan dalam tahun sama", () => {
    expect(buildPeriodLabel("2026-08-25", "2026-09-05")).toBe("25 Agustus – 5 September 2026");
  });
});

describe("statusLabel & formatJamWib", () => {
  it("status dikenal diterjemahkan; tak dikenal apa adanya", () => {
    expect(statusLabel("present")).toBe("Hadir");
    expect(statusLabel("late")).toBe("Terlambat");
    expect(statusLabel("custom")).toBe("custom");
    expect(statusLabel(null)).toBe("—");
  });
  it("jam WIB dari UTC", () => {
    expect(formatJamWib("2026-08-27T01:58:00Z")).toMatch(/08[.:]58/);
    expect(formatJamWib(null)).toBe("—");
  });
});

describe("buildAttendanceXlsx", () => {
  it("workbook memuat judul, periode, dan baris data", async () => {
    const buffer = await buildAttendanceXlsx([contoh()], {
      companyName: "Sulu",
      periodLabel: "1–31 Agustus 2026",
      employeeLabel: "Nanda Romdona",
      generatedAt: new Date("2026-08-28T03:00:00Z"),
    });
    const matrix = await parseXlsxToMatrix(buffer);
    const text = JSON.stringify(matrix);
    expect(text).toContain("Sulu — Rekap Absensi");
    expect(text).toContain("Periode: 1–31 Agustus 2026");
    expect(text).toContain("Nanda Romdona");
    expect(text).toContain("Hadir");
  });
});

describe("buildAttendancePdf", () => {
  it("menghasilkan PDF valid tanpa foto (placeholder aman)", async () => {
    const buffer = await buildAttendancePdf(
      [contoh(), contoh({ date: "2026-08-28", isLate: true, lateMinutes: 12, status: "late" })],
      {
        companyName: "Sulu",
        periodLabel: "1–31 Agustus 2026",
        employeeLabel: null,
        generatedAt: new Date("2026-08-28T03:00:00Z"),
      },
      async () => null
    );
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("foto PNG ter-embed (ukuran PDF membesar)", async () => {
    // PNG 1x1 valid
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const tanpaFoto = await buildAttendancePdf([contoh()], {
      companyName: "S", periodLabel: "p", employeeLabel: null, generatedAt: new Date(0),
    }, async () => null);
    const denganFoto = await buildAttendancePdf(
      [contoh({ clockInPhotoPath: "attendance/x/a.png" })],
      { companyName: "S", periodLabel: "p", employeeLabel: null, generatedAt: new Date(0) },
      async () => ({ data: png, mime: "image/png" })
    );
    expect(denganFoto.subarray(0, 5).toString()).toBe("%PDF-");
    expect(denganFoto.length).toBeGreaterThan(tanpaFoto.length);
  });
});
