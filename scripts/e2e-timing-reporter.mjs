import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SLOWEST_COUNT = 10;

/**
 * Small canonical-only reporter. The list reporter remains the human-readable
 * result stream; this adds one total and a bounded slow-test summary for local
 * and shard timing comparisons without changing test behavior.
 */
export default class E2ETimingReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile;
    this.startedAt = 0;
    this.tests = [];
  }

  onBegin(config) {
    this.startedAt = Date.now();
    this.workers = config.workers;
  }

  onTestEnd(test, result) {
    this.tests.push({
      durationMs: result.duration,
      file: test.location.file,
      retry: result.retry,
      status: result.status,
      title: test.titlePath().slice(1).join(" > "),
      worker: result.workerIndex,
    });
  }

  onEnd(result) {
    const totalMs = Date.now() - this.startedAt;
    const slowest = [...this.tests]
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, SLOWEST_COUNT);
    const shard = process.env.RUNESPACE_E2E_SHARD_INDEX
      ? `${process.env.RUNESPACE_E2E_SHARD_INDEX}/${process.env.RUNESPACE_E2E_SHARD_TOTAL}`
      : "local";
    console.log(
      `[e2e-timing] total ${totalMs} ms; tests ${this.tests.length}; workers ${this.workers}; shard ${shard}`,
    );
    for (const test of slowest) {
      console.log(`[e2e-timing] ${test.durationMs} ms — ${test.file} — ${test.title}`);
    }

    if (this.outputFile) {
      mkdirSync(dirname(this.outputFile), { recursive: true });
      writeFileSync(
        this.outputFile,
        JSON.stringify(
          {
            totalMs,
            testCount: this.tests.length,
            status: result.status,
            workers: this.workers,
            shard: process.env.RUNESPACE_E2E_SHARD_INDEX
              ? {
                  index: Number(process.env.RUNESPACE_E2E_SHARD_INDEX),
                  total: Number(process.env.RUNESPACE_E2E_SHARD_TOTAL),
                }
              : null,
            slowest,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
    }
  }
}
