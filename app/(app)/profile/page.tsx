import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isAdminUser } from "@/lib/auth/admin";
import { displayNameOf } from "@/components/avatar";
import { PageHeader } from "@/components/ui";
import ProfileClient from "./ProfileClient";

export default async function ProfilePage() {
  const user = await getCurrentUser();

  return (
    <div className="page-enter mx-auto w-full max-w-2xl">
      <PageHeader
        title="Profile"
        description="Manage how your name appears across the app and keep your account secure."
      />
      <ProfileClient
        initialName={displayNameOf(user)}
        email={user.email ?? null}
        createdAt={user.created_at ?? null}
        isAdmin={isAdminUser(user)}
      />
    </div>
  );
}
