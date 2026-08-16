import { readFileSync } from "node:fs";

const ICON_BASE64 = readFileSync(
  new URL(import.meta.resolve("@budget/shared/assets/images/icon-email.png")),
).toString("base64");

export const renderOtpEmail = ({
  otp,
  heading,
  expiresInMinutes,
}: {
  otp: string;
  heading: string;
  expiresInMinutes: number;
}) => {
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
                  Enter this code to continue. It expires in ${expiresInMinutes} minutes.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                  <tr>
                    <td style="height:56px;padding:0 24px;border:1px solid #e4e4e7;border-radius:8px;background-color:#fafafa;font-size:26px;line-height:56px;font-weight:600;text-align:center;color:#09090b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:10px;">${otp}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;text-align:center;">
                <p style="margin:0;font-size:13px;line-height:18px;color:#a1a1aa;">
                  If you didn't request this code, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${heading}\n\nYour code is ${otp}. It expires in ${expiresInMinutes} minutes.\n\nIf you didn't request this code, you can safely ignore this email.`;

  return { html, text };
};
