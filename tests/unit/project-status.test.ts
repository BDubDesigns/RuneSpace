import { describe, expect, it } from "vitest";
import {
  AGENT_SETTABLE_STATUSES,
  ALLOWED_TRANSITIONS,
  AUTHORITY,
  ProjectStatusError,
  assertAgentSettableStatus,
  assertAllowedTransition,
  describeGraphqlFailure,
  parseArguments,
  readToken,
  resolveStatusOption,
  selectBoardItem,
} from "@/scripts/project-status.mjs";

const BOARD_OPTIONS = ["Backlog", "Ready", "In Progress", "Review", "Preview / Playtest", "Done"];

function boardItem(number: number, status: string, nameWithOwner: string = AUTHORITY.repository) {
  return {
    id: `item-${number}`,
    content: { number, repository: { nameWithOwner } },
    fieldValueByName: { name: status },
  };
}

describe("agent-settable status targets", () => {
  it("accepts exactly the two transitions AGENTS.md grants agents", () => {
    expect([...AGENT_SETTABLE_STATUSES]).toEqual(["In Progress", "Review"]);
    expect(assertAgentSettableStatus("In Progress")).toBe("In Progress");
    expect(assertAgentSettableStatus("Review")).toBe("Review");
  });

  it("refuses Done, which belongs to merge/close automation", () => {
    expect(() => assertAgentSettableStatus("Done")).toThrow(ProjectStatusError);
    expect(() => assertAgentSettableStatus("Done")).toThrow(/merge\/close automation/);
  });

  it("refuses Preview / Playtest, which belongs to the linked-PR workflow", () => {
    expect(() => assertAgentSettableStatus("Preview / Playtest")).toThrow(/linked-PR workflow/);
  });

  it("refuses statuses the product owner owns", () => {
    expect(() => assertAgentSettableStatus("Backlog")).toThrow(ProjectStatusError);
    expect(() => assertAgentSettableStatus("Ready")).toThrow(ProjectStatusError);
  });

  it("is case- and whitespace-exact so a near miss cannot pass as a valid target", () => {
    expect(() => assertAgentSettableStatus("in progress")).toThrow(ProjectStatusError);
    expect(() => assertAgentSettableStatus("review ")).toThrow(ProjectStatusError);
  });
});

describe("argument parsing", () => {
  it("defaults to a read-only dry run", () => {
    const options = parseArguments(["--issue", "186", "--status", "Review"]);
    expect(options).toMatchObject({ issueNumber: 186, status: "Review", mode: "dry-run" });
  });

  it("switches to execute only when asked", () => {
    const options = parseArguments(["--issue", "186", "--status", "Review", "--execute"]);
    expect(options.mode).toBe("execute");
  });

  it("allows omitting --status to read the current value", () => {
    expect(parseArguments(["--issue", "186"]).status).toBeNull();
  });

  it("refuses --execute without a target status", () => {
    expect(() => parseArguments(["--issue", "186", "--execute"])).toThrow(
      /--execute requires --status/,
    );
  });

  it("requires an issue number", () => {
    expect(() => parseArguments(["--status", "Review"])).toThrow(/--issue <number> is required/);
  });

  it("rejects non-positive-integer issue numbers", () => {
    for (const raw of ["0", "-3", "12.5", "abc", ""]) {
      expect(() => parseArguments(["--issue", raw])).toThrow(ProjectStatusError);
    }
  });

  it("rejects unknown arguments rather than ignoring them", () => {
    expect(() => parseArguments(["--issue", "186", "--project", "3"])).toThrow(
      /unknown argument "--project"/,
    );
  });

  it("rejects a forbidden status before anything else is validated", () => {
    expect(() => parseArguments(["--issue", "186", "--status", "Done", "--execute"])).toThrow(
      ProjectStatusError,
    );
  });

  it("returns early for --help without requiring other arguments", () => {
    expect(parseArguments(["--help"]).help).toBe(true);
  });
});

describe("board option resolution", () => {
  it("resolves an exact option name", () => {
    expect(resolveStatusOption(BOARD_OPTIONS, "In Progress")).toBe("In Progress");
  });

  it("lists the available options when a name is absent", () => {
    expect(() => resolveStatusOption(["Backlog", "Doing"], "Review")).toThrow(
      /available options: Backlog, Doing/,
    );
  });
});

describe("board item lookup", () => {
  it("finds the card for an issue in the pinned repository", () => {
    const item = selectBoardItem([boardItem(185, "Ready"), boardItem(186, "In Progress")], 186);
    expect(item.id).toBe("item-186");
    expect(item.fieldValueByName?.name).toBe("In Progress");
  });

  it("ignores a same-numbered issue from another repository", () => {
    expect(() =>
      selectBoardItem([boardItem(186, "Done", "BDubDesigns/SomethingElse")], 186),
    ).toThrow(/not on project/);
  });

  it("reports an absent issue as a blocker rather than inventing a card", () => {
    expect(() => selectBoardItem([boardItem(185, "Ready")], 186)).toThrow(/product owner's call/);
  });

  it("tolerates draft cards that carry no issue content", () => {
    const drafts = [{ id: "draft-1", content: null, fieldValueByName: null }];
    expect(() => selectBoardItem(drafts, 186)).toThrow(ProjectStatusError);
  });
});

describe("credential handling", () => {
  it("fails loudly when the token is missing or blank", () => {
    expect(() => readToken({})).toThrow(/is not set/);
    expect(() => readToken({ RUNESPACE_PROJECT_TOKEN: "   " })).toThrow(/is not set/);
  });

  it("does not accept GH_TOKEN or GITHUB_TOKEN as substitutes", () => {
    expect(() => readToken({ GH_TOKEN: "x", GITHUB_TOKEN: "y" })).toThrow(ProjectStatusError);
  });

  it("returns the token without altering it", () => {
    expect(readToken({ RUNESPACE_PROJECT_TOKEN: "token-value" })).toBe("token-value");
  });
});

describe("GraphQL failure messages", () => {
  it("passes a clean response through", () => {
    expect(describeGraphqlFailure(200, { data: {} })).toBeNull();
  });

  it("names the token variable on a 401", () => {
    expect(describeGraphqlFailure(401, {})).toMatch(/RUNESPACE_PROJECT_TOKEN was rejected/);
  });

  it("explains a missing Projects scope", () => {
    const body = {
      errors: [{ type: "INSUFFICIENT_SCOPES", message: "requires ['read:project']" }],
    };
    expect(describeGraphqlFailure(200, body)).toMatch(/lacks the Projects scope/);
  });

  it("surfaces other GraphQL errors verbatim", () => {
    const body = { errors: [{ message: "Could not resolve to a User" }] };
    expect(describeGraphqlFailure(200, body)).toMatch(/Could not resolve to a User/);
  });

  it("reports a bare non-200 status", () => {
    expect(describeGraphqlFailure(502, {})).toMatch(/HTTP 502/);
  });
});

describe("transition validation", () => {
  // AGENTS.md grants exactly two transitions. Restricting the destination is
  // not enough on its own, so every source/target pair on the board is pinned
  // here: this matrix is the contract, and widening it has to be deliberate.
  const EXPECTED: Record<string, Record<string, "apply" | "no-op" | "refuse">> = {
    "In Progress": {
      Backlog: "refuse",
      Ready: "apply",
      "In Progress": "no-op",
      Review: "refuse",
      "Preview / Playtest": "refuse",
      Done: "refuse",
    },
    Review: {
      Backlog: "refuse",
      Ready: "refuse",
      "In Progress": "apply",
      Review: "no-op",
      "Preview / Playtest": "refuse",
      Done: "refuse",
    },
  };

  for (const target of AGENT_SETTABLE_STATUSES) {
    for (const source of BOARD_OPTIONS) {
      const expected = EXPECTED[target]?.[source];

      it(`${expected}s "${source}" -> "${target}"`, () => {
        if (expected === "refuse") {
          expect(() => assertAllowedTransition(source, target)).toThrow(ProjectStatusError);
        } else {
          expect(assertAllowedTransition(source, target)).toBe(expected);
        }
      });
    }
  }

  it("refuses a card that carries no status at all", () => {
    expect(() => assertAllowedTransition("(none)", "In Progress")).toThrow(ProjectStatusError);
  });

  it("names both the current and the requested status when refusing", () => {
    expect(() => assertAllowedTransition("Done", "In Progress")).toThrow(
      /from "Done" to "In Progress"/,
    );
  });

  it("refuses a target outside the two agent-owned destinations", () => {
    expect(() => assertAllowedTransition("Preview / Playtest", "Done")).toThrow(
      /merge\/close automation/,
    );
  });

  it("does not let the same-status no-op bypass source validation", () => {
    // "Done" -> "Done" must not become a foothold for "Done" -> "In Progress".
    expect(() => assertAllowedTransition("Done", "In Progress")).toThrow(ProjectStatusError);
    expect(() => assertAllowedTransition("Preview / Playtest", "Review")).toThrow(
      ProjectStatusError,
    );
  });

  it("derives the accepted targets from the transition table so they cannot drift", () => {
    expect([...AGENT_SETTABLE_STATUSES]).toEqual(Object.keys(ALLOWED_TRANSITIONS));
    expect(ALLOWED_TRANSITIONS["In Progress"]).toEqual(["Ready"]);
    expect(ALLOWED_TRANSITIONS["Review"]).toEqual(["In Progress"]);
  });
});

describe("pinned authority", () => {
  it("pins the RuneSpace board, not the QC Failed! Roadmap board", () => {
    expect(AUTHORITY.projectNumber).toBe(5);
    expect(AUTHORITY.projectTitle).toBe("Runespace");
    expect(AUTHORITY.ownerLogin).toBe("BDubDesigns");
    expect(AUTHORITY.repository).toBe("BDubDesigns/RuneSpace");
  });
});
