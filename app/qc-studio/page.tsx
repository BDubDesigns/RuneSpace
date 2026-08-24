import { notFound } from "next/navigation";
import { QcStudioApp } from "@/tools/qc-studio/QcStudioApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "QC Studio — RuneSpace" };

/**
 * QC Studio is a development-only authoring surface. The explicit flag makes
 * local use easy while the production guard prevents accidental public
 * exposure even if a deployment environment contains the flag.
 */
export default function QcStudioPage() {
  if (process.env.NODE_ENV === "production" || process.env.QC_STUDIO_ENABLED !== "true") {
    notFound();
  }
  return <QcStudioApp />;
}
