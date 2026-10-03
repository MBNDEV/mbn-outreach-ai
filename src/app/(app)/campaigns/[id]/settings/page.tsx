import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import CampaignSettingsForm from "@/components/CampaignSettingsForm";

export default async function CampaignSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();

  const [campaign, accounts, selected] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.emailAccount.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, status: true },
    }),
    db.campaignAccount.findMany({ where: { campaignId: id }, select: { accountId: true } }),
  ]);
  const selectedIds = new Set(selected.map((s) => s.accountId));

  return (
    <CampaignSettingsForm
      campaign={campaign}
      accounts={accounts.map((a) => ({ ...a, selected: selectedIds.has(a.id) }))}
    />
  );
}
