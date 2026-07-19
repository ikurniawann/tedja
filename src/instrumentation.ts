/**
 * Next.js instrumentation — berjalan sekali saat server boot.
 * Dipakai utk job internal ringan (auto-snapshot KPI bulanan, pengawas SLA CS).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startKpiAutoSnapshot } = await import("@/lib/kpi/auto-snapshot");
    startKpiAutoSnapshot();

    const { startCsSlaWatcher } = await import("@/lib/crm/cs-sla-watcher");
    startCsSlaWatcher();
  }
}
