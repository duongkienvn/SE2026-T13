import { NotificationKind } from '@kanban/shared';
import {
  isTaskEmailKind,
  type TaskEmailKind,
} from '../api/notifications/task-email-outbox';
import { escapeHtml } from './verification-email';

type TaskEmailCopy = {
  subject: string;
  heading: string;
  description: string;
  action: string;
  label: string;
  indicator: string;
  accent: string;
  tint: string;
};

const variants: Record<TaskEmailKind, TaskEmailCopy> = {
  [NotificationKind.CARD_ASSIGNED]: {
    subject: "You've been assigned to a card on Kanvexa",
    heading: "You've been assigned to a card!",
    description:
      'A new task has been assigned to you. Open Kanvexa to view the details and get started.',
    action: 'View your task',
    label: 'Card assignment',
    indicator: '→',
    accent: '#514bc8',
    tint: '#eeedff',
  },
  [NotificationKind.COMMENT_MENTIONED]: {
    subject: 'Someone mentioned you on Kanvexa',
    heading: 'You were mentioned in a comment!',
    description:
      'Someone mentioned you in a card discussion. Open Kanvexa to see the conversation.',
    action: 'View conversation',
    label: 'Comment mention',
    indicator: '@',
    accent: '#7040a0',
    tint: '#f5edff',
  },
  [NotificationKind.DUE_REMINDER]: {
    subject: 'A task deadline is approaching on Kanvexa',
    heading: 'You have an upcoming deadline!',
    description:
      'A task assigned to you is approaching its due date. Open Kanvexa to review the details and plan your next steps.',
    action: 'View your task',
    label: 'Due date reminder',
    indicator: '!',
    accent: '#875300',
    tint: '#fff4d6',
  },
};

/** Pure presentation: only static event copy and the authenticated Card link.
 * Never load resource content, account details or provider state here. */
export function taskNotificationContent(
  message: { kind: TaskEmailKind; boardId: string; cardId: string },
  appOrigin: string,
) {
  if (!isTaskEmailKind(message.kind))
    throw new Error('Unsupported task email kind');
  const copy = variants[message.kind];
  const origin = new URL(appOrigin);
  if (
    origin.origin !== appOrigin ||
    (origin.protocol !== 'https:' &&
      (origin.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
  )
    throw new Error('Invalid application origin');
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(message.boardId) || !uuid.test(message.cardId))
    throw new Error('Invalid task link');
  const url = new URL(
    `/boards/${message.boardId}/cards/${message.cardId}`,
    origin,
  ).toString();
  const link = escapeHtml(url);
  const heading = escapeHtml(copy.heading);
  const description = escapeHtml(copy.description);
  const access =
    'Sign in to Kanvexa to view this task. Access follows your current permissions.';
  const reason =
    "You're receiving this email because task emails are enabled in your Kanvexa notification preferences.";
  return {
    subject: copy.subject,
    text: `Kanvexa\n\n${copy.heading}\n\n${copy.description}\n\n${copy.action}: ${url}\n\n${access}\n\nThe Kanvexa Team\nKanvexa — Shared boards. Clear tasks. Real-time collaboration.\n\n${reason}`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="referrer" content="no-referrer">
<title>${heading}</title>
<style>
@media (prefers-color-scheme: dark) {
  .email-page { background-color:#10182a !important; }
  .email-card { background-color:#172038 !important; border-color:#35415c !important; }
  .email-text { color:#edf0f7 !important; }
  .email-muted { color:#c3cbe0 !important; }
  .email-link { color:#b9b6ff !important; }
  .email-rule { border-color:#35415c !important; }
}
@media screen and (max-width:480px) {
  .email-content { padding:28px 22px !important; }
  .email-heading { font-size:24px !important; line-height:32px !important; }
}
</style>
</head>
<body class="email-page" bgcolor="#f4f5fb" style="margin:0;padding:0;width:100%;background-color:#f4f5fb;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${description}</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="email-page" bgcolor="#f4f5fb" style="width:100%;background-color:#f4f5fb;border-collapse:collapse">
<tr><td align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" align="center" class="email-card" bgcolor="#ffffff" style="width:100%;max-width:600px;table-layout:fixed;background-color:#ffffff;border:1px solid #e4e8f1;border-radius:16px;border-collapse:separate;overflow:hidden">
<tr><td bgcolor="#615CF7" style="height:5px;font-size:0;line-height:5px;background-color:#615CF7">&nbsp;</td></tr>
<tr><td class="email-content" style="padding:36px 40px">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed;border-collapse:collapse">
<tr><td style="padding:0 0 28px">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
  <td width="40" valign="middle"><img src="https://kanvexa.tech/branding/kanvexa-logo-v1.png" width="40" height="40" alt="" border="0" style="display:block;width:40px;height:40px;border:0;outline:none"></td>
  <td valign="middle" class="email-text" style="padding-left:8px;color:#172038;font-size:24px;line-height:32px;font-weight:bold">Kanvexa</td>
  </tr></table>
</td></tr>
<tr><td style="padding:0 0 20px">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
  <td aria-hidden="true" align="center" width="36" height="36" bgcolor="${escapeHtml(copy.tint)}" style="width:36px;height:36px;background-color:${escapeHtml(copy.tint)};border-radius:8px;color:${escapeHtml(copy.accent)};font-size:22px;line-height:36px;font-weight:bold">${escapeHtml(copy.indicator)}</td>
  <td class="email-muted" style="padding-left:12px;color:#596780;font-size:13px;line-height:20px;font-weight:bold">${escapeHtml(copy.label)}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:0 0 16px"><h1 class="email-text email-heading" style="margin:0;color:#172038;font-size:28px;line-height:36px;font-weight:bold">${heading}</h1></td></tr>
<tr><td class="email-muted" style="padding:0 0 24px;color:#596780;font-size:16px;line-height:26px">${description}</td></tr>
<tr><td style="padding:0 0 18px">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:separate"><tr>
  <td align="center" bgcolor="#615CF7" style="background-color:#615CF7;border-radius:8px;mso-padding-alt:14px 20px">
    <a href="${link}" rel="noreferrer" style="display:block;padding:14px 20px;border:1px solid #615CF7;border-radius:8px;background-color:#615CF7;color:#ffffff;font-size:16px;line-height:24px;font-weight:bold;text-align:center;text-decoration:none">${escapeHtml(copy.action)}</a>
  </td></tr></table>
</td></tr>
<tr><td class="email-muted" style="padding:0 0 22px;color:#596780;font-size:13px;line-height:21px">${escapeHtml(access)}</td></tr>
<tr><td class="email-muted" style="padding:0 0 24px;color:#596780;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere">Button not working? Copy and paste this link into your browser:<br><a href="${link}" rel="noreferrer" class="email-link" style="color:#514bc8;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">${link}</a></td></tr>
<tr><td class="email-text" style="padding:0 0 24px;color:#172038;font-size:14px;line-height:22px"><strong>The Kanvexa Team</strong></td></tr>
<tr><td class="email-rule email-muted" style="padding:22px 0 0;border-top:1px solid #e4e8f1;color:#596780;font-size:12px;line-height:20px">
  <p style="margin:0 0 8px"><strong>Kanvexa</strong> &mdash; Shared boards. Clear tasks. Real-time collaboration.</p>
  <p style="margin:0">${escapeHtml(reason)}</p>
</td></tr>
</table>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`,
  };
}
