import { escapeHtml } from './verification-email';

export interface WelcomeEmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Receives the validated PUBLIC_APP_URL origin, never a client redirect. */
export function welcomeEmail(appOrigin: string): WelcomeEmailContent {
  const origin = new URL(appOrigin);
  if (
    origin.origin !== appOrigin ||
    (origin.protocol !== 'https:' &&
      (origin.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
  )
    throw new Error('Welcome email requires a safe application origin');
  const workspaceUrl = new URL('/workspaces', origin).toString();
  const websiteUrl = new URL('/', origin).toString();
  const link = escapeHtml(workspaceUrl);
  const website = escapeHtml(websiteUrl);
  return {
    subject: "Welcome to Kanvexa — Let's Get Started!",
    text: `Welcome to Kanvexa!

We're excited to have you here. Bring your projects, tasks and teamwork together in one collaborative workspace.

Your Personal Workspace is ready. Start small and build a workflow that works for you:

1. Explore your Workspace — a home for your projects and Boards.
2. Create your first Board — give your next project a place to take shape.
3. Add tasks and keep work moving — organize cards into columns, one step at a time.

Explore Your Workspace: ${workspaceUrl}

Thanks for joining us. We can't wait to see what you'll organize.
The Kanvexa Team

Kanvexa — Shared boards. Clear tasks. Real-time collaboration.
Visit Kanvexa: ${websiteUrl}
You're receiving this account email because you signed up for Kanvexa.`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Welcome to Kanvexa!</title>
<style>
@media (prefers-color-scheme: dark) {
  .email-page { background-color:#10182a !important; }
  .email-card { background-color:#172038 !important; border-color:#35415c !important; }
  .email-text { color:#edf0f7 !important; }
  .email-muted { color:#c3cbe0 !important; }
  .email-panel { background-color:#232944 !important; }
  .email-link { color:#b9b6ff !important; }
  .email-rule { border-color:#35415c !important; }
}
@media screen and (max-width:480px) {
  .email-content { padding:28px 22px !important; }
  .email-heading { font-size:28px !important; line-height:36px !important; }
}
</style>
</head>
<body class="email-page" bgcolor="#f4f5fb" style="margin:0;padding:0;width:100%;background-color:#f4f5fb;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;font-size:1px;color:#f4f5fb;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">Your Personal Workspace is ready. Let's give your next project a place to grow.</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="email-page" bgcolor="#f4f5fb" style="width:100%;background-color:#f4f5fb;border-collapse:collapse">
<tr><td align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" align="center" class="email-card" bgcolor="#ffffff" style="width:100%;max-width:600px;table-layout:fixed;background-color:#ffffff;border:1px solid #e4e8f1;border-radius:16px;border-collapse:separate;overflow:hidden">
<tr><td bgcolor="#615CF7" style="height:5px;font-size:0;line-height:5px;background-color:#615CF7">&nbsp;</td></tr>
<tr><td class="email-content" style="padding:36px 40px">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed;border-collapse:collapse">
<tr><td style="padding:0 0 30px">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
  <td width="48" valign="middle"><img src="https://kanvexa.tech/branding/kanvexa-logo-v1.png" width="48" height="48" alt="" border="0" style="display:block;width:48px;height:48px;border:0;outline:none"></td>
  <td valign="middle" class="email-text" style="padding-left:8px;color:#172038;font-size:24px;line-height:32px;font-weight:bold">Kanvexa</td>
  </tr></table>
</td></tr>
<tr><td class="email-link" style="padding:0 0 10px;color:#514bc8;font-size:12px;line-height:18px;font-weight:bold;letter-spacing:1.5px">A LITTLE CLARITY. A GREAT START.</td></tr>
<tr><td style="padding:0 0 16px"><h1 class="email-text email-heading" style="margin:0;color:#172038;font-size:32px;line-height:40px;font-weight:bold">Welcome to Kanvexa!</h1></td></tr>
<tr><td class="email-muted" style="padding:0 0 24px;color:#596780;font-size:16px;line-height:26px">We're excited to have you here. Bring your projects, tasks and teamwork together in one collaborative workspace.</td></tr>
<tr><td class="email-text" style="padding:0 0 20px;color:#172038;font-size:16px;line-height:26px">Your Personal Workspace is ready. Start small and build a workflow that works for you:</td></tr>
<tr><td class="email-panel" bgcolor="#f5f4ff" style="padding:24px;background-color:#f5f4ff;border-radius:12px">
  <p class="email-text" style="margin:0 0 6px;color:#172038;font-size:15px;line-height:24px;font-weight:bold">1. Explore your Workspace</p>
  <p class="email-muted" style="margin:0 0 18px;color:#596780;font-size:14px;line-height:22px">A home for your projects and Boards.</p>
  <p class="email-text" style="margin:0 0 6px;color:#172038;font-size:15px;line-height:24px;font-weight:bold">2. Create your first Board</p>
  <p class="email-muted" style="margin:0 0 18px;color:#596780;font-size:14px;line-height:22px">Give your next project a place to take shape.</p>
  <p class="email-text" style="margin:0 0 6px;color:#172038;font-size:15px;line-height:24px;font-weight:bold">3. Add tasks and keep work moving</p>
  <p class="email-muted" style="margin:0;color:#596780;font-size:14px;line-height:22px">Organize cards into columns, one step at a time.</p>
</td></tr>
<tr><td align="center" style="padding:28px 0 12px">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:separate"><tr>
  <td align="center" bgcolor="#615CF7" style="background-color:#615CF7;border-radius:8px;mso-padding-alt:16px 20px">
    <a href="${link}" style="display:block;padding:16px 20px;border:1px solid #615CF7;border-radius:8px;background-color:#615CF7;color:#ffffff;font-size:16px;line-height:24px;font-weight:bold;text-align:center;text-decoration:none">Explore Your Workspace</a>
  </td></tr></table>
</td></tr>
<tr><td align="center" class="email-muted" style="padding:0 0 28px;color:#596780;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere">Or open <a href="${link}" class="email-link" style="color:#514bc8;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">${link}</a></td></tr>
<tr><td class="email-text" style="padding:0 0 24px;color:#172038;font-size:15px;line-height:24px">Thanks for joining us. We can't wait to see what you'll organize.<br><strong>The Kanvexa Team</strong></td></tr>
<tr><td class="email-rule email-muted" style="padding:22px 0 0;border-top:1px solid #e4e8f1;color:#596780;font-size:12px;line-height:20px">
  <p style="margin:0 0 8px"><strong>Kanvexa</strong> &mdash; Shared boards. Clear tasks. Real-time collaboration.</p>
  <p style="margin:0 0 12px"><a href="${website}" class="email-link" style="color:#514bc8;text-decoration:underline">Visit Kanvexa</a></p>
  <p style="margin:0">You're receiving this account email because you signed up for Kanvexa.</p>
</td></tr>
</table>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`,
  };
}
