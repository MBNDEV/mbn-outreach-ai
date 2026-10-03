import { db } from "@/lib/db";
import SequenceEditor from "@/components/SequenceEditor";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const steps = await db.sequenceStep.findMany({
    where: { campaignId: id },
    orderBy: { order: "asc" },
    include: { variants: true },
  });

  const initialSteps = steps.map((s) => ({
    waitDays: s.waitDays,
    variants: s.variants.map((v) => ({
      label: v.label,
      subject: v.subject,
      body: v.body,
      enabled: v.enabled,
    })),
  }));

  return (
    <SequenceEditor
      campaignId={id}
      initialSteps={initialSteps}
      aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}
