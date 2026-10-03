import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { signupAction } from "@/lib/actions/auth";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await db.invitation.findUnique({
    where: { token },
    include: { workspace: true },
  });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-slate-600">This invitation is invalid or has expired.</p>
      </main>
    );
  }

  const user = await getCurrentUser();
  if (user) {
    // Logged-in user accepting directly.
    const existing = await db.membership.findFirst({
      where: { userId: user.id, workspaceId: invite.workspaceId },
    });
    if (!existing) {
      await db.$transaction([
        db.membership.create({
          data: { userId: user.id, workspaceId: invite.workspaceId, role: invite.role },
        }),
        db.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
      ]);
    }
    redirect("/dashboard");
  }

  return (
    <AuthForm
      title={`Join ${invite.workspace.name}`}
      action={signupAction}
      fields={[
        { name: "name", label: "Your name" },
        { name: "email", label: "Email", type: "email" },
        { name: "password", label: "Password (8+ characters)", type: "password" },
      ]}
      submitLabel="Accept invitation"
      footer={{ text: "Already have an account?", linkText: "Log in first", href: "/login" }}
      hidden={{ inviteToken: token }}
    />
  );
}
