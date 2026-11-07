import { useState } from 'react';
import { Button } from '../../../components/Button';
import { TrashIcon } from '../../../components/icons';
import { DeleteAccountDialog } from './DeleteAccountDialog';

/** P5-08 account controls, appended below the P5-07 export sections. */
export function AccountDangerZone() {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="rounded-xl border border-danger/40 bg-danger/5 p-4 shadow-card md:px-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 gap-3.5 md:gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger md:size-11"
          >
            <TrashIcon className="size-5.5" />
          </span>
          <div className="min-w-0 space-y-1.5 text-sm text-muted">
            <h2
              id="danger-zone-heading"
              className="text-lg font-semibold text-danger"
            >
              Danger Zone
            </h2>
            <p>
              Deleting your account is irreversible. Your sign-in identity and
              private account data are removed. Shared boards, cards, comments
              and activity stay and appear as “Deleted user”.
            </p>
            <p>
              First move boards out of your Personal workspace and make sure
              another owner or admin is assigned to what you manage.
            </p>
          </div>
        </div>
        <Button
          variant="danger"
          size="lg"
          className="shrink-0 self-start lg:self-center"
          onClick={() => setOpen(true)}
        >
          Delete account
        </Button>
      </div>
      <DeleteAccountDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
