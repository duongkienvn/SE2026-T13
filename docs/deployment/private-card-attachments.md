# Private Card Attachments: Manual AWS Runbook

This is an operator procedure for P3-06, **not an executed deployment**. Follow the
existing [production controls](production.md) and [CI/CD gates](cicd.md). Do not
run these steps without separate environment-specific authorization. Use synthetic
files in an isolated staging bucket first. The implementation and P3-10 client
guide are in [the task record](../tasks/backend/private-card-attachments.md).

## Review before enablement

Review and record owner/operator acceptance of the enforced V1 policy: 10 MiB per
file, 20 ACTIVE/PENDING slots per Card across URL/FILE, 100 MiB ACTIVE/PENDING
file bytes per Board, PNG/JPEG/WebP/PDF/TXT only. Images reserve 10 MiB until
normalization completes; documents reserve declared bytes. Review 15-minute
intents, 60-second POSTs, two concurrent completions per process, 16-million-pixel
images, one-hour cleanup grace and permanent daily tombstone resweeps. These are
implemented defaults; this document does not assert product-owner approval.

Decide retention/backup requirements, budget, abuse monitoring and capacity before
setting `ATTACHMENT_POLICY_ACK=v1`. Logical quotas do not bound temporary raw plus
verified plus cleanup-pending S3 bytes, or aggregate storage across Boards. There
is no global/owner byte quota, malware scanner, content disarm service or resumable
multipart upload. The strict PDF profile rejects some valid documents. Review
whether the resulting product behavior is acceptable before launch.

The current production guide describes a **512 MiB backend container**, including
native image allocations outside V8. Load-test two worst-case accepted raster
completions alongside avatar processing and normal requests; measure peak RSS,
CPU, latency and event-loop delay. Adjust authorized resource allocation or make
a separately reviewed policy change before enablement if headroom is inadequate.
This change does not alter Compose limits or production configuration.

## Bucket and object isolation

Manually prepare a dedicated general-purpose S3 bucket in the chosen Region,
separate from `AVATAR_S3_BUCKET`, with:

- All four Block Public Access settings enabled on the bucket and compatible
  account controls; no public policy, website hosting, public ACL or CDN origin.
  See [AWS Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html).
- Object Ownership **Bucket owner enforced**, ACLs disabled. The adapter never
  sends an ACL. See [AWS object ownership](https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html).
- Default SSE-S3 AES256 encryption. The POST policy and verified PUT explicitly
  require/send AES256. KMS keys and their IAM requirements are outside V1.
- **Never-versioned** bucket for V1. The adapter deletes by key, not version ID;
  a versioned/suspended bucket can retain historical bytes/delete markers and
  needs a separately reviewed version-retention/cleanup design. Do not enable
  Object Lock, replication, archival transition or retention that prevents the
  documented deletion semantics.
- A single stable prefix, e.g. `attachments/v1/pending/` and
  `attachments/v1/active/`. Only the backend may read either; browser grants can
  write only their exact pending key. Never expose pending bytes through GET.

Keep the bucket/Region/prefix stable once files exist. Database pointers use the
logical `attachments/v1/...` namespace, mapped to `ATTACHMENT_S3_PREFIX` at runtime.
Changing its mapping without a migration/copy/backup plan makes existing files
unavailable and can strand cleanup work. Do not reuse another feature's prefix.

## IAM: EC2 role, no application keys

Use the EC2 instance profile and the SDK default credential chain. Ensure the
backend container can reach IMDSv2 under the existing approved instance/container
network configuration. Do not introduce static `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, shared credentials files, custom S3 endpoints or frontend
AWS credentials. Remove conflicting inherited credential sources under the
operator's approved configuration process. Separate human provisioning rights
from the application's role.

The following **template** is the role's object-access policy. Replace
`ATTACHMENT_BUCKET` and the exact prefix for the authorized environment. It grants
no bucket listing, ACL, policy, lifecycle, versioning or bucket-admin operations.
If a shared EC2 role already accesses avatars, add only these scoped statements;
do not broaden an existing avatar resource to `*`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadAndDeletePrivateAttachmentObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::ATTACHMENT_BUCKET/attachments/v1/pending/*",
        "arn:aws:s3:::ATTACHMENT_BUCKET/attachments/v1/active/*"
      ]
    },
    {
      "Sid": "WriteEncryptedPrivateAttachmentObjects",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": [
        "arn:aws:s3:::ATTACHMENT_BUCKET/attachments/v1/pending/*",
        "arn:aws:s3:::ATTACHMENT_BUCKET/attachments/v1/active/*"
      ],
      "Condition": {
        "StringEquals": { "s3:x-amz-server-side-encryption": "AES256" }
      }
    }
  ]
}
```

Use a bucket policy to deny insecure transport and enforce immutable verified
writes. The following is an additive deny template, not a complete account policy.
Review interaction with existing organization policies and approved backup roles.
The `s3:if-none-match` condition applies **only to active**, since browser POST
must remain possible under pending. V1 uses single PutObject, not multipart/copy.
See [AWS conditional-write policy support](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::ATTACHMENT_BUCKET",
        "arn:aws:s3:::ATTACHMENT_BUCKET/*"
      ],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    },
    {
      "Sid": "DenyUnconditionalVerifiedWrites",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::ATTACHMENT_BUCKET/attachments/v1/active/*",
      "Condition": { "Null": { "s3:if-none-match": "true" } }
    }
  ]
}
```

No ListBucket is intentional. S3 can return 403 for a missing object without that
permission; the application safely returns sanitized storage-unavailable 503
rather than guessing whether access or existence failed. Do not grant listing
solely to change that error. See [AWS GetObject permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

## Browser POST CORS and pending lifecycle

Set exact authorized frontend origins. The example uses a placeholder, not a new
production hostname. Use localhost origins only in a separate development/staging
bucket. API JWT requests continue through the existing backend CORS configuration.
S3 needs no GET/HEAD CORS because all downloads go through the backend. The browser
must append the signed fields and file to FormData; encryption fields are form
fields rather than custom HTTP headers. See [AWS CORS elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html).

S3 console CORS JSON template:

```json
[
  {
    "AllowedOrigins": ["https://APPROVED_FRONTEND_ORIGIN"],
    "AllowedMethods": ["POST"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 300
  }
]
```

Create an expiration safety net for **pending only**, at one day. It complements
database cleanup and must never select active objects. Lifecycle deletion is
asynchronous and applies independently of application references; check the prefix
carefully. See [AWS lifecycle behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html).

Lifecycle JSON template:

```json
{
  "Rules": [
    {
      "ID": "ExpireUnverifiedAttachmentBytes",
      "Status": "Enabled",
      "Filter": { "Prefix": "attachments/v1/pending/" },
      "Expiration": { "Days": 1 }
    }
  ]
}
```

Never add age-based active expiration. Cleanup of verified objects must consult
PostgreSQL reference/lifecycle state. Preserve database cleanup ownership records
even after removal or hard deletion; do not run an S3 inventory purge as a shortcut.

## Backend configuration and rollout

These values are backend-only; never add `VITE_ATTACHMENT_*` or include them in
frontend bundles. `.env.example` stays disabled. Existing deployments remain
disabled when the new variables are absent.

| Variable                    | Value/constraint                                                      |
| --------------------------- | --------------------------------------------------------------------- |
| `ATTACHMENT_STORAGE_DRIVER` | `disabled` default; `memory` development/test only; `s3` after review |
| `ATTACHMENT_S3_BUCKET`      | Dedicated valid bucket, distinct from avatar bucket                   |
| `ATTACHMENT_S3_REGION`      | Bucket Region; default `ap-southeast-1`                               |
| `ATTACHMENT_S3_PREFIX`      | Stable safe isolated prefix; default `attachments/v1`                 |
| `ATTACHMENT_POLICY_ACK`     | Empty default; `v1` required to enable S3                             |

Invalid configuration fails startup. Production memory is rejected; test-mode
inherited S3 is forced disabled. `ATTACHMENT_ACCESS_KEY_ID`,
`ATTACHMENT_SECRET_ACCESS_KEY` and `ATTACHMENT_S3_ENDPOINT` are unsupported.

Operator rollout sequence:

1. Review the policy, IAM/bucket/CORS/lifecycle templates, capacity and restore
   requirements. Provision only in the separately authorized environment.
2. Take the approved database backup and record its matching bucket mapping.
   Rehearse `1794009600000-PrivateCardFiles` on a disposable restored database.
   It backfills declared bytes and increments legacy FILE revisions without
   inventing verification hashes. Legacy FILE downloads stay quarantined.
3. Run reviewed explicit migrations through the existing serialized deployment
   procedure. `synchronize:false` and `migrationsRun:false` remain unchanged.
4. Deploy with storage disabled first; verify normal URL attachments, auth, Card
   reads and disabled file errors. There is no automatic AWS setup at startup.
5. Set S3 variables and acknowledged policy in the protected backend environment,
   through the authorized deployment process. Restart the backend and perform
   staging tests below before considering production enablement.

## Staging verification with synthetic files

Use the P3-10 flow in the task record or authenticated HTTP tooling. Keep Bearer
tokens, POST fields/URLs, keys and response bodies out of terminal history/logs.
Record only test identifiers/results needed by the authorized release process.

1. Create a synthetic PNG/JPEG/WebP, simple supported PDF and UTF-8 TXT, obtain
   an intent, POST signed FormData, complete, list, authenticated download and
   delete. Confirm downloaded normalized images have stripped metadata and
   document downloads have safe filenames, no-store, nosniff and attachment headers.
2. Confirm raw bytes cannot be downloaded before completion, anonymous S3 GET is
   denied, altered key/MIME/size/signature and expired POST are rejected. Confirm
   CORS allows only the selected origin and no browser AWS credentials are used.
3. Reject SVG/HTML/executable, false MIME/extension, truncated raster/PDF, animated
   raster, oversized files and unsupported PDF features. Verification is not AV.
4. Check foreign Board/Card/other-uploader intent isolation, read-only viewers,
   PRIVATE Board exclusion, archive mutations, revoked membership and invalidated
   JWTs. Readers retain authorized archived downloads. Pending POST acceptance
   after revocation must never allow completion/publication.
5. Race intent reservations at the Card/Board limits, repeat the idempotency key,
   race two completions and cancel/delete during completion. Observe one ACTIVE
   transition and one minimal-ID post-commit event; retries must not duplicate it.
6. Restart after transfer and during verification. Simulate provider failure and
   database pre-commit failure **only in staging**; retry after lease expiry.
   Verify immutable collision recovery compares bytes and never overwrites.
7. Delete an attachment/Card/Board and verify durable cleanup after the one-hour
   grace, including a worker restart and failed-delete retry. Verify a currently
   referenced ACTIVE object survives cleanup. Observe completed-job resweep after
   its due time; do not shorten production grace or manipulate live timestamps.
8. Verify avatars and existing URL attachments remain independent, and denied
   AWS access yields sanitized 503 without successful completion metadata.

Real IAM/CORS/S3 staging behavior was **not** tested by this implementation task.
The adapter's local tests use mocked SDK/presigner calls only.

## Monitoring, recovery and rollback

The worker runs at backend startup and every five minutes, expiring up to 50
intents and processing up to 10 due jobs per sweep. Failures log a generic warning
and retain 5-minute to 1-hour retries; disabled mode pauses all work. Permanent
ownership tombstones resweep daily, including completed deletions. Monitor oldest
due work, non-completed backlog, attempts, expired PENDING age, process RSS,
processor-busy/storage 503s and S3 request/storage cost. Large populations of
referenced jobs and permanent tombstones require capacity review; automatic
history pruning is intentionally absent.

Example read-only database observations for an authorized operator (no keys or
filenames selected):

```sql
SELECT state, count(*)
FROM card_attachments WHERE kind = 'FILE' GROUP BY state;

SELECT count(*) AS due_jobs, min(next_attempt_at) AS oldest_due,
       max(attempts) AS highest_attempts
FROM card_attachment_cleanup_jobs
WHERE next_attempt_at <= now() AND not_before <= now();

SELECT count(*) AS expired_reservations
FROM card_attachments
WHERE kind = 'FILE' AND state = 'PENDING' AND expires_at <= now();
```

For a provider outage, stop new operations by switching to disabled through the
approved process. Existing metadata/URL operations remain, file access fails
safely, and cleanup pauses. Keep rows/jobs and restore provider access before
resuming the same bucket/prefix. Never delete a supposedly orphaned object before
checking current PostgreSQL references and ownership tombstones.

Before any database restore to an older snapshot, **stop uploads and the cleanup
worker across all instances**. Restore metadata and its matching verified objects
from coordinated backups before enabling cleanup: a restored reference could
otherwise point to an object legitimately deleted after the snapshot. Do not
change object identity or move a bucket/prefix ad hoc. Restore procedures and
retention must be rehearsed independently of this feature's local tests.

Prefer roll-forward. The migration refuses down with FILE rows or cleanup jobs;
do not truncate them to force rollback. Application rollback must preserve the
expanded schema and durable obligations, keep file storage disabled and retain a
compatible cleanup plan. Restoring a pre-feature application is not a deletion
strategy. Re-enable only after staging verification, including backlog recovery.
