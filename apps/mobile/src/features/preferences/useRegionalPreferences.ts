import { useEffect, useRef, useState } from 'react';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client';
import {
  beginDraft,
  receiveDraft,
  regionalPatch,
  type RegionalDraft,
  type Patch,
} from './model';
import { usePreferences } from './usePreferences';
import { queryKeys } from '../../infrastructure/query/keys';
import type { Preferences } from './model';
export function useRegionalPreferences(identity: SessionIdentity) {
  const p = usePreferences(identity);
  const [form, setForm] = useState<RegionalDraft | null>(null),
    [notice, setNotice] = useState('');
  const latest = useRef(form),
    mounted = useRef(true);
  latest.current = form;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const saved = p.query.data;
    if (saved && !p.state.pending)
      setForm((previous) =>
        previous ? receiveDraft(previous, saved) : beginDraft(saved),
      );
  }, [p.query.data, p.state.pending]);
  const dirty =
    !!form && Object.keys(regionalPatch(form.saved, form.draft)).length > 0;
  const pending = p.state.pending;
  return {
    ...p,
    form,
    notice,
    dirty,
    pending,
    canSave: p.writable && !pending && dirty && !form?.conflict,
    edit(patch: Patch) {
      if (p.commands.getSnapshot().pending || p.state.uncertain) return;
      setNotice('');
      setForm(
        (previous) =>
          previous && { ...previous, draft: { ...previous.draft, ...patch } },
      );
    },
    cancel() {
      if (p.commands.getSnapshot().pending) return;
      setNotice('');
      setForm(
        (previous) => previous && beginDraft(p.query.data ?? previous.saved),
      );
    },
    acknowledge() {
      if (p.commands.getSnapshot().pending) return;
      setNotice('Your edits are kept. Save to apply only the changed fields.');
      setForm((previous) => previous && { ...previous, conflict: false });
    },
    async save() {
      const editing = latest.current;
      if (
        !editing ||
        !p.writable ||
        p.commands.getSnapshot().pending ||
        editing.conflict ||
        !dirty
      )
        return;
      const fresh = p.data.queryClient.getQueryData<Preferences>(
        queryKeys.datePreferences(identity),
      );
      let reconciled = editing;
      if (fresh) {
        reconciled = receiveDraft(editing, fresh);
        if (reconciled.conflict) {
          setForm(reconciled);
          return;
        }
      }
      const patch = regionalPatch(reconciled.saved, reconciled.draft);
      if (!Object.keys(patch).length) {
        setForm(beginDraft(reconciled.saved));
        setNotice('Your choices already match the latest server values.');
        return;
      }
      setNotice('');
      try {
        const result = await p.commands.save(patch);
        if (mounted.current && sameIdentity(identity, p.data.getIdentity())) {
          setForm(beginDraft(result));
          setNotice('Preferences saved.');
        }
      } catch {
        /* Retain all edits; command state supplies a safe error. */
      }
    },
  };
}
