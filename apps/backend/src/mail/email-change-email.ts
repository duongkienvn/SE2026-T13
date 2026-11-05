import { escapeHtml } from './verification-email';

function page(title: string, body: string, url: string, label: string): string {
  const link = escapeHtml(url);
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;color:#172b4d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;table-layout:fixed;background:#fff;border:1px solid #e4e8f1;border-radius:16px"><tr><td style="padding:32px 24px">
<p style="margin:0 0 24px;font-size:24px;font-weight:bold;color:#4358cf">Kanvexa</p>
<h1 style="margin:0 0 16px;font-size:26px;line-height:34px">${escapeHtml(title)}</h1>
<p style="font-size:16px;line-height:26px">${escapeHtml(body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#4358cf;border-radius:8px"><a href="${link}" rel="noreferrer" style="display:inline-block;padding:16px 22px;color:#fff;font-size:16px;font-weight:bold;text-decoration:none">${escapeHtml(label)}</a></td></tr></table>
<p style="border-top:1px solid #e4e8f1;padding-top:20px;font-size:13px;line-height:20px;word-break:break-all;overflow-wrap:anywhere">Button not working? Copy this link:<br><a href="${link}" rel="noreferrer" style="color:#4358cf">${link}</a></p>
</td></tr></table></td></tr></table></body></html>`;
}
export function emailChangeProofEmail(url: string) {
  const body =
    'A change to your Kanvexa login email was requested. Confirm ownership of this new mailbox while signed in to the same account. This link expires in 30 minutes and can be used once. Your email has not changed yet. If you did not request this change, ignore this email.';
  return {
    subject: 'Confirm your new Kanvexa email address',
    text: `${body}\n\nConfirm email change: ${url}`,
    html: page(
      'Confirm your new email address',
      body,
      url,
      'Confirm Email Change',
    ),
  };
}
export function emailChangedSecurityEmail(appUrl: string) {
  const url = new URL('/login', appUrl).toString();
  const body =
    'Your Kanvexa login email address was changed after identity verification and confirmation of the new mailbox. Previous sessions have been invalidated. If you did not make this change, secure your linked identity and contact your Kanvexa operator. This is a security notification; no action is needed if you made this change.';
  return {
    subject: 'Your Kanvexa email address was changed',
    text: `${body}\n\nSign in to Kanvexa: ${url}`,
    html: page('Your login email was changed', body, url, 'Open Kanvexa'),
  };
}
