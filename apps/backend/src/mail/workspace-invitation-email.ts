import type { WorkspaceInvitationMail } from '../api/workspaces/workspace-invitation-mailer';
import { escapeHtml } from './verification-email';
import { workspaceInvitationLink } from './workspace-invitation-link';

/** Pure rendering; no transport, persistence, tracking or external user content. */
export function workspaceInvitationEmail(
  payload: WorkspaceInvitationMail,
  appOrigin: string,
  acceptPath: string,
): { subject: string; html: string; text: string } {
  const url = workspaceInvitationLink(appOrigin, acceptPath, payload.proof);
  const link = escapeHtml(url);
  const name = escapeHtml(payload.workspaceName);
  const recipient = escapeHtml(payload.recipient);
  const expiry = payload.expiresAt
    .toISOString()
    .replace('T', ' ')
    .replace('.000Z', ' UTC');
  return {
    // Stable subject: user-controlled names cannot inject mail headers.
    subject: "You're invited to a Workspace on Kanvexa",
    text: `You're invited to collaborate

A Workspace admin has invited ${payload.recipient} to join “${payload.workspaceName}” on Kanvexa as a Member.

Join Workspace: ${url}

This invitation expires on ${expiry}.
Sign in or create an account with this email address, verify it, then accept the invitation. You become a member only after accepting a valid invitation.

If you weren't expecting this invitation, you can ignore this email. Keep this personal invitation link private.

The Kanvexa Team
Kanvexa — Shared boards. Clear tasks. Real-time collaboration.`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="referrer" content="no-referrer">
<title>You're invited to Kanvexa</title>
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
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">An invitation to collaborate in ${name}. Review and accept to join.</div>
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
<tr><td class="email-link" style="padding:0 0 10px;color:#514bc8;font-size:12px;line-height:18px;font-weight:bold;letter-spacing:1.5px">BETTER WORK, TOGETHER.</td></tr>
<tr><td style="padding:0 0 16px"><h1 class="email-text email-heading" style="margin:0;color:#172038;font-size:32px;line-height:40px;font-weight:bold">You're invited to collaborate</h1></td></tr>
<tr><td class="email-muted" style="padding:0 0 24px;color:#596780;font-size:16px;line-height:26px;word-break:break-word;overflow-wrap:anywhere">A Workspace admin has invited <strong class="email-text" style="color:#172038">${recipient}</strong> to join their team on Kanvexa.</td></tr>
<tr><td class="email-panel" bgcolor="#f5f4ff" style="padding:24px;background-color:#f5f4ff;border-radius:12px;word-break:break-word;overflow-wrap:anywhere">
  <p class="email-muted" style="margin:0 0 8px;color:#596780;font-size:12px;line-height:18px;letter-spacing:1px">YOUR INVITATION</p>
  <p class="email-text" dir="auto" style="margin:0 0 8px;color:#172038;font-size:22px;line-height:30px;font-weight:bold;word-break:break-word;overflow-wrap:anywhere">${name}</p>
  <p class="email-muted" style="margin:0;color:#596780;font-size:14px;line-height:22px">Invited role: <strong>Member</strong></p>
</td></tr>
<tr><td align="center" style="padding:28px 0 12px">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:separate"><tr>
  <td align="center" bgcolor="#615CF7" style="background-color:#615CF7;border-radius:8px;mso-padding-alt:16px 20px">
    <a href="${link}" rel="noreferrer" style="display:block;padding:16px 20px;border:1px solid #615CF7;border-radius:8px;background-color:#615CF7;color:#ffffff;font-size:16px;line-height:24px;font-weight:bold;text-align:center;text-decoration:none">Join Workspace</a>
  </td></tr></table>
</td></tr>
<tr><td align="center" class="email-muted" style="padding:0 0 22px;color:#596780;font-size:13px;line-height:21px">This invitation expires on <strong>${expiry}</strong>.</td></tr>
<tr><td class="email-muted" style="padding:0 0 22px;color:#596780;font-size:14px;line-height:23px">Sign in or create an account with this email address, verify it, then accept the invitation. You become a member only after accepting a valid invitation.</td></tr>
<tr><td class="email-muted" style="padding:0 0 26px;color:#596780;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere">Button not working? Copy and paste this link into your browser:<br><a href="${link}" rel="noreferrer" class="email-link" style="color:#514bc8;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">${link}</a></td></tr>
<tr><td class="email-text" style="padding:0 0 24px;color:#172038;font-size:15px;line-height:24px">See you in the Workspace,<br><strong>The Kanvexa Team</strong></td></tr>
<tr><td class="email-rule email-muted" style="padding:22px 0 0;border-top:1px solid #e4e8f1;color:#596780;font-size:12px;line-height:20px">
  <p style="margin:0 0 8px"><strong>Kanvexa</strong> &mdash; Shared boards. Clear tasks. Real-time collaboration.</p>
  <p style="margin:0">If you weren't expecting this invitation, you can ignore this email. Keep this personal invitation link private.</p>
</td></tr>
</table>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`,
  };
}
