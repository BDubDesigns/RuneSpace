# Issue #117 — Image delivery evidence report

Status: **in progress (measurement checkpoint)**. This file is the durable
evidence record required by Issue #117. It separates measured facts, rejected
hypotheses, isolated causes, and recommendations. It is updated as measurement
proceeds; do not treat an in-progress section as a conclusion.

## Measurement environment

| Item | Value |
| --- | --- |
| Deployed target | `https://runespace.qcfailed.com` (production, read-only) |
| Deployed revision | `GET /api/build-info` → `4e5d7278832c495a587258825b8de960cbf025f3` |
| Local repo revision under investigation | `4e5d7278832c495a587258825b8de960cbf025f3` (identical) |
| Measuring host | Hermes Oracle VPS (ARM64, Debian 13), outbound HTTPS unrestricted |
| Tooling | `curl` 8.x (`-w` timing), Playwright 1.51.1 driving Chromium 1234 |
| Canonical mobile profile | 390×844 CSS, `devicePixelRatio` 3, mobile UA, touch |
| Network caveat | A VPS in the same region as the deployment has a much shorter RTT (~150 ms TLS handshake floor here) than a player's phone. Byte counts, candidate widths, formats, cache headers, and cold/warm classification transfer directly; absolute wall-clock does not. |

All production interaction was read-only: `GET` requests for HTML and images.
No production account, character, database row, Coolify setting, or container
state was created or modified.
