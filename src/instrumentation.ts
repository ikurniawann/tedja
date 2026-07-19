/**
 * Next.js instrumentation — berjalan sekali saat server boot.
 * Dipakai utk job internal ringan (auto-snapshot KPI bulanan).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startKpiAutoSnapshot } = await import("@/lib/kpi/auto-snapshot");
    startKpiAutoSnapshot();
  }
}
