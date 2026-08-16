import { readFileSync } from "node:fs";

const ICON_BASE64 = readFileSync(
  new URL(import.meta.resolve("@budget/shared/assets/images/icon-email.png")),
).toString("base64");

/**
 * The app's own scheme — nothing but the app opens this, so there is no web
 * fallback to render. Kept in step with `scheme` in the mobile app.config.ts and
 * with `JOIN_LINK_PREFIX` on the client.
 */
const JOIN_LINK_PREFIX = "com.sigh10.budget://join/";

/**
 * The invite, delivered to the address that is actually the guard.
 *
 * Email is the security-optimal transport for this: acceptance matches the
 * invite against a *verified* session with the same address, so mailing the code
 * hands the capability to precisely the mailbox that authorizes it — rather than
 * to whatever channel the inviter happened to pick out of the share sheet. It
 * also covers the case an in-app list structurally cannot, which is the majority
 * of real invitees: somebody who has not installed the app yet.
 *
 * The code is spelled out as well as linked. A deep link is dead on a desktop
 * mail client, and the code typed by hand is the fallback that still works.
 */
export const renderInviteEmail = ({
  householdName,
  invitedByName,
  code,
  expiresInDays,
}: {
  householdName: string;
  invitedByName: string;
  code: string;
  expiresInDays: number;
}) => {
  const heading = `${invitedByName} invited you to split expenses`;
  const link = `${JOIN_LINK_PREFIX}${code}`;
  const days = expiresInDays === 1 ? "1 day" : `${expiresInDays} days`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;text-align:center;">
                <img src="data:image/png;base64,${ICON_BASE64}" width="28" height="28" alt="Budget" style="display:inline-block;vertical-align:middle;border-radius:6px;margin-right:8px;" />
                <span style="font-size:15px;font-weight:600;letter-spacing:0.02em;color:#09090b;vertical-align:middle;">Budget</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;text-align:center;">
                <h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600;color:#09090b;">${heading}</h1>
                <p style="margin:8px 0 0 0;font-size:14px;line-height:20px;color:#71717a;">
                  You've been added to ${householdName}. Open Budget on your phone and this invite will be waiting for you — or enter the code below.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                  <tr>
                    <td style="height:56px;padding:0 24px;border:1px solid #e4e4e7;border-radius:8px;background-color:#fafafa;font-size:22px;line-height:56px;font-weight:600;text-align:center;color:#09090b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:6px;">${code}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;text-align:center;">
                <a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:8px;background-color:#09090b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open in Budget</a>
                <p style="margin:12px 0 0 0;font-size:13px;line-height:18px;color:#a1a1aa;">
                  This link only opens on a phone with Budget installed.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;text-align:center;">
                <p style="margin:0;font-size:13px;line-height:18px;color:#a1a1aa;">
                  The invite expires in ${days}, and only works when you sign in with this email address. If you weren't expecting it, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${heading}

You've been added to ${householdName} on Budget.

Your invite code is ${code}

On a phone with Budget installed, open: ${link}

The invite expires in ${days}, and only works when you sign in with this email address. If you weren't expecting it, you can safely ignore this email.`;

  return { html, text, subject: heading };
};
