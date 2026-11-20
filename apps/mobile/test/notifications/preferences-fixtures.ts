export const defaults = () => ({
  inApp: {
    cardAssigned: true,
    commentMentioned: true,
    workspaceInvited: true,
    boardInvited: true,
    membershipChanged: true,
    dueReminder: true,
  },
  email: { cardAssigned: false, commentMentioned: false, dueReminder: false },
});
