# Private avatar storage — manual preparation for #103

**ACTION REQUIRED BY USER.** These are reviewable instructions and policy files,
not applied infrastructure. No IAM/CORS/IMDS settings or production S3 upload has
been verified by this implementation. Production readiness requires the manual
checks below. Keep `AVATAR_STORAGE_DRIVER=disabled` until preparation is complete.

Bucket: `kanvexa-avatars-prod-338534047400-ap-southeast-1-an`, region
`ap-southeast-1`. Preserve Block **all** public access, Bucket owner enforced
(ACLs disabled), SSE-S3 and disabled versioning. No public-read ACL, website,
CloudFront, access keys in frontend, or disk uploads are needed.

## 1. Role and bucket controls

1. In IAM → Roles → **KanvexaEC2SSMRole**, inspect existing attached/inline
   policies. Add [role-policy.json](avatars/role-policy.json) as a separately
   named inline policy, e.g. `KanvexaPrivateAvatarsV1`, after confirming that name
   is unused. Preserve the role trust policy, instance profile and all SSM
   permissions. The runtime needs only GetObject, PutObject and DeleteObject on
   `avatars/v1/pending/*` and `avatars/v1/active/*` in this exact bucket. No
   ListBucket, ACL, bucket administration, KMS or STS permission is needed for
   SSE-S3 and this delivery design. Review any other policies that already grant
   broader S3 access; this additive policy cannot remove those grants.
2. In S3 → this bucket → Permissions → CORS, review and merge the array in
   [cors.json](avatars/cors.json). These are the production origin and the Vite
   dev origins used by this checkout. Do not add `*`; local `memory` mode does
   not use S3 CORS. A future dev-S3 exercise should use a separate private test
   bucket. The console accepts this array; CLI `put-bucket-cors` instead needs
   `{ "CORSRules": <this array> }`. Only POST is browser-direct. JWT image reads
   go to the API, so browser GET permission on S3 is unnecessary. CORS never
   grants authorization.
3. Merge [tls-bucket-policy.json](avatars/tls-bucket-policy.json) with any existing
   bucket policy after review. This is an explicit **Deny** on insecure
   transport, not an `s3:*` grant. It adds no public Allow statement. Retain
   existing required policy statements and Block Public Access.
4. In Management → Lifecycle, add the pending-prefix rule represented by
   [lifecycle.json](avatars/lifecycle.json). Merge, rather than replace, other
   bucket lifecycle rules. With versioning disabled, expiration permanently
   removes pending bytes. AWS performs expiration asynchronously; one day is
   not an exact wall-clock deletion promise. HTML POST is not S3 multipart
   upload; the abort action is only a defensive rule for incomplete multipart
   requests from other tools.

Never expire **all** `active/` objects: S3 cannot know which PostgreSQL pointers
are current. The backend's durable intent worker deletes unreferenced active
objects: sweep every five minutes, batch 50, reject expired in-flight work under
User/intent locks, then delete outside the transaction. First abandoned-intent
sweep is eligible after one hour; replacement/removal schedules the old intent
as soon as its five-minute lease ends. Failed deletes retry after five minutes;
successful sweeps revisit daily for seven days before pruning unreferenced intent
records. Current pointers are always preserved. If the app is down, active
cleanup waits for restart. Monitor backlog and failures; reconcile S3 inventory
against a protected DB export before any exceptional manual deletion.

See AWS [POST policy constraints](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html)
and [lifecycle semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).

## 2. Backend configuration and credential verification

Add these non-secret values to protected `/etc/kanvexa/production.env` (0600),
using the rollout procedure below:

```dotenv
AVATAR_STORAGE_DRIVER=s3
AVATAR_S3_BUCKET=kanvexa-avatars-prod-338534047400-ap-southeast-1-an
AVATAR_S3_REGION=ap-southeast-1
AVATAR_S3_PREFIX=avatars/v1
```

Compose passes these only to the backend. No frontend build variable or
production `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` is required. The AWS SDK
v3 uses its default credential provider chain and the EC2 instance role.
Keep home-directory AWS credential files and static keys out of this container.
Never paste credential endpoints, POST fields, signed URLs, JWTs or headers into
logs/issues. S3 object writes explicitly use SSE-S3 (`AES256`).

Limits are fixed server contracts, not unvalidated env overrides: 5 MiB input,
16×1024×1024 decoded pixels, each dimension 16–8192, square WebP up to 512px,
60-second POST, five-minute intent. Normalization runs at most two jobs per
process with one libvips thread and a 16 MiB native cache. Keep HTTP/DB quotas
in place and load-test the 512 MiB backend container on the actual EC2 before
increasing these limits.

**ACTION REQUIRED BY USER — actual EC2 container test:** the repository backend
uses Node **22.23.4 Debian Bookworm slim**, not Alpine. Its Dockerfile exercises
native Sharp/libvips encoding in the final non-root stage. This does not prove
EC2 metadata access. In EC2 console, inspect the serving instance's Metadata
options: endpoint enabled, tokens **required** (IMDSv2), and the attached instance
profile contains `KanvexaEC2SSMRole`. Test the default SDK provider from the actual
backend container after rollout, using an authorized SSM Bash session:

```bash
cd /opt/kanvexa
docker compose --env-file /etc/kanvexa/production.env -f compose.prod.yml exec -T backend node <<'NODE'
const assert = require('node:assert/strict');
const { S3Client } = require('@aws-sdk/client-s3');
(async () => {
  assert(!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SECRET_ACCESS_KEY);
  const base = 'http://169.254.169.254/latest/';
  const tokenResponse = await fetch(base + 'api/token', {
    method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' },
    signal: AbortSignal.timeout(3000),
  });
  assert(tokenResponse.ok);
  const metadataToken = await tokenResponse.text();
  const roleResponse = await fetch(base + 'meta-data/iam/security-credentials/', {
    headers: { 'X-aws-ec2-metadata-token': metadataToken },
    signal: AbortSignal.timeout(3000),
  });
  assert(roleResponse.ok);
  assert.equal((await roleResponse.text()).trim(), 'KanvexaEC2SSMRole');
  const client = new S3Client({ region: process.env.AVATAR_S3_REGION });
  try {
    const credentials = await client.config.credentials();
    assert(credentials.accessKeyId && credentials.sessionToken);
    assert(credentials.expiration > new Date());
    console.log('PASS IMDSv2 and SDK temporary role credentials (values hidden)');
  } finally { client.destroy(); }
})().catch(() => { console.error('FAIL credential chain; inspect metadata/network settings privately'); process.exitCode = 1; });
NODE
```

This check performs no S3 operation and prints no credential values. If IMDSv2
works on the host but times out in Docker, inspect the metadata response hop
limit and container routing/firewall. AWS documents that hop limit 1 can prevent
container access; the operator may need to review a change to **2**, retaining
tokens required and controlling which workloads can reach metadata. Do not
enable IMDSv1 or inject static keys as a workaround. This task does not change
AWS settings. See [AWS metadata options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html).

## 3. Migration, rollout and smoke checks

**ACTION REQUIRED BY USER — later approved release only.** Follow
[production deployment](production.md) and [CI/CD](cicd.md), retaining the host
deployment lock and production approval. No commands here were run on production.

1. Review policies/env and verify approved release images include Sharp, the new
   frontend and compiled migration `1793102400103-PrivateAvatars`. Use a protected
   database backup and rehearse restoration; preserve a compatible prior release
   and env snapshot. Stop frontend/backend traffic before the explicit migration.
2. Use the existing one-shot tool on the designated production DB, inside the
   normal locked release procedure (never on app startup):

   ```bash
   docker compose --env-file /etc/kanvexa/production.env -f compose.prod.yml run --rm migrate migration:show -d dist/database/data-source.js
   docker compose --env-file /etc/kanvexa/production.env -f compose.prod.yml run --rm migrate migration:run -d dist/database/data-source.js
   ```

   The additive migration retains legacy URLs and adds `avatar_object_key`,
   revision and durable intents. No external image download/backfill occurs.
   Deploy backend/frontend together, recreate the backend to apply env changes,
   and verify readiness and the credential check above. `synchronize` and
   `migrationsRun` remain false.

3. With a designated test account and non-sensitive photo, exercise native
   selection/preview/cancel, valid PNG/JPEG/WebP upload, refresh, change and
   remove. Only complete-upload success should change the persisted avatar.
   Display-name edits must survive an overlapping upload. Check header/sidebar,
   Board members, assignees, presence and comments/activity when those screens
   have real test data. Check mobile and dark mode.
4. Confirm an authorized shared-Board peer can load the API image, a user without
   a shared Board cannot, access removal makes reads fail, and anonymous S3 GET
   is denied. Verify invalid/animated/MIME-forged/>5 MiB files fail; expired or
   tampered POSTs fail; another user cannot complete an intent. Do not store or
   publish captured POST fields. Verify private/no-store and nosniff on API reads.
5. Verify old keys become inaccessible immediately after replace/remove and
   pending/orphan cleanup eventually removes bytes while current avatars survive.
   Monitor error rate, memory, cleanup backlog and S3 usage before declaring the
   rollout successful. Local tests cannot certify IAM/CORS or production behavior.

## 4. Rollback and cost controls

- Prefer a compatible forward fix with the additive schema retained. Emergency
  `AVATAR_STORAGE_DRIVER=disabled` plus backend recreation stops storage operations;
  managed images then fall back to initials while legacy external images remain.
  Disabling the driver does not erase DB pointers or S3 objects.
- Before any schema revert, stop writers, take protected DB/object-key exports,
  and let cleanup drain while the new code/schema still exist. The down migration
  **refuses** while any private pointer exists. Detaching/exporting those pointers
  requires an explicit operator data decision; do not bulk-clear user data merely
  to force rollback. A down migration drops intents/revisions and cannot restore
  photos or superseded legacy URLs; S3 is not rolled back. Keep cleanup records or
  a protected reconciliation export if objects remain. A compatible schema plus
  initials is safer than reverting to the old Avatar URL editor.
- Role policy adds no bucket-wide grant. Upload grants constrain one random key,
  MIME and exact byte size (≤5 MiB). At most three live intents/user and ten
  intents/user/15 minutes are enforced under DB locks, plus per-IP HTTP throttles.
  **Presigned POST is reusable until its 60-second expiry**; completion is
  revision-protected, but leaked grants can generate repeated S3 requests/overwrite
  pending bytes. CORS is not an abuse boundary. Limit account abuse and protect
  POST fields, monitor S3 request/egress/storage costs, and set operator-owned AWS
  budgets/alerts. Lifecycle/GC bound retained bytes, not request charges. There
  is no antivirus, distributed edge rate limit or CDN in this scoped feature.
