/**
 * The browser's view of the server's clock (#424).
 *
 * Travel timestamps are the server's, and the server alone decides whether a
 * Scavenge claim is inside its window. A browser clock that is merely a few
 * seconds slow or fast would otherwise show a window the server has already
 * closed (or not yet opened) and offer a button that cannot work. Each state the
 * server sends carries its own `serverNow`; the difference to the browser's clock
 * at receipt is the offset every display clock applies.
 *
 * `serverNow` is read before the response travels, so the estimate trails the
 * true server time by the response's delay. That error only ever makes the
 * browser a little late, and the server's claim grace exists to absorb it. It is
 * a display aid: the server never reads a browser time.
 */
export function serverClockOffsetMs(serverNow: string, receivedAtMs: number): number {
  const serverNowMs = Date.parse(serverNow);
  // A malformed value must not poison every countdown with NaN.
  return Number.isFinite(serverNowMs) ? serverNowMs - receivedAtMs : 0;
}

/** The server's current time, as best the browser knows it. */
export function estimatedServerNowMs(browserNowMs: number, offsetMs: number): number {
  return browserNowMs + offsetMs;
}
