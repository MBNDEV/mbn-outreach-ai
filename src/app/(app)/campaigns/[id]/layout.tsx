import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import CampaignHeader from "@/components/CampaignHeader";

export default async function CampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const campaign = await db.campaign.findUnique({
    where: { id },
    select: { id: true, name: true, status: true, workspaceId: true },
  });
  if (!campaign || campaign.workspaceId !== workspace.id) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <CampaignHeader campaign={campaign} />
      {children}
    </div>
  );
}
