import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Pagination } from '../../../components/Pagination';
import { TextField } from '../../../components/TextField';
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  LinkIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '../../../components/icons';
import { isApiError } from '../../../lib/api-client';
import { formatRelativeTime } from '../../../lib/format';
import { useAuth } from '../../auth/useAuth';
import { useReportDirty } from '../card-draft';
import {
  CardDetailSection,
  sectionActionClass,
} from '../components/detail/CardDetailSection';
import {
  ACCEPTED_FILES,
  PREVIEWABLE_TYPES,
  readAttachmentFile,
  type Attachment,
} from './api';
import {
  attachmentErrorMessage,
  checkFile,
  useAddUrlAttachment,
  useAttachments,
  useAttachmentUpload,
  useRemoveAttachment,
  useUpdateAttachment,
  type UploadPhase,
} from './hooks';

const iconButton =
  'grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';

const PHASE_TEXT: Record<UploadPhase, string> = {
  idle: '',
  preparing: 'Preparing upload…',
  transferring: 'Uploading file…',
  verifying: 'Checking the file on the server…',
  done: 'Attached.',
  failed: 'Upload failed.',
};

/** HTTPS only, no credentials: matches the server rule, which is authoritative. */
export function safeHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

const TYPE_NAMES: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
  'text/plain': 'Text',
};

/** Fetches with the user's token and shows a short-lived in-memory URL. */
function ImagePreview({ attachment }: { attachment: Attachment }) {
  const { runAuthorized } = useAuth();
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const { id, boardId, cardId, revision } = attachment;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    runAuthorized((token) =>
      readAttachmentFile(token, { id, boardId, cardId }, controller.signal),
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [runAuthorized, id, boardId, cardId, revision]);
  if (failed)
    return <p className="text-[13px] text-danger">Preview unavailable.</p>;
  if (!url)
    return (
      <p role="status" className="text-[13px] text-muted">
        Loading preview…
      </p>
    );
  return (
    <img
      src={url}
      alt={attachment.displayName}
      className="max-h-64 max-w-full rounded-lg border border-line object-contain"
    />
  );
}

function AttachmentEditForm({
  attachment,
  pending,
  onSave,
  onCancel,
}: {
  attachment: Attachment;
  pending: boolean;
  onSave: (input: { displayName?: string; url?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(attachment.displayName);
  const [url, setUrl] = useState(attachment.url ?? '');
  const [error, setError] = useState<string>();
  useReportDirty(
    name !== attachment.displayName ||
      (attachment.kind === 'URL' && url !== (attachment.url ?? '')),
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName || displayName.length > 120)
      return setError('Use a name of 1–120 characters.');
    if (attachment.kind === 'URL' && !safeHttpsUrl(url))
      return setError('Enter a link that starts with https://.');
    const input: { displayName?: string; url?: string } = {};
    if (displayName !== attachment.displayName) input.displayName = displayName;
    if (attachment.kind === 'URL' && url.trim() !== attachment.url)
      input.url = url.trim();
    if (Object.keys(input).length === 0) return onCancel();
    setError(undefined);
    try {
      await onSave(input);
    } catch (failure) {
      setError(attachmentErrorMessage(failure));
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="space-y-2 rounded-lg border border-line p-3"
    >
      <TextField
        label="Name"
        autoFocus
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      {attachment.kind === 'URL' && (
        <TextField
          label="Link"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
        />
      )}
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AttachmentRow({
  attachment,
  readOnly,
}: {
  attachment: Attachment;
  readOnly: boolean;
}) {
  const { runAuthorized } = useAuth();
  const update = useUpdateAttachment(attachment.boardId, attachment.cardId);
  const remove = useRemoveAttachment(attachment.boardId, attachment.cardId);
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  const [previewing, setPreviewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const isFile = attachment.kind === 'FILE';
  const previewable =
    isFile && PREVIEWABLE_TYPES.includes(attachment.mimeType ?? '');
  const link = attachment.url ? safeHttpsUrl(attachment.url) : null;
  const Icon = !isFile ? LinkIcon : previewable ? ImageIcon : FileIcon;
  const details = isFile
    ? [
        attachment.byteSize !== null && formatBytes(attachment.byteSize),
        TYPE_NAMES[attachment.mimeType ?? ''],
      ]
    : [link?.hostname];

  const download = async () => {
    setDownloading(true);
    setError(undefined);
    try {
      const blob = await runAuthorized((token) =>
        readAttachmentFile(token, attachment),
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.originalFilename ?? attachment.displayName;
      anchor.rel = 'noopener';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(attachmentErrorMessage(failure));
    } finally {
      setDownloading(false);
    }
  };

  if (mode === 'edit' && !readOnly)
    return (
      <li>
        <AttachmentEditForm
          attachment={attachment}
          pending={update.isPending}
          onCancel={() => setMode('view')}
          onSave={async (input) => {
            await update.mutateAsync({
              attachmentId: attachment.id,
              expectedRevision: attachment.revision,
              ...input,
            });
            setMode('view');
          }}
        />
      </li>
    );

  return (
    <li className="min-w-0 space-y-2 rounded-lg border border-line bg-surface p-2.5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-app text-muted"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          {link ? (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-ink hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span className="truncate">{attachment.displayName}</span>
              <ExternalLinkIcon
                aria-hidden="true"
                className="size-3.5 shrink-0"
              />
              <span className="sr-only">
                {' '}
                (opens {link.hostname} in a new tab)
              </span>
            </a>
          ) : (
            <p className="truncate text-sm font-medium text-ink">
              {attachment.displayName}
            </p>
          )}
          <p className="truncate text-xs text-muted">
            {[...details, formatRelativeTime(attachment.createdAt)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0">
          {previewable && (
            <button
              type="button"
              aria-expanded={previewing}
              aria-label={`${previewing ? 'Hide preview of' : 'Preview'} ${attachment.displayName}`}
              className={iconButton}
              onClick={() => setPreviewing((value) => !value)}
            >
              <ImageIcon aria-hidden="true" className="size-4" />
            </button>
          )}
          {isFile && (
            <button
              type="button"
              aria-label={`Download ${attachment.displayName}`}
              className={iconButton}
              disabled={downloading}
              onClick={() => void download()}
            >
              <DownloadIcon aria-hidden="true" className="size-4" />
            </button>
          )}
          {!readOnly && (
            <>
              <button
                type="button"
                aria-label={`Edit ${attachment.displayName}`}
                className={iconButton}
                onClick={() => setMode('edit')}
              >
                <PencilIcon aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${attachment.displayName}`}
                className={`${iconButton} hover:text-danger`}
                onClick={() => setMode('remove')}
              >
                <TrashIcon aria-hidden="true" className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>
      {downloading && (
        <p role="status" className="text-[13px] text-muted">
          Downloading…
        </p>
      )}
      {error && <Alert variant="error">{error}</Alert>}
      {previewing && <ImagePreview attachment={attachment} />}
      {mode === 'remove' && !readOnly && (
        <div
          role="group"
          aria-label={`Remove ${attachment.displayName}`}
          className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3"
        >
          <p className="text-sm text-ink">
            Remove “{attachment.displayName}” from this card?
          </p>
          {remove.isError && (
            <Alert variant="error">
              {attachmentErrorMessage(remove.error)}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate({
                  attachmentId: attachment.id,
                  expectedRevision: attachment.revision,
                })
              }
            >
              {remove.isPending ? 'Removing…' : 'Remove'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={remove.isPending}
              onClick={() => {
                remove.reset();
                setMode('view');
              }}
            >
              Keep
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function AddLinkForm({
  boardId,
  cardId,
  onDone,
}: {
  boardId: string;
  cardId: string;
  onDone: () => void;
}) {
  const add = useAddUrlAttachment(boardId, cardId);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  // One key per intended link, kept across retries so a lost response
  // cannot create a second copy.
  const key = useRef(crypto.randomUUID());
  useReportDirty(!!url.trim() || !!name.trim());

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (add.isPending) return;
    if (!safeHttpsUrl(url))
      return setError('Enter a link that starts with https://.');
    if (name.trim().length > 120)
      return setError('Use a name of at most 120 characters.');
    setError(undefined);
    try {
      await add.mutateAsync({
        url: url.trim(),
        displayName: name.trim() || undefined,
        idempotencyKey: key.current,
      });
      key.current = crypto.randomUUID();
      onDone();
    } catch (failure) {
      setError(attachmentErrorMessage(failure));
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="space-y-2 rounded-lg border border-line p-3"
    >
      <TextField
        label="Link"
        type="url"
        placeholder="https://"
        autoFocus
        value={url}
        onChange={(event) => {
          setUrl(event.currentTarget.value);
          key.current = crypto.randomUUID();
        }}
      />
      <TextField
        label="Name (optional)"
        value={name}
        onChange={(event) => {
          setName(event.currentTarget.value);
          key.current = crypto.randomUUID();
        }}
      />
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add link'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={add.isPending}
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * P3-10 attachments block: links and private files. Files are read only
 * through the authenticated API; images preview from in-memory URLs.
 */
export function CardAttachments({
  boardId,
  cardId,
  readOnly,
}: {
  boardId: string;
  cardId: string;
  readOnly: boolean;
}) {
  const [page, setPage] = useState(1);
  const query = useAttachments(boardId, cardId, page);
  const upload = useAttachmentUpload(boardId, cardId);
  const [adding, setAdding] = useState<'menu' | 'link' | null>(null);
  const [fileError, setFileError] = useState<string>();
  // Remembered for this card view once the server says storage is off.
  const [storageOff, setStorageOff] = useState(false);
  const filesUnavailable =
    storageOff || upload.state.code === 'ATTACHMENT_FILES_NOT_AVAILABLE';
  const fileInput = useRef<HTMLInputElement>(null);
  const meta = query.data?.meta;
  const items = query.data?.items ?? [];
  const uploading = ['preparing', 'transferring', 'verifying'].includes(
    upload.state.phase,
  );
  useReportDirty(uploading);

  useEffect(() => {
    if (meta && meta.totalPages > 0 && page > meta.totalPages)
      setPage(meta.totalPages);
  }, [meta, page]);
  useEffect(() => {
    if (upload.state.code === 'ATTACHMENT_FILES_NOT_AVAILABLE')
      setStorageOff(true);
  }, [upload.state.code]);

  const denied =
    isApiError(query.error) && [403, 404].includes(query.error.status);

  return (
    <CardDetailSection
      icon={<PaperclipIcon />}
      title="Attachments"
      meta={
        meta &&
        meta.total > 0 && (
          <span className="rounded-full bg-app px-2 text-xs font-medium text-muted">
            {meta.total}
          </span>
        )
      }
      action={
        !readOnly &&
        !adding && (
          <button
            type="button"
            className={sectionActionClass}
            aria-expanded={false}
            onClick={() => setAdding('menu')}
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            Add
            <span className="sr-only"> attachment</span>
          </button>
        )
      }
    >
      <div className="space-y-3">
        {!readOnly && adding === 'menu' && (
          <div className="flex flex-wrap gap-2 rounded-lg border border-line p-3">
            {!filesUnavailable && (
              <Button
                variant="secondary"
                size="sm"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                <FileIcon aria-hidden="true" className="size-4" />
                Upload file
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAdding('link')}
            >
              <LinkIcon aria-hidden="true" className="size-4" />
              Add link
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAdding(null)}
            >
              Cancel
            </Button>
            <p className="w-full text-[13px] text-muted">
              {filesUnavailable
                ? 'File uploads are not available on this server.'
                : 'PNG, JPEG, WebP, PDF or .txt, up to 10 MB. Files are private to people who can open this board.'}
            </p>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_FILES}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            const problem = checkFile(file);
            setFileError(problem);
            if (problem) return;
            setAdding(null);
            upload.start(file);
          }}
        />
        {fileError && <Alert variant="error">{fileError}</Alert>}
        {!readOnly && adding === 'link' && (
          <AddLinkForm
            boardId={boardId}
            cardId={cardId}
            onDone={() => setAdding(null)}
          />
        )}
        {upload.state.phase !== 'idle' && (
          <div className="space-y-2 rounded-lg border border-line p-3">
            <p role="status" className="text-sm text-ink">
              <span className="font-medium">{upload.state.fileName}</span>:{' '}
              {PHASE_TEXT[upload.state.phase]}
            </p>
            {upload.state.phase === 'failed' && upload.state.error && (
              <Alert variant="error">{upload.state.error}</Alert>
            )}
            <div className="flex gap-2">
              {uploading && (
                <Button variant="secondary" size="sm" onClick={upload.cancel}>
                  Cancel upload
                </Button>
              )}
              {upload.state.phase === 'failed' &&
                !readOnly &&
                !filesUnavailable && (
                  <Button size="sm" onClick={upload.retry}>
                    Try again
                  </Button>
                )}
              {['done', 'failed'].includes(upload.state.phase) && (
                <Button variant="secondary" size="sm" onClick={upload.reset}>
                  Dismiss
                </Button>
              )}
            </div>
          </div>
        )}
        {query.isPending ? (
          <p role="status" className="text-sm text-muted">
            Loading attachments…
          </p>
        ) : query.isError && !query.data ? (
          <Alert variant="error">
            {denied
              ? 'You no longer have access to this card’s attachments.'
              : 'We couldn’t load the attachments.'}{' '}
            {!denied && (
              <button
                type="button"
                className="font-medium underline"
                onClick={() => void query.refetch()}
              >
                Try again
              </button>
            )}
          </Alert>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">
            {readOnly ? 'No attachments.' : 'No attachments yet.'}
          </p>
        ) : (
          <ul
            aria-label="Attachments"
            className="grid grid-cols-1 gap-3 xl:grid-cols-2"
          >
            {items.map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                attachment={attachment}
                readOnly={readOnly}
              />
            ))}
          </ul>
        )}
        {meta && (
          <Pagination
            label="Attachment pages"
            page={page}
            pageCount={meta.totalPages}
            onChange={setPage}
          />
        )}
      </div>
    </CardDetailSection>
  );
}
