import type { Metadata } from "next";
import { ContentScanView } from "../content-view";

export const metadata: Metadata = {
  title: "Content scan · mediasurface",
};

export default async function ContentScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContentScanView id={id} />;
}
