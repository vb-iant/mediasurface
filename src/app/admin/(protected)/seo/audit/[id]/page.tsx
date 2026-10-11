import type { Metadata } from "next";
import { AuditOverview } from "../../audit-views";

export const metadata: Metadata = {
  title: "SEO audit · mediasurface",
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AuditOverview id={id} />;
}
