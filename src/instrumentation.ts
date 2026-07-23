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

    const { startGoogleReviewSync } = await import("@/lib/crm/google-reviews-sync-job");
    startGoogleReviewSync();

    const { startSalesFollowupWatcher } = await import(
      "@/lib/sales-funnel/followup-reminder-watcher"
    );
    startSalesFollowupWatcher();

    const { startWaNotifWatcher } = await import("@/lib/wa/notifications-watcher");
    startWaNotifWatcher();

    const { startBookingForfeitWatcher } = await import(
      "@/lib/ticketing/booking-forfeit-watcher"
    );
    startBookingForfeitWatcher();
  }
}
