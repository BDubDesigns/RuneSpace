import Link from "next/link";
import { PublicSiteShell } from "@/components/public-site/PublicSiteShell";
import {
  publicSiteFooterLinks,
  publicSiteNavigation,
} from "@/features/public-site/public-site-content";

export default function CharacterNotFound() {
  return (
    <PublicSiteShell footerLinks={publicSiteFooterLinks} navigation={publicSiteNavigation}>
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="font-display text-2xl font-bold">Character not found</h1>
        <p className="mt-3">This character may have been renamed or the link may be incorrect.</p>
        <Link
          className="rs-focus mt-4 inline-block text-[color:var(--rs-accent-primary)] underline"
          href="/high-scores"
        >
          Back to High Scores
        </Link>
      </div>
    </PublicSiteShell>
  );
}
