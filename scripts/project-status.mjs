#!/usr/bin/env node

// Agent-owned GitHub Project status transitions without the `gh` CLI.
//
// `docs/development-workflow.md` documents the `gh project item-edit` path.
// That path is unavailable in environments that have no `gh` binary and no
// interactive auth flow — notably Claude Code cloud containers — where
// Projects v2 is reachable only through the GraphQL API. This script is that
// second path, and it is deliberately narrower than `gh`:
//
//   - `AGENTS.md` grants agents exactly two transitions, `Ready` ->
//     `In Progress` and `In Progress` -> `Review`. Both the destination *and*
//     the source are enforced, so the permitted pairs are the whole contract:
//     `Done` and `Preview / Playtest` cannot be set, and a card already in one
//     of them cannot be dragged back into the working columns either. A
//     forbidden *target* is rejected during argument parsing, before any
//     network call. A forbidden source->target *pair* cannot be known until
//     the card's current status has been read, so it is rejected after that
//     read but before any mutation, and an illegal transition is never
//     presented as a valid dry run.
//   - The project number, owner, and repository are pinned, so a mistyped
//     argument cannot reach a different board (project 3, `QC Failed!
//     Roadmap`, is a different board) or a same-numbered issue elsewhere.
//   - No opaque node ID (`PVT_…`, `PVTSSF_…`, `PVTI_…`) is committed. The
//     project, the `Status` field, the target option, and the issue's card are
//     all resolved at runtime from the names and numbers below.
//
// The default mode is a read-only dry run, like the repository's other
// maintenance scripts. `--execute` performs the single `updateProjectV2Item
// FieldValue` mutation and then reads the value back rather than assuming the
// write landed.
//
// Credentials: a classic PAT with the `project` scope in
// RUNESPACE_PROJECT_TOKEN, read from the environment at call time only. The
// token is never printed, logged, or written to disk; GraphQL error payloads
// are surfaced, but they do not contain it.

import { fileURLToPath } from "node:url";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export const TOKEN_ENV_VAR = "RUNESPACE_PROJECT_TOKEN";

// Verified against the live board on 2026-09-16. Names and numbers, not node
// IDs, so a rename fails loudly at resolution instead of silently editing the
// wrong field.
export const AUTHORITY = Object.freeze({
  ownerLogin: "BDubDesigns",
  projectNumber: 5,
  projectTitle: "Runespace",
  repository: "BDubDesigns/RuneSpace",
  statusFieldName: "Status",
});

// The only two transitions AGENTS.md gives agents, as target -> allowed sources.
// Restricting the destination alone is not enough: without a source check this
// script would accept `Done` -> `In Progress`, dragging a card owned by the
// merge/close automation back into the working columns.
export const ALLOWED_TRANSITIONS = Object.freeze({
  "In Progress": Object.freeze(["Ready"]),
  Review: Object.freeze(["In Progress"]),
});

// Derived, so the accepted targets and the transition table cannot drift apart.
export const AGENT_SETTABLE_STATUSES = Object.freeze(Object.keys(ALLOWED_TRANSITIONS));

const USAGE = `Usage:
  node scripts/project-status.mjs --issue <number> --status "<name>"
  node scripts/project-status.mjs --issue <number> --status "<name>" --execute

Reads or sets the ${AUTHORITY.statusFieldName} of an issue's card on project
${AUTHORITY.projectNumber} (${AUTHORITY.projectTitle}, owner ${AUTHORITY.ownerLogin}).

The default mode is a read-only dry run; --execute performs the update.
The only permitted transitions are ${describeAllowedTransitions()}; a card
already at the requested status is left alone. Omit --status to report the
card's current status without changing anything.

Requires ${TOKEN_ENV_VAR}: a classic PAT with the \`project\` scope.`;

export class ProjectStatusError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectStatusError";
  }
}

function fail(message) {
  throw new ProjectStatusError(message);
}

export function parseArguments(argv) {
  const options = { issueNumber: null, status: null, mode: "dry-run", help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--execute") {
      options.mode = "execute";
    } else if (argument === "--issue") {
      index += 1;
      options.issueNumber = parseIssueNumber(argv[index]);
    } else if (argument === "--status") {
      index += 1;
      options.status = assertAgentSettableStatus(argv[index]);
    } else {
      fail(`unknown argument "${argument}"\n\n${USAGE}`);
    }
  }

  if (options.help) return options;
  if (options.issueNumber === null) fail(`--issue <number> is required\n\n${USAGE}`);
  if (options.mode === "execute" && options.status === null) {
    fail("--execute requires --status; without it the script is read-only");
  }

  return options;
}

function parseIssueNumber(raw) {
  if (raw === undefined) fail("--issue requires a number");
  if (!/^[1-9][0-9]*$/.test(raw)) fail(`--issue must be a positive integer, received "${raw}"`);
  return Number(raw);
}

export function assertAgentSettableStatus(raw) {
  if (raw === undefined) fail("--status requires a value");
  if (AGENT_SETTABLE_STATUSES.includes(raw)) return raw;

  const allowed = AGENT_SETTABLE_STATUSES.map((name) => `"${name}"`).join(" and ");
  fail(
    `refusing to set ${AUTHORITY.statusFieldName} to "${raw}". AGENTS.md gives agents ` +
      `only ${allowed}; "Preview / Playtest" belongs to the linked-PR workflow and ` +
      `"Done" to merge/close automation.`,
  );
}

export function describeAllowedTransitions() {
  return Object.entries(ALLOWED_TRANSITIONS)
    .flatMap(([target, sources]) => sources.map((source) => `"${source}" -> "${target}"`))
    .join(" and ");
}

export function assertAllowedTransition(currentStatus, targetStatus) {
  if (!Object.hasOwn(ALLOWED_TRANSITIONS, targetStatus)) {
    // Not an agent-owned destination at all; reuse the canonical refusal.
    assertAgentSettableStatus(targetStatus);
  }

  // A card already at the target is an idempotent no-op, so a re-run is
  // harmless. This shortcut applies only when the card is already where it is
  // being asked to go; it never substitutes for source validation of a
  // different target.
  if (currentStatus === targetStatus) return "no-op";

  if (ALLOWED_TRANSITIONS[targetStatus].includes(currentStatus)) return "apply";

  fail(
    `refusing to move ${AUTHORITY.statusFieldName} from "${currentStatus}" to ` +
      `"${targetStatus}". AGENTS.md grants agents only ${describeAllowedTransitions()}; ` +
      `every other transition belongs to the product owner or to automation.`,
  );
}

export function resolveStatusOption(optionNames, target) {
  const match = optionNames.find((name) => name === target);
  if (match === undefined) {
    fail(
      `option "${target}" not found on field "${AUTHORITY.statusFieldName}"; available ` +
        `options: ${optionNames.join(", ")}. A renamed board option outdates ` +
        `docs/development-workflow.md — correct the document rather than guessing.`,
    );
  }
  return match;
}

export function selectBoardItem(items, issueNumber) {
  const match = items.find(
    (item) =>
      item.content?.number === issueNumber &&
      item.content?.repository?.nameWithOwner === AUTHORITY.repository,
  );
  if (match === undefined) {
    fail(
      `issue #${issueNumber} (${AUTHORITY.repository}) is not on project ` +
        `${AUTHORITY.projectNumber} (${AUTHORITY.projectTitle}). Adding or triaging cards ` +
        `is the product owner's call: report the blocker and continue the issue.`,
    );
  }
  return match;
}

export function readToken(environment) {
  const token = environment[TOKEN_ENV_VAR];
  if (typeof token !== "string" || token.trim() === "") {
    fail(
      `${TOKEN_ENV_VAR} is not set. Project commands need a classic PAT with the ` +
        `\`project\` scope; GH_TOKEN and GITHUB_TOKEN are not substitutes.`,
    );
  }
  return token;
}

export function describeGraphqlFailure(status, body) {
  if (status === 401) {
    return `${TOKEN_ENV_VAR} was rejected (HTTP 401). The token is missing, expired, or revoked.`;
  }

  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (errors.some((error) => error?.type === "INSUFFICIENT_SCOPES")) {
    return (
      `${TOKEN_ENV_VAR} lacks the Projects scope. Every Project call, read and write, ` +
      `fails without it; granting it is an account-owner action. GitHub said: ` +
      `${errors.map((error) => error.message).join("; ")}`
    );
  }
  if (errors.length > 0) {
    return `GitHub GraphQL error: ${errors.map((error) => error.message).join("; ")}`;
  }
  if (status !== 200) return `GitHub GraphQL request failed with HTTP ${status}`;
  return null;
}

async function graphql(token, query, variables) {
  let response;
  try {
    response = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        authorization: `bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "runespace-project-status",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (cause) {
    fail(`could not reach ${GITHUB_GRAPHQL_URL}: ${cause.message}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    fail(`GitHub GraphQL returned a non-JSON response (HTTP ${response.status})`);
  }

  const failure = describeGraphqlFailure(response.status, body);
  if (failure !== null) fail(failure);

  return body.data;
}

const PROJECT_QUERY = `
query($login: String!, $number: Int!) {
  user(login: $login) {
    projectV2(number: $number) {
      id
      title
      field(name: "Status") {
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name }
        }
      }
    }
  }
}`;

const ITEMS_QUERY = `
query($login: String!, $number: Int!, $after: String) {
  user(login: $login) {
    projectV2(number: $number) {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content { ... on Issue { number repository { nameWithOwner } } }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
      }
    }
  }
}`;

const UPDATE_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }
  ) {
    projectV2Item { id }
  }
}`;

async function resolveProject(token) {
  const data = await graphql(token, PROJECT_QUERY, {
    login: AUTHORITY.ownerLogin,
    number: AUTHORITY.projectNumber,
  });

  const project = data?.user?.projectV2;
  if (!project) {
    fail(
      `project ${AUTHORITY.projectNumber} was not found for user ${AUTHORITY.ownerLogin}. ` +
        `If the RuneSpace board has moved, correct docs/development-workflow.md and this ` +
        `script rather than guessing a number.`,
    );
  }
  if (project.title !== AUTHORITY.projectTitle) {
    fail(
      `project ${AUTHORITY.projectNumber} is titled "${project.title}", not ` +
        `"${AUTHORITY.projectTitle}". Refusing to edit an unexpected board.`,
    );
  }

  const field = project.field;
  if (!field?.id) {
    fail(
      `project ${AUTHORITY.projectNumber} has no single-select field named ` +
        `"${AUTHORITY.statusFieldName}".`,
    );
  }

  return { projectId: project.id, field };
}

async function findItem(token, issueNumber) {
  const items = [];
  let after = null;

  for (;;) {
    const data = await graphql(token, ITEMS_QUERY, {
      login: AUTHORITY.ownerLogin,
      number: AUTHORITY.projectNumber,
      after,
    });
    const page = data?.user?.projectV2?.items;
    if (!page) fail(`could not read items for project ${AUTHORITY.projectNumber}`);

    items.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  return selectBoardItem(items, issueNumber);
}

export async function main(argv = process.argv.slice(2), environment = process.env, io = console) {
  const options = parseArguments(argv);
  if (options.help) {
    io.log(USAGE);
    return 0;
  }

  const token = readToken(environment);
  const { projectId, field } = await resolveProject(token);
  const optionNames = field.options.map((option) => option.name);

  const item = await findItem(token, options.issueNumber);
  const currentStatus = item.fieldValueByName?.name ?? "(none)";
  const label = `#${options.issueNumber} on project ${AUTHORITY.projectNumber} (${AUTHORITY.projectTitle})`;

  if (options.status === null) {
    io.log(`[project-status] ${label}: ${AUTHORITY.statusFieldName} is "${currentStatus}"`);
    return 0;
  }

  const targetName = resolveStatusOption(optionNames, options.status);
  const targetOption = field.options.find((option) => option.name === targetName);

  // The transition itself is validated before anything can mutate the board,
  // and before a dry run can report an illegal plan as though it were legal.
  if (assertAllowedTransition(currentStatus, targetName) === "no-op") {
    io.log(`[project-status] ${label}: already "${targetName}"; nothing to do`);
    return 0;
  }

  if (options.mode === "dry-run") {
    io.log(
      `[project-status] dry run — ${label}: "${currentStatus}" -> "${targetName}". ` +
        `Re-run with --execute to apply.`,
    );
    return 0;
  }

  await graphql(token, UPDATE_MUTATION, {
    projectId,
    itemId: item.id,
    fieldId: field.id,
    optionId: targetOption.id,
  });

  // The mutation reports success without echoing the stored value; read it back.
  const updated = await findItem(token, options.issueNumber);
  const appliedStatus = updated.fieldValueByName?.name ?? "(none)";
  if (appliedStatus !== targetName) {
    fail(
      `update reported success but ${AUTHORITY.statusFieldName} reads "${appliedStatus}", ` +
        `not "${targetName}"`,
    );
  }

  io.log(`[project-status] ${label}: "${currentStatus}" -> "${appliedStatus}"`);
  return 0;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof ProjectStatusError) {
      console.error(`[project-status] ${error.message}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
