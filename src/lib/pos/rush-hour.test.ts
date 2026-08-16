import { describe, expect, it } from "vitest";
import { buildRushHourReport, formatHourLabel, rushHourHeatIntensity } from "./rush-hour";

describe("formatHourLabel", () => {
  it("pads hour in 24h", () => {
    expect(formatHourLabel(8)).toBe("08:00");
    expect(formatHourLabel(14)).toBe("14:00");
  });
});

describe("buildRushHourReport", () => {
  it("aggregates hour and weekday, then picks peaks", () => {
    const report = buildRushHourReport([
      { hour: 12, dow: 6, transactions: 10, revenue: 1_000_000 },
      { hour: 12, dow: 7, transactions: 4, revenue: 200_000 },
      { hour: 19, dow: 6, transactions: 3, revenue: 900_000 },
    ]);

    expect(report.summary.transactions).toBe(17);
    expect(report.summary.revenue).toBe(2_100_000);
    expect(report.hourly[12]?.transactions).toBe(14);
    expect(report.hourly[12]?.average_ticket).toBe(Math.round((1_200_000 / 14) * 100) / 100);
    expect(report.peak_hour.hour).toBe(12);
    expect(report.peak_revenue_hour.hour).toBe(12);
    expect(report.peak_day.dow).toBe(6);
    expect(report.peak_day.dow_label).toBe("Sab");
  });

  it("ignores out-of-range buckets", () => {
    const report = buildRushHourReport([
      { hour: 25, dow: 1, transactions: 9, revenue: 1 },
      { hour: 10, dow: 0, transactions: 9, revenue: 1 },
    ]);
    expect(report.summary.transactions).toBe(0);
  });
});

describe("rushHourHeatIntensity", () => {
  it("scales 0-1 from max", () => {
    expect(rushHourHeatIntensity(0, 10)).toBe(0);
    expect(rushHourHeatIntensity(5, 10)).toBe(0.5);
    expect(rushHourHeatIntensity(10, 0)).toBe(0);
  });
});
