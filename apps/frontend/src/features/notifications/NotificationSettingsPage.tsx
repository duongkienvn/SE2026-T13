import type { NotificationPreferences } from '@kanban/shared';
import { useState, type FormEvent } from 'react';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { UnsavedChangesGuard } from '../../components/UnsavedChangesGuard';
import {
  CalendarIcon,
  ColumnsIcon,
  MailIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersIcon,
  type IconProps,
} from '../../components/icons';
import { usePageTitle } from '../../hooks/usePageTitle';
import { env } from '../../lib/env';
import { useAuthSession } from '../auth/auth-session-context';
import { EMAIL_KEYS, IN_APP_KEYS, preferencesPatch } from './api';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from './hooks';
import { kindMeta } from './kinds';
import './notifications.css';

type InAppKey = (typeof IN_APP_KEYS)[number];
type EmailKey = (typeof EMAIL_KEYS)[number];

const MentionIcon = kindMeta.COMMENT_MENTIONED.Icon;

const inAppRows: Record<
  InAppKey,
  {
    label: string;
    description: string;
    Icon: (props: IconProps) => React.JSX.Element;
    tone: string;
    note?: string;
  }
> = {
  cardAssigned: {
    label: 'Card assignments',
    description: 'When someone assigns you to a card',
    Icon: UserIcon,
    tone: 'blue',
  },
  commentMentioned: {
    label: 'Mentions',
    description: 'When someone mentions you in a comment',
    Icon: MentionIcon,
    tone: 'violet',
  },
  dueReminder: {
    label: 'Due date reminders',
    description: 'The day before a card assigned to you is due',
    Icon: CalendarIcon,
    tone: 'red',
  },
  workspaceInvited: {
    label: 'Workspace invitations',
    description: 'When you are invited to a workspace',
    Icon: MailIcon,
    tone: 'indigo',
  },
  membershipChanged: {
    label: 'Membership changes',
    description: 'When you are added to a board or your access changes',
    Icon: UsersIcon,
    tone: 'green',
  },
  boardInvited: {
    label: 'Board invitations',
    description: 'For future board invitations',
    Icon: ColumnsIcon,
    tone: 'teal',
    // P4-04 reserves the kind; nothing creates it yet.
    note: 'Not sent yet — boards add members directly today',
  },
};
const IN_APP_ORDER: InAppKey[] = [
  'cardAssigned',
  'commentMentioned',
  'dueReminder',
  'workspaceInvited',
  'membershipChanged',
  'boardInvited',
];
const emailRows: Record<EmailKey, string> = {
  cardAssigned: 'Card assignments',
  commentMentioned: 'Mentions',
  dueReminder: 'Due date reminders',
};

export function NotificationSettingsPage() {
  usePageTitle('Notification preferences');
  const preferences = useNotificationPreferences();
  const { generation } = useAuthSession();
  return (
    <div className="notification-settings">
      <PageHeader
        title="Notification Preferences"
        description="Choose what notifications you want to receive."
      />
      {preferences.isError ? (
        <div className="notification-settings-card mt-5 space-y-3">
          <Alert variant="error">
            Could not load your notification preferences.
          </Alert>
          <Button
            variant="secondary"
            onClick={() => void preferences.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : !preferences.preferences ? (
        <p role="status" className="mt-5 text-sm text-muted">
          Loading your notification preferences…
        </p>
      ) : (
        <PreferencesForm key={generation} saved={preferences.preferences} />
      )}
    </div>
  );
}

function PreferencesForm({ saved }: { saved: NotificationPreferences }) {
  const update = useUpdateNotificationPreferences();
  const [draft, setDraft] = useState(saved);
  const [notice, setNotice] = useState<'saved' | 'error'>();
  const patch = preferencesPatch(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const emailReady = env.taskEmailEnabled;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || update.isPending) return;
    setNotice(undefined);
    update.mutate(patch, {
      // Reconcile from the full server result, not from the local draft.
      onSuccess: (result) => {
        setDraft(result);
        setNotice('saved');
      },
      onError: () => setNotice('error'),
    });
  };

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-4">
      {notice === 'saved' && !dirty && (
        <Alert variant="success">Notification preferences saved.</Alert>
      )}
      {notice === 'error' && (
        <Alert variant="error">
          Could not save your preferences. Your changes are still here; try
          again.
        </Alert>
      )}
      <fieldset
        className="notification-settings-card"
        disabled={update.isPending}
      >
        <legend className="sr-only">In-app notifications</legend>
        <div className="notification-settings-head">
          <h2>In-app notifications</h2>
          <p>These notifications appear in Kanvexa.</p>
        </div>
        <ul className="notification-settings-grid">
          {IN_APP_ORDER.map((key) => {
            const row = inAppRows[key];
            return (
              <li key={key}>
                <PreferenceSwitch
                  id={`in-app-${key}`}
                  label={row.label}
                  description={row.note ?? row.description}
                  Icon={row.Icon}
                  tone={row.tone}
                  checked={draft.inApp[key]}
                  onChange={(value) => {
                    setNotice(undefined);
                    setDraft((current) => ({
                      ...current,
                      inApp: { ...current.inApp, [key]: value },
                    }));
                  }}
                />
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset
        className="notification-settings-card"
        disabled={update.isPending || !emailReady}
        aria-describedby="email-channel-status"
      >
        <legend className="sr-only">Email notifications</legend>
        <div className="notification-settings-head">
          <h2>Email notifications</h2>
          <p id="email-channel-status">
            {emailReady
              ? 'Optional task emails. Delivery is best effort; your choice is saved either way.'
              : 'Task email is not turned on for this Kanvexa server yet, so these switches are unavailable.'}
          </p>
        </div>
        <ul className="notification-settings-grid">
          {EMAIL_KEYS.map((key) => (
            <li key={key}>
              <PreferenceSwitch
                id={`email-${key}`}
                label={emailRows[key]}
                Icon={inAppRows[key].Icon}
                tone={inAppRows[key].tone}
                checked={draft.email[key]}
                onChange={(value) => {
                  setNotice(undefined);
                  setDraft((current) => ({
                    ...current,
                    email: { ...current.email, [key]: value },
                  }));
                }}
              />
            </li>
          ))}
          <li>
            <div className="notification-setting" data-static>
              <span
                className="notification-icon"
                data-tone="muted"
                aria-hidden="true"
              >
                <ShieldCheckIcon />
              </span>
              <span className="notification-setting-text">
                <span className="notification-setting-label">
                  Security and account
                </span>
                <span className="notification-setting-description">
                  Password, sign-in and verification emails are always sent.
                </span>
              </span>
              <span className="notification-setting-always">Always on</span>
            </div>
          </li>
        </ul>
      </fieldset>

      <div className="flex justify-end gap-3">
        <Button
          variant="secondary"
          disabled={!dirty || update.isPending}
          onClick={() => {
            setDraft(saved);
            setNotice(undefined);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
      <UnsavedChangesGuard
        when={dirty && !update.isPending}
        description="Your notification preference changes have not been saved."
      />
    </form>
  );
}

function PreferenceSwitch({
  id,
  label,
  description,
  Icon,
  tone,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  Icon: (props: IconProps) => React.JSX.Element;
  tone: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="notification-setting" htmlFor={id}>
      <span className="notification-icon" data-tone={tone} aria-hidden="true">
        <Icon />
      </span>
      <span className="notification-setting-text">
        <span className="notification-setting-label">{label}</span>
        {description && (
          <span
            id={`${id}-description`}
            className="notification-setting-description"
          >
            {description}
          </span>
        )}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        onChange={(event) => onChange(event.target.checked)}
        className="notification-switch"
      />
    </label>
  );
}
