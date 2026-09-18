import { redirect } from "next/navigation";

/** /admin lands directly on the overview dashboard. */
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
