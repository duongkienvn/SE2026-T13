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
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f6fb;font-family:Arial,sans-serif;color:#172b4d">
<main style="max-width:560px;margin:32px auto;padding:32px 24px;background:#fff;border-radius:16px">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr>
<td width="64" valign="middle"><img src="${BRAND_LOGO_URL}" width="64" height="64" alt="" border="0" style="display:block;width:64px;height:64px;border:0;outline:none;text-decoration:none"></td>
<td valign="middle" style="padding-left:8px;color:#172b4d;font-family:Arial,sans-serif;font-size:24px;font-weight:bold">Kanvexa</td>
</tr></table>
<h1 style="font-size:26px">One step closer to your team</h1>
<p style="line-height:1.6">Welcome! Confirm your email address to start organizing work and moving ideas forward.</p>
<p style="margin:32px 0"><a href="${link}" style="display:inline-block;padding:16px 22px;background:#4358cf;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Verify Email Address</a></p>
<p style="line-height:1.6">This link expires in <strong>24 hours</strong> and can only be used once.</p>
<p style="color:#596780;line-height:1.6">If you did not create a Kanvexa account, you can safely ignore this email.</p>
<p style="font-size:13px;line-height:1.6">Button not working? Copy this link:<br><a href="${link}" style="overflow-wrap:anywhere;color:#4358cf">${link}</a></p>
</main></body></html>`,
  };
}
