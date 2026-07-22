import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { BookingsPage } from "@/features/ticketing/bookings";

// Kelola booking website = wewenang Super Admin (konsisten menu D5)
export default async function TicketingBookingRoute() {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    redirect("/dashboard");
  }
  return <BookingsPage />;
}
