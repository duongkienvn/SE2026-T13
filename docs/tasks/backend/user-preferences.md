# P1-01 — User Preferences API & Persistence

Phase 1; AC-02 Appearance foundation and AC-03 Preferences foundation.
Backend contract for P1-05 Account Settings & Appearance. The approved
[roadmap](../../roadmap/post-mvp.md), [product blueprint](../../design/product-ux-blueprint.md)
and [settings specification](../../design/post-mvp/settings-notifications/ux-spec.md)
are consistent with these four fields; they did not define conflicting wire values.

## API contract for P1-05

Both endpoints require the existing Kanvexa bearer JWT. Identity comes exclusively
from `@CurrentUser().userId`; there is no account selector. A `userId` in PATCH is
an unknown field and fails validation. Query parameters cannot select another user.

| Field          | Accepted values                                  | Default      |
| -------------- | ------------------------------------------------ | ------------ |
| `theme`        | `light`, `dark`, `system`                        | `system`     |
| `timeZone`     | Node/ICU-recognized IANA name, maximum 100 chars | `UTC`        |
| `dateFormat`   | `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`         | `YYYY-MM-DD` |
| `weekStartsOn` | `monday`, `sunday`                               | `monday`     |

Enum values are case sensitive; accepted values are preserved verbatim. Timezone validation combines
the installed class-validator `IsTimeZone` (Node `Intl.DateTimeFormat`) with a
named-zone syntax check, so numeric offsets such as `+07:00` are rejected even on
Node versions that support offsets in Intl. `UTC`, `Asia/Ho_Chi_Minh`,
`America/New_York` and recognized IANA aliases are valid. Whitespace is not trimmed.
The frontend interprets `system` using OS/browser settings. These preferences do
not change UTC persistence or the existing Card `dueDate` API.

### Read

```http
GET /api/users/me/preferences
Authorization: Bearer <kanvexa-jwt>
```

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {
    "theme": "system",
    "timeZone": "UTC",
    "dateFormat": "YYYY-MM-DD",
    "weekStartsOn": "monday"
  }
}
```

GET returns saved values or all four defaults without inserting a row.

### Partial update

```http
PATCH /api/users/me/preferences
Authorization: Bearer <kanvexa-jwt>
Content-Type: application/json

{"theme":"dark","timeZone":"Asia/Ho_Chi_Minh"}
```

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Preferences updated",
  "data": {
    "theme": "dark",
    "timeZone": "Asia/Ho_Chi_Minh",
    "dateFormat": "YYYY-MM-DD",
    "weekStartsOn": "monday"
  }
}
```

Send 1–4 fields. Omitted fields retain saved values, or defaults on the first save.
An identical PATCH does not create a duplicate or update the timestamp. The
response always contains exactly the four public fields; IDs, relationships,
credentials and timestamps are excluded by response DTO serialization.

- `400 VALIDATION_FAILED`: empty object, JSON null, arrays, wrong types, field
  nulls, unknown keys, invalid enum values or invalid/overlong timezone. Express
  can reject JSON scalars before DTO validation; the exception filter normalizes
  400 responses specifically for this PATCH endpoint to the same validation code.
  After JWT authentication, a guard checks raw body keys before DTO transformation
  can discard `__proto__`, `constructor` or `prototype`. These keys also return
  validation errors without inserting or updating preferences.
- `401 UNAUTHORIZED`: missing, invalid, expired JWT, or a deleted/unverified
  account rejected by the existing JWT guard.
- `404 NOT_FOUND`: preferences service cannot find the authenticated account
  (including deletion between guard verification and service access).
- Existing throttling and sanitized unexpected-error conventions apply.

Frontend should save through PATCH, use the returned complete object, and reload
through GET after a new login. No preference data is added to profile/login
responses, and there are no new realtime events.

## Scope and decisions

- Facts: contracts reviewed on `origin/main` at `cea6d1c`; dedicated branch
  `feat/user-preferences-api`; existing JWT guard rejects deleted users with 401.
- Accepted scope: four preferences, backend/database/tests/Swagger/integration
  documentation only; no new dependency or shared package contract is needed yet.
- Assumption: recognize IANA identifiers/aliases supported by the deployed Node
  ICU database; no independent timezone catalog is introduced.
- Open product decisions: none for this contract. Production migration/deployment
  approval is separate and has not been requested or performed.
- Excluded: frontend/theme provider/localStorage, locale, notification preferences,
  security/session/token changes, workspace schema, Card date conversion.

Before merge, refresh main and resolve conflicts with P1-06 explicitly. No commit,
push, PR, merge or deploy is included in this handoff.
