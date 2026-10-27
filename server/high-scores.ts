import { sql } from "drizzle-orm";
import { db } from "@/db";
import { skillLevelThresholds } from "@/game/config/balance";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { normalizeCharacterName } from "@/game/domain/character-name";
import {
  characterLevelFromSkillLevels,
  presentedSkills,
} from "@/game/domain/character-progression";

export const HIGH_SCORE_PAGE_SIZE = 25;
export const HIGH_SCORE_MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / HIGH_SCORE_PAGE_SIZE);
export const highScoreSkills = presentedSkills({
  levelThresholds: skillLevelThresholds,
  skillDisplayName: (id) => getSkillPresentation(id)?.displayName,
});
export const highScoreBoards = [
  { id: "overall-level", label: "Overall Level" },
  { id: "overall-xp", label: "Overall XP" },
  ...highScoreSkills.map((skill) => ({ id: skill.skillId, label: skill.displayName })),
];

export type HighScoreEntry = { rank: number; name: string; level: number; xp: number };

/** SQL only uses generated aliases and bound values; ranking happens before search and pagination. */
export async function getHighScores(
  input: { board: string; search: string; page: number },
  executor: Pick<typeof db, "execute"> = db,
) {
  if (!highScoreBoards.some((board) => board.id === input.board))
    throw new RangeError("Invalid board");
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > HIGH_SCORE_MAX_PAGE)
    throw new RangeError("Invalid page");
  if (input.search.length > 24) throw new RangeError("Invalid search");
  const search = normalizeCharacterName(input.search);
  if (input.search.trim() && !search) return { entries: [], hasNext: false };
  const xpAliases = highScoreSkills.map((_, index) => sql.raw(`xp_${index}`));
  const xpExpressions = highScoreSkills.map(
    (skill, index) => sql`
    coalesce(max(x.total_xp) filter (where x.skill_id = ${skill.skillId}), 0)::bigint as ${xpAliases[index]}
  `,
  );
  const levelExpressions = highScoreSkills.map(
    (skill, index) => sql`(case
    ${sql.join(
      [...skill.thresholds]
        .reverse()
        .map(
          (threshold) =>
            sql`when ${xpAliases[index]} >= ${threshold.totalXp} then ${threshold.level}`,
        ),
      sql` `,
    )}
    else 1 end)`,
  );
  // Derive the coefficients from the canonical function, avoiding a second independent level rule.
  const baselineLevels = highScoreSkills.map(() => 1);
  const baseline = characterLevelFromSkillLevels(baselineLevels);
  const levelTerms = levelExpressions.map((expr, index) => {
    const probe = [...baselineLevels];
    probe[index] = 2;
    const weight = characterLevelFromSkillLevels(probe) - baseline;
    return sql`${weight} * (${expr} - 1)`;
  });
  const overallLevel = sql`${baseline} ${sql.join(
    levelTerms.map((term) => sql`+ ${term}`),
    sql` `,
  )}`;
  const overallXp = xpAliases.length ? sql.join(xpAliases, sql` + `) : sql`0`;
  const skillIndex = highScoreSkills.findIndex((skill) => skill.skillId === input.board);
  const scoreXp = skillIndex < 0 ? overallXp : xpAliases[skillIndex]!;
  const scoreLevel = skillIndex < 0 ? sql`character_level` : levelExpressions[skillIndex]!;
  const rankOrder =
    input.board === "overall-level" ? sql`character_level desc, score_xp desc` : sql`score_xp desc`;
  // The population list compares normalized names as JavaScript UTF-16 code
  // units. PostgreSQL's C collation sorts Unicode code points instead, which
  // differs for supplementary characters, so derive the same ordering key.
  const nameOrder = sql`(select array_agg(unit order by ordinal, part)
    from regexp_split_to_table(normalized_name, '') with ordinality as chars(ch, ordinal)
    cross join lateral (values
      (0, case when ascii(ch) > 65535 then 55296 + (ascii(ch) - 65536) / 1024 else ascii(ch) end),
      (1, case when ascii(ch) > 65535 then 56320 + (ascii(ch) - 65536) % 1024 else null end)
    ) as units(part, unit) where unit is not null)`;
  const result = await executor.execute(sql`
    with xp as (
      select c.id, c.display_name, c.normalized_name,
        ${sql.join(xpExpressions, sql`, `)}
      from characters c left join character_skill_xp x on x.character_id = c.id
      group by c.id
    ), scored as (
      select *, (${overallLevel}) as character_level, (${scoreXp}) as score_xp
      from xp
    ), ranked as (
      select *, rank() over (order by ${rankOrder}) as global_rank
      from scored
    )
    select display_name, global_rank, ${scoreLevel} as score_level, score_xp
    from ranked
    where ${search} = '' or strpos(normalized_name, ${search}) > 0
    order by global_rank, ${nameOrder}, id
    limit ${HIGH_SCORE_PAGE_SIZE + 1} offset ${(input.page - 1) * HIGH_SCORE_PAGE_SIZE}
  `);
  const rows = result.rows as Array<{
    display_name: string;
    global_rank: string;
    score_level: number;
    score_xp: string;
  }>;
  return {
    entries: rows.slice(0, HIGH_SCORE_PAGE_SIZE).map((row) => ({
      rank: Number(row.global_rank),
      name: row.display_name,
      level: Number(row.score_level),
      xp: Number(row.score_xp),
    })),
    hasNext: rows.length > HIGH_SCORE_PAGE_SIZE,
  };
}
