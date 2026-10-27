import Link from "next/link";
import { PublicSiteShell } from "@/components/public-site/PublicSiteShell";
import { PlayersOnline } from "@/features/presence/PlayersOnline";
import {
  publicSiteFooterLinks,
  publicSiteNavigation,
} from "@/features/public-site/public-site-content";
import { getHighScores, highScoreBoards, HIGH_SCORE_MAX_PAGE } from "@/server/high-scores";

export const dynamic = "force-dynamic";
export const metadata = { title: "High Scores | RuneSpace" };

type Params = { board?: string | string[]; search?: string | string[]; page?: string | string[] };
export default async function HighScoresPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const board =
    typeof params.board === "string" && highScoreBoards.some((b) => b.id === params.board)
      ? params.board
      : "overall-level";
  const search = typeof params.search === "string" ? params.search.slice(0, 24) : "";
  const rawPage =
    typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  const page =
    Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= HIGH_SCORE_MAX_PAGE ? rawPage : 1;
  const href = (next: number) =>
    `/high-scores?${new URLSearchParams({ board, search, page: String(next) })}`;
  let result: Awaited<ReturnType<typeof getHighScores>> | undefined;
  try {
    result = await getHighScores({ board, search, page });
  } catch {
    /* Surface a truthful unavailable state. */
  }
  return (
    <PublicSiteShell navigation={publicSiteNavigation} footerLinks={publicSiteFooterLinks}>
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-bold text-[color:var(--rs-text-primary)]">
          High Scores
        </h1>
        <div className="mt-3">
          <PlayersOnline />
        </div>
        <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
          See how RuneSpace characters compare. Scores update as completed work is recorded.
        </p>
        <form className="mt-6 flex flex-wrap items-end gap-3" action="/high-scores">
          <label className="grid gap-1 text-sm font-semibold">
            Ranking
            <select
              className="min-h-11 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] px-3"
              name="board"
              defaultValue={board}
            >
              {highScoreBoards.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 flex-1 gap-1 text-sm font-semibold">
            Character name
            <input
              className="min-h-11 min-w-0 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] px-3"
              name="search"
              maxLength={24}
              defaultValue={search}
              placeholder="Search characters"
            />
          </label>
          <button
            className="rs-focus min-h-11 border border-[color:var(--rs-border-structural)] px-4 font-semibold"
            type="submit"
          >
            View
          </button>
        </form>
        {!result ? (
          <p className="mt-8" role="alert">
            High Scores are unavailable. Please try again.
          </p>
        ) : result.entries.length === 0 ? (
          <p className="mt-8">No characters found on this page.</p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--rs-border-structural)]">
                  <th className="p-2">Rank</th>
                  <th className="p-2">Character</th>
                  <th className="p-2 text-right">Level</th>
                  <th className="p-2 text-right">XP</th>
                </tr>
              </thead>
              <tbody>
                {result.entries.map((entry) => (
                  <tr className="border-b border-[color:var(--rs-border-subtle)]" key={entry.name}>
                    <td className="p-2">{entry.rank.toLocaleString()}</td>
                    <td className="p-2">
                      <Link
                        className="rs-focus font-semibold text-[color:var(--rs-accent-primary)] underline"
                        href={`/high-scores/characters/${encodeURIComponent(entry.name)}`}
                      >
                        {entry.name}
                      </Link>
                    </td>
                    <td className="p-2 text-right">{entry.level.toLocaleString()}</td>
                    <td className="p-2 text-right">{entry.xp.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav
          aria-label="High Scores pages"
          className="mt-6 flex items-center gap-4 text-sm font-semibold"
        >
          {page > 1 ? (
            <Link className="rs-focus underline" href={href(page - 1)}>
              Previous
            </Link>
          ) : null}
          <span>Page {page.toLocaleString()}</span>
          {result?.hasNext ? (
            <Link className="rs-focus underline" href={href(page + 1)}>
              Next
            </Link>
          ) : null}
        </nav>
      </div>
    </PublicSiteShell>
  );
}
