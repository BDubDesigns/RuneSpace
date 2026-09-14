import { readFileSync } from "node:fs";

/**
 * Minimal PNG/WebP container reader for asset-contract assertions (issue #117).
 *
 * The repository has no image library dependency and does not need one for
 * this: both containers carry the intrinsic size and the WebP compression mode
 * in fixed, documented header positions. Not a test file itself — Vitest is
 * configured to collect `*.test.ts`.
 */
export type ImageHeader = {
  width: number;
  height: number;
  /** `"png"`, or the WebP bitstream chunk: `"VP8 "` lossy, `"VP8L"` lossless. */
  container: string;
};

export function readImageHeader(path: string): ImageHeader {
  const buffer = readFileSync(path);

  if (buffer.subarray(0, 8).toString("latin1") === "\x89PNG\r\n\x1a\n") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), container: "png" };
  }

  if (buffer.subarray(0, 4).toString("latin1") === "RIFF") {
    const first = buffer.subarray(12, 16).toString("latin1");
    if (first === "VP8X") {
      return {
        width: buffer.readUIntLE(24, 3) + 1,
        height: buffer.readUIntLE(27, 3) + 1,
        container: findWebpBitstream(buffer),
      };
    }
    if (first === "VP8 ") {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
        container: first,
      };
    }
    if (first === "VP8L") {
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        container: first,
      };
    }
  }

  throw new Error(`Unsupported image container for ${path}`);
}

/** Walk the RIFF chunk list of an extended-format WebP for its bitstream chunk. */
function findWebpBitstream(buffer: Buffer): string {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.subarray(offset, offset + 4).toString("latin1");
    if (id === "VP8 " || id === "VP8L") return id;
    const size = buffer.readUInt32LE(offset + 4);
    offset += 8 + size + (size % 2);
  }
  return "VP8X";
}
