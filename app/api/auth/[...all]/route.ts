import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * Better Auth HTTP handler. All email/password credential and session endpoints
 * are served here. Better Auth owns session cookie issuance and verification;
 * RuneSpace never re-implements auth here.
 */
export const { POST, GET } = toNextJsHandler(auth);
