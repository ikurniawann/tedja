import { redirect } from "next/navigation";

/** Rute pratinjau Fase A/B — kini portal Nox adalah /member itu sendiri. */
export default function MemberNoxPreviewPage() {
  redirect("/member");
}
