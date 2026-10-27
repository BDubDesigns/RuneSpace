import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicSiteShell } from "@/components/public-site/PublicSiteShell";
import { CharacterPortrait } from "@/components/portraits/CharacterPortrait";
import { CharacterSkillList } from "@/features/shared/CharacterSkillList";
import { ShareProfile } from "@/features/high-scores/ShareProfile";
import {
  publicSiteFooterLinks,
  publicSiteNavigation,
} from "@/features/public-site/public-site-content";
import { getPublicCharacterProfile } from "@/server/public-character-profile";

export const dynamic = "force-dynamic";
export default async function PublicCharacterPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  let decodedName: string;
  try {
    decodedName = decodeURIComponent(name);
  } catch {
    notFound();
  }
  const profile = await getPublicCharacterProfile(decodedName);
  if (!profile) notFound();
  return (
    <PublicSiteShell footerLinks={publicSiteFooterLinks} navigation={publicSiteNavigation}>
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <Link
          className="rs-focus text-sm text-[color:var(--rs-accent-primary)] underline"
          href="/high-scores"
        >
          ← High Scores
        </Link>
        <div className="mt-6 flex items-center gap-4">
          <CharacterPortrait
            className="h-20 w-20 shrink-0"
            sizes="80px"
            presentation={profile.portrait}
          />
          <div>
            <h1 className="font-display text-3xl font-bold">{profile.displayName}</h1>
            <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
              Player: {profile.ownerName ?? "Unknown"}
            </p>
            <p className="mt-1 font-semibold">
              Character Level {profile.characterLevel.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="mt-5">
          <ShareProfile name={profile.displayName} />
        </div>
        <h2 className="mt-6 font-display text-xl font-bold">Skills</h2>
        <CharacterSkillList className="mt-4" skills={profile.skills} />
      </div>
    </PublicSiteShell>
  );
}
