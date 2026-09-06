import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AGENTS_PATH = resolve(ROOT, "AGENTS.md");

// This is RuneSpace's conservative UTF-8 operating ceiling, not a provider
// or harness limit. See docs/development-workflow.md for the supporting audit.
const RUNESPACE_AGENT_DOC_CEILING_BYTES = 16_384;

function readAgents(): string {
  return readFileSync(AGENTS_PATH, "utf8");
}

describe("root agent instructions", () => {
  it("stay within RuneSpace's byte operating ceiling", () => {
    const content = readAgents();
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(
      RUNESPACE_AGENT_DOC_CEILING_BYTES,
    );
  });

  it("retain the pre-beta compatibility policy", () => {
    const content = readAgents();
    expect(content).toContain("## Scope and pre-beta data compatibility");
    expect(content).toContain("Do not add permanent runtime compatibility");
    expect(content).toContain("one-time data repair");
  });

  it("keep every referenced documentation path present", () => {
    const content = readAgents();
    const referencedDocs = [...content.matchAll(/`(docs\/[^`]+)`/g)]
      .map((match) => match[1])
      .filter((path): path is string => path !== undefined);

    expect(referencedDocs.length).toBeGreaterThan(0);
    for (const relativePath of new Set(referencedDocs)) {
      expect(existsSync(resolve(ROOT, relativePath)), relativePath).toBe(true);
    }
  });
});
