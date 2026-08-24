import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { QcStudioApp } from "@/tools/qc-studio/QcStudioApp";

export const dynamic = "force-dynamic";

/**
 * QC Studio is an unlinked, explicitly-flagged authoring surface. The
 * server-side QC_STUDIO_ENABLED flag is the single availability boundary:
 * when it is unset or false — in any environment, production mode included —
 * the route is not found. Enabling it exposes a browser-local authoring tool
 * with no source-writing, publishing, gameplay, or database mutation power.
 */
export const metadata: Metadata = {
  title: "QC Studio — RuneSpace",
  robots: { index: false, follow: false },
};

export default function QcStudioPage() {
  if (process.env.QC_STUDIO_ENABLED !== "true") {
    notFound();
  }
  return <QcStudioApp />;
}
