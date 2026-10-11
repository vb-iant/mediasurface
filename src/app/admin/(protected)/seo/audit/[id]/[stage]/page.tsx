import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StageDetail } from "../../../audit-views";
import { stageById } from "../../../stages";

export const metadata: Metadata = {
  title: "SEO audit · mediasurface",
};

export default async function AuditStagePage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  if (!stageById(stage)) notFound();
  return <StageDetail id={id} stageId={stage} />;
}
