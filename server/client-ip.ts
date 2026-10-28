import { isIP } from "node:net";
import { getIp } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";

/**
 * The client address an offline country lookup may use (issue #419, part of
 * #417). Not imported by any live code yet.
 *
 * It deliberately does not read headers itself. Better Auth's `getIp` is the
 * single resolver (`X-Forwarded-For` with exactly one valid entry, IPv6 masked
 * to /64), the same one the sign-up and verification abuse limiter uses through
 * `ipBucketFor`, so analytics and account protection cannot disagree about who
 * the visitor is. Pass the shared `authOptions` when wiring it. `CF-IPCountry`,
 * `X-Real-IP`, `Forwarded` and every other header are ignored on purpose: the
 * site is DNS-only in Cloudflare and none of them is a trusted signal here.
 *
 * Anything that is not a plausible public internet address is `null`, so
 * callers treat it as an unknown location. Nothing here logs or stores an
 * address.
 */
export function resolveClientIp(
  source: Request | Headers | undefined,
  options: BetterAuthOptions,
): string | null {
  if (!source) return null;
  try {
    const ip = getIp(source, options);
    // In development and tests `getIp` falls back to loopback; that is rejected
    // below like any other non-public address.
    return ip && isPublicClientIp(ip) ? ip : null;
  } catch {
    return null;
  }
}

/** [network, prefix length] pairs for IPv4 ranges that are not public unicast. */
const NON_PUBLIC_IPV4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including broadcast
];

function ipv4ToNumber(ip: string): number | null {
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const n = Number(octet);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function isPublicIPv4(ip: string): boolean {
  const value = ipv4ToNumber(ip);
  if (value === null) return false;
  return !NON_PUBLIC_IPV4.some(([network, prefix]) => {
    const base = ipv4ToNumber(network);
    if (base === null) return true;
    const size = 2 ** (32 - prefix);
    return Math.floor(value / size) === Math.floor(base / size);
  });
}

/** The eight 16-bit groups of an IPv6 address, or `null` if it is not plain hex. */
function ipv6Groups(ip: string): number[] | null {
  // Zone ids and embedded dotted-quad tails are not accepted: fail closed.
  if (ip.includes("%") || ip.includes(".")) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * Public IPv6 is an allowlist: global unicast `2000::/3`, minus the ranges
 * inside it that are not real client locations. Everything else (loopback,
 * unspecified, link-local, unique-local, multicast, NAT64, mapped) is refused.
 */
function isPublicIPv6(ip: string): boolean {
  const groups = ipv6Groups(ip);
  if (!groups) return false;
  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  if ((first & 0xe000) !== 0x2000) return false;
  if (first === 0x2001 && second <= 0x01ff) return false; // 2001::/23 (IETF, Teredo)
  if (first === 0x2001 && second === 0x0db8) return false; // documentation
  if (first === 0x2002) return false; // 6to4, embeds an IPv4 address
  if (first === 0x3fff && second <= 0x0fff) return false; // 3fff::/20 documentation
  return true;
}

/**
 * Whether `ip` is a well-formed public unicast address worth looking up.
 * Malformed input, private, loopback, link-local, carrier-grade NAT,
 * documentation, benchmarking, multicast and reserved ranges are all `false`.
 */
export function isPublicClientIp(ip: string): boolean {
  if (typeof ip !== "string" || ip.length === 0 || ip.length > 45) return false;
  const version = isIP(ip);
  if (version === 4) return isPublicIPv4(ip);
  if (version === 6) return isPublicIPv6(ip);
  return false;
}
