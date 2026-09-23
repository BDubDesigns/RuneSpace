import { describe, expect, it } from "vitest";
import { verificationEmail } from "@/server/account-email";
import { buildZeptoMailPayload, zeptoMailAuthorization } from "@/server/zeptomail";

/**
 * Transactional account mail (issue #221): the rendered verification email and
 * the ZeptoMail request body, proved without any provider call.
 */

const sender = { address: "accounts@runespace.qcfailed.com", name: "RuneSpace" };
const url =
  "https://runespace.qcfailed.com/api/auth/verify-email?token=abc.def&callbackURL=%2Fcharacters";

describe("verificationEmail", () => {
  it("is an account-verification message carrying the exact link in text and HTML", () => {
    const message = verificationEmail({ to: "rae@example.com", playerName: "Rae", url });
    expect(message.kind).toBe("account-verification");
    expect(message.to).toBe("rae@example.com");
    expect(message.subject).toBe("Verify your RuneSpace account");
    expect(message.text).toContain("Hi Rae,");
    expect(message.text).toContain(url);
    expect(message.html).toContain(`href="${url.replace(/&/g, "&amp;")}"`);
  });

  it("escapes the player-chosen name in HTML", () => {
    const message = verificationEmail({
      to: "rae@example.com",
      playerName: `Rae "<b>'`,
      url,
    });
    expect(message.html).toContain("Hi Rae &quot;&lt;b&gt;&#39;,");
    expect(message.html).not.toContain("<b>");
  });

  it("uses a neutral greeting when no Player name is known", () => {
    expect(verificationEmail({ to: "x@example.com", playerName: null, url }).text).toMatch(
      /^Hi,\n/,
    );
  });
});

describe("buildZeptoMailPayload", () => {
  it("maps a message to ZeptoMail's Send Mail body with tracking disabled", () => {
    const message = verificationEmail({ to: "rae@example.com", playerName: "Rae", url });
    expect(buildZeptoMailPayload(message, sender)).toEqual({
      from: { address: "accounts@runespace.qcfailed.com", name: "RuneSpace" },
      to: [{ email_address: { address: "rae@example.com" } }],
      subject: "Verify your RuneSpace account",
      textbody: message.text,
      htmlbody: message.html,
      track_clicks: false,
      track_opens: false,
      client_reference: "account-verification",
    });
  });

  it("accepts the Send Mail token with or without its scheme prefix", () => {
    expect(zeptoMailAuthorization("abc123")).toBe("Zoho-enczapikey abc123");
    expect(zeptoMailAuthorization("Zoho-enczapikey abc123")).toBe("Zoho-enczapikey abc123");
  });
});
