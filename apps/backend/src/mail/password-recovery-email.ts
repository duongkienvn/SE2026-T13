import { escapeHtml } from './verification-email';

export function passwordRecoveryEmail(url: string) {
  const link = escapeHtml(url);
  return {
    subject: 'Reset your Kanvexa password',
    text: `A password reset was requested for your Kanvexa account.\n\nReset or set your password: ${url}\n\nThis link expires in 30 minutes and can be used once. If you did not request this, ignore this email. Your password has not changed.`,
    // Table layout and inline styles work without CSS support in Gmail/mobile.
    // Text branding avoids third-party images/tracking on a sensitive email.
    html: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;color:#172b4d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;table-layout:fixed;background:#fff;border:1px solid #e4e8f1;border-radius:16px"><tr><td style="padding:32px 24px">
<p style="margin:0 0 24px;font-size:24px;font-weight:bold;color:#4358cf">Kanvexa</p>
<h1 style="margin:0 0 16px;font-size:26px;line-height:34px">Choose a new password</h1>
<p style="font-size:16px;line-height:26px">A password reset was requested for your account. Use this link to reset or set your Kanvexa password.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#4358cf;border-radius:8px"><a href="${link}" rel="noreferrer" style="display:inline-block;padding:16px 22px;color:#fff;font-size:16px;font-weight:bold;text-decoration:none">Reset Password</a></td></tr></table>
<p style="font-size:14px;line-height:22px">This link expires in <strong>30 minutes</strong> and can only be used once.</p>
<p style="font-size:14px;line-height:22px;color:#596780">If you did not request this, you can ignore this email. Your password has not changed.</p>
<p style="border-top:1px solid #e4e8f1;padding-top:20px;font-size:13px;line-height:20px;word-break:break-all;overflow-wrap:anywhere">Button not working? Copy this link:<br><a href="${link}" rel="noreferrer" style="color:#4358cf">${link}</a></p>
</td></tr></table></td></tr></table></body></html>`,
  };
}
