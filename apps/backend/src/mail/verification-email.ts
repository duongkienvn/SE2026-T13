export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
}

// Public frontend asset, independent of a local PUBLIC_APP_URL. Keep versioned
// images available for older emails; never include a recipient or token here.
const BRAND_LOGO_URL = 'https://kanvexa.tech/branding/kanvexa-logo-v1.png';

export function verificationEmail(url: string) {
  const link = escapeHtml(url);
  return {
    subject: 'Verify your Kanvexa email address',
    text: `Welcome to Kanvexa.\n\nVerify your email address: ${url}\n\nThis link expires in 24 hours and can be used once. If you did not create an account, ignore this email.`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
@media (prefers-color-scheme: dark) {
  .email-page { background-color:#10182a !important; }
  .email-card { background-color:#172038 !important; border-color:#35415c !important; }
  .email-text { color:#edf0f7 !important; }
  .email-muted { color:#c3cbe0 !important; }
  .email-rule { border-color:#35415c !important; }
  .email-link { color:#b9c4ff !important; }
}
</style>
</head>
<body class="email-page" bgcolor="#f4f6fb" style="margin:0;padding:0;width:100%;background-color:#f4f6fb;font-family:Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="email-page" bgcolor="#f4f6fb" style="width:100%;background-color:#f4f6fb;border-collapse:collapse">
<tr><td align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="580" align="center"><tr><td><![endif]-->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" align="center" class="email-card" bgcolor="#ffffff" style="width:100%;max-width:580px;table-layout:fixed;background-color:#ffffff;border:1px solid #e4e8f1;border-radius:16px;border-collapse:separate">
<tr><td style="padding:32px 24px">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed;border-collapse:collapse">
<tr><td style="padding:0 0 24px">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
  <td width="64" valign="middle" style="padding:0"><img src="${BRAND_LOGO_URL}" width="64" height="64" alt="" border="0" style="display:block;width:64px;height:64px;border:0;outline:none;text-decoration:none"></td>
  <td valign="middle" class="email-text" style="padding-left:8px;color:#172b4d;font-family:Arial,sans-serif;font-size:24px;line-height:32px;font-weight:bold">Kanvexa</td>
  </tr></table>
</td></tr>
<tr><td style="padding:0 0 16px">
  <h1 class="email-text" style="margin:0;color:#172b4d;font-family:Arial,sans-serif;font-size:26px;line-height:34px;font-weight:bold">One step closer to your team</h1>
</td></tr>
<tr><td class="email-text" style="padding:0 0 24px;color:#172b4d;font-family:Arial,sans-serif;font-size:16px;line-height:26px">
  Welcome! Confirm your email address to start organizing work and moving ideas forward.
</td></tr>
<tr><td align="left" style="padding:0 0 24px">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>
  <td align="center" bgcolor="#4358cf" style="padding:0;background-color:#4358cf;border-radius:8px;mso-padding-alt:16px 22px">
    <a href="${link}" style="display:inline-block;padding:16px 22px;border:1px solid #4358cf;border-radius:8px;background-color:#4358cf;color:#ffffff;font-family:Arial,sans-serif;font-size:16px;line-height:24px;font-weight:bold;text-align:center;text-decoration:none">Verify Email Address</a>
  </td></tr></table>
</td></tr>
<tr><td class="email-text" style="padding:0 0 12px;color:#172b4d;font-family:Arial,sans-serif;font-size:14px;line-height:22px">
  This link expires in <strong>24 hours</strong> and can only be used once.
</td></tr>
<tr><td class="email-muted" style="padding:0 0 24px;color:#596780;font-family:Arial,sans-serif;font-size:14px;line-height:22px">
  If you did not create a Kanvexa account, you can safely ignore this email.
</td></tr>
<tr><td class="email-rule email-muted" style="padding:20px 0 0;border-top:1px solid #e4e8f1;color:#596780;font-family:Arial,sans-serif;font-size:13px;line-height:20px;word-break:break-all;overflow-wrap:anywhere">
  <p style="margin:0 0 8px">Button not working? Copy this link:</p>
  <a href="${link}" class="email-link" style="color:#4358cf;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">${link}</a>
</td></tr>
</table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`,
  };
}
