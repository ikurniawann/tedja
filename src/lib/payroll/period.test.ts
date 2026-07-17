import { describe, it, expect } from "vitest";
import {
  eachDateOfPeriod,
  countScheduledDays,
  clampedLeaveDays,
  realizedOvertimeHours,
  computeLateStats,
  overtimeHoursFromTimes,
  type AttendancePeriodRow,
} from "./period";
import type { EmployeeShiftRow } from "@/lib/hris/shifts";

const SHIFT_ID = "shift-1";

/** Pola Senin–Jumat kerja, Sabtu–Minggu libur, berlaku sepanjang 2026. */
function weekdayPattern(): EmployeeShiftRow[] {
  const rows: EmployeeShiftRow[] = [];
  for (let dow = 1; dow <= 7; dow++) {
    rows.push({
      day_of_week: dow,
      shift_id: dow <= 5 ? SHIFT_ID : null,
      effective_from: "2026-01-01",
      effective_to: null,
    });
  }
  return rows;
}

function att(partial: Partial<AttendancePeriodRow> & { date: string }): AttendancePeriodRow {
  return {
    status: "present",
    clock_out: `${partial.date}T10:00:00Z`,
    is_late: false,
    late_minutes: 0,
    overtime_hours: 0,
    ...partial,
  };
}

describe("eachDateOfPeriod", () => {
  it("lists inclusive dates", () => {
    const dates = eachDateOfPeriod("2026-06-28", "2026-07-02");
    expect(dates).toEqual([
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
    ]);
  });
});

describe("countScheduledDays", () => {
  it("counts weekday shifts for June 2026 (22 hari kerja)", () => {
    // Juni 2026: 30 hari, mulai Senin → 22 hari Senin–Jumat
    const result = countScheduledDays(weekdayPattern(), "2026-06-01", "2026-06-30");
    expect(result.hasSchedule).toBe(true);
    expect(result.scheduledDays).toBe(22);
  });

  it("returns hasSchedule=false when employee has no pattern at all", () => {
    const result = countScheduledDays([], "2026-06-01", "2026-06-30");
    expect(result.hasSchedule).toBe(false);
    expect(result.scheduledDays).toBe(0);
  });

  it("respects effective ranges (pola berakhir di tengah periode)", () => {
    const rows = weekdayPattern().map((row) => ({
      ...row,
      effective_to: "2026-06-12", // pola berhenti setelah 12 Juni
    }));
    const result = countScheduledDays(rows, "2026-06-01", "2026-06-30");
    // 1–12 Juni: Senin 1 Jun … Jumat 12 Jun = 10 hari kerja
    expect(result.scheduledDays).toBe(10);
  });
});

describe("clampedLeaveDays", () => {
  it("counts only the portion inside the period (cuti lintas bulan)", () => {
    const leave = { start_date: "2026-05-28", end_date: "2026-06-03" };
    expect(clampedLeaveDays(leave, "2026-06-01", "2026-06-30")).toBe(3);
  });

  it("counts full range when inside the period", () => {
    const leave = { start_date: "2026-06-10", end_date: "2026-06-12" };
    expect(clampedLeaveDays(leave, "2026-06-01", "2026-06-30")).toBe(3);
  });

  it("returns 0 when leave is entirely outside the period", () => {
    const leave = { start_date: "2026-07-01", end_date: "2026-07-05" };
    expect(clampedLeaveDays(leave, "2026-06-01", "2026-06-30")).toBe(0);
  });
});

describe("realizedOvertimeHours", () => {
  it("pays approved hours when attendance exists without system overtime", () => {
    const total = realizedOvertimeHours(
      [{ date: "2026-06-10", hours: 2 }],
      [att({ date: "2026-06-10" })]
    );
    expect(total).toBe(2);
  });

  it("caps at actual attendance overtime when system computed less", () => {
    const total = realizedOvertimeHours(
      [{ date: "2026-06-10", hours: 3 }],
      [att({ date: "2026-06-10", overtime_hours: 1.5 })]
    );
    expect(total).toBe(1.5);
  });

  it("pays nothing when there is no clock_out that day", () => {
    const total = realizedOvertimeHours(
      [{ date: "2026-06-10", hours: 2 }],
      [att({ date: "2026-06-10", clock_out: null })]
    );
    expect(total).toBe(0);
  });

  it("pays nothing when there is no attendance row that day", () => {
    const total = realizedOvertimeHours([{ date: "2026-06-10", hours: 2 }], []);
    expect(total).toBe(0);
  });

  it("sums multiple realized requests", () => {
    const total = realizedOvertimeHours(
      [
        { date: "2026-06-10", hours: 2 },
        { date: "2026-06-11", hours: 1.5 },
        { date: "2026-06-12", hours: 4 }, // tidak masuk kerja → 0
      ],
      [att({ date: "2026-06-10" }), att({ date: "2026-06-11" })]
    );
    expect(total).toBe(3.5);
  });
});

describe("computeLateStats", () => {
  it("sums late minutes from v2 attendance rows", () => {
    const stats = computeLateStats([
      att({ date: "2026-06-01", is_late: true, late_minutes: 12, status: "late" }),
      att({ date: "2026-06-02", is_late: true, late_minutes: 30, status: "late" }),
      att({ date: "2026-06-03" }),
    ]);
    expect(stats.lateDays).toBe(2);
    expect(stats.lateMinutes).toBe(42);
  });

  it("counts legacy status 'late' rows without late_minutes", () => {
    const stats = computeLateStats([
      att({ date: "2026-06-01", status: "late", is_late: null, late_minutes: null }),
    ]);
    expect(stats.lateDays).toBe(1);
    expect(stats.lateMinutes).toBe(0);
  });
});

describe("overtimeHoursFromTimes", () => {
  it("computes normal same-day hours", () => {
    expect(overtimeHoursFromTimes("17:00", "19:30")).toBe(2.5);
  });

  it("handles overnight overtime (lewat tengah malam)", () => {
    expect(overtimeHoursFromTimes("22:00", "01:00")).toBe(3);
  });
});
