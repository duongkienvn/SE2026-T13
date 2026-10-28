import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { LayersIcon } from '../../../components/icons';
import { TextAreaField } from '../../../components/TextAreaField';
import { TextField } from '../../../components/TextField';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { useCreateTeamWorkspace } from '../hooks';
import { workspacePath } from '../navigation';

/** UI guardrails; reconcile with P2-02 validation before enabling production. */
export const WORKSPACE_FORM_LIMITS = { name: 100, description: 1000 };

export function CreateWorkspaceDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return open ? <CreateWorkspaceForm onClose={onClose} /> : null;
}

function CreateWorkspaceForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string>();
  const mutation = useCreateTeamWorkspace();
  const navigate = useNavigate();
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const noticeId = useId();
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const validate = () => {
    const error = !name.trim()
      ? 'Enter a workspace name.'
      : name.trim().length > WORKSPACE_FORM_LIMITS.name
        ? 'Use 100 characters or fewer.'
        : undefined;
    setNameError(error);
    return !error;
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) {
      focusFirstInvalid();
      return;
    }
    if (submitting.current || !mutation.available || !mutation.isCurrent())
      return;
    submitting.current = true;
    try {
      const workspace = await mutation.mutateAsync({
        name: name.trim(),
        description: description.trim(),
      });
      if (!mounted.current || !mutation.isCurrent()) return;
      onClose();
      void navigate(workspacePath(workspace.id));
    } catch {
      // Keep the draft. Error copy is independent of server internals.
    } finally {
      submitting.current = false;
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create a team workspace"
      description="Bring your team and boards together in one space."
      dismissible={!mutation.isPending}
    >
      <form
        ref={formRef}
        onSubmit={(event) => void submit(event)}
        noValidate
        className="space-y-5"
      >
        <div className="flex items-center gap-3 rounded-xl border border-line bg-app/50 p-3">
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-solid text-xl font-semibold text-white"
          >
            {name.trim().slice(0, 1).toLocaleUpperCase() || (
              <LayersIcon className="size-6" />
            )}
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">Workspace icon</p>
            <p className="mt-1 text-xs text-muted">
              Initial from your name. Custom icons coming soon.
            </p>
          </div>
        </div>
        <TextField
          label="Workspace name"
          placeholder="e.g. Design team"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(undefined);
          }}
          onBlur={validate}
          error={nameError}
          maxLength={WORKSPACE_FORM_LIMITS.name}
          required
          disabled={mutation.isPending}
          data-autofocus
        />
        <TextAreaField
          label="Description (optional)"
          placeholder="What will your team work on?"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={WORKSPACE_FORM_LIMITS.description}
          disabled={mutation.isPending}
          rows={3}
          hint={`${description.length}/${WORKSPACE_FORM_LIMITS.description} characters`}
        />
        {!mutation.available && (
          <p
            id={noticeId}
            role="status"
            className="rounded-lg border border-line bg-app p-3 text-sm leading-relaxed text-muted"
          >
            Team workspace creation is unavailable until Workspace services are
            connected. You can explore this form; nothing will be saved.
          </p>
        )}
        {mutation.isError && (
          <p
            role="alert"
            className="rounded-lg bg-danger/10 p-3 text-sm text-danger"
          >
            Could not create the workspace. Your details are still here. Please
            try again.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button
            size="lg"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="lg"
            disabled={!mutation.available || mutation.isPending}
            aria-describedby={!mutation.available ? noticeId : undefined}
          >
            {mutation.isPending
              ? 'Creating…'
              : mutation.available
                ? 'Create Workspace'
                : 'Create unavailable'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
