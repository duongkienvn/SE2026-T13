# Kanvexa — Project Overview

Kanvexa is an open-source collaborative Kanban web application available at [kanvexa.tech](https://kanvexa.tech). It brings personal and team Workspaces, shared Boards, detailed Cards and realtime collaboration into one browser application. Setup, technology versions and development commands are documented in the [root README](../README.md).

This document describes the implemented product and its architecture boundaries. Per-feature task records preserve the decisions and verification performed when each change was delivered; they do not prove that every optional provider is configured on a particular deployment.

## Product capabilities

| Area                 | Implemented capabilities                                                                                                                                                   | Implementation references                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and profile | Email verification, local and Google sign-in, explicit account linking, profile/avatar editing, password recovery/change and session invalidation                          | [Authentication](../apps/backend/src/api/auth/), [profile and account services](../apps/backend/src/api/users/)                                                             |
| Workspaces           | Personal and team Workspaces, discovery, Overview, Boards, Members, Guests, invitations, settings, policies, leave and guarded deletion                                    | [Workspace API](../apps/backend/src/api/workspaces/), [Workspace UI](../apps/frontend/src/features/workspaces/)                                                             |
| Boards               | Creation, membership, role-based access, private/Workspace-visible visibility, backgrounds, starred/recent discovery, archive/restore and Workspace moves                  | [Board services](../apps/backend/src/api/boards/), [Board UI](../apps/frontend/src/features/boards/)                                                                        |
| Views                | Kanban drag-and-drop, Calendar and Table views of the same authorized Board data, with direct Card links                                                                   | [Board routes](../apps/frontend/src/app/routes.tsx), [view components](../apps/frontend/src/features/boards/components/)                                                    |
| Cards                | Descriptions, assignees, checklists, labels, dates/reminders, filtering, duplicate, archive/restore and URL/private-file attachments                                       | [Card services](../apps/backend/src/api/cards/), [Card UI](../apps/frontend/src/features/cards/)                                                                            |
| Collaboration        | Authenticated realtime updates, transient presence, comments, mentions and Board/Workspace activity                                                                        | [Realtime](../apps/backend/src/realtime/), [comments](../apps/backend/src/api/comments/), [activity](../apps/backend/src/api/activities/)                                   |
| Productivity         | Home Dashboard, My Tasks, global search, in-app notifications and read controls                                                                                            | [Productivity](../apps/frontend/src/features/productivity/), [search](../apps/frontend/src/features/search/), [notifications](../apps/frontend/src/features/notifications/) |
| Settings and privacy | Light/dark/system themes, time zone/date/week preferences, notification settings, keyboard shortcuts, verified email change, JSON/CSV exports and guarded account deletion | [Settings routes](../apps/frontend/src/features/settings/sections.ts), [shortcuts](../apps/frontend/src/features/shortcuts/), [exports](../apps/backend/src/api/exports/)   |

Storage and delivery are configurable capabilities. Production file uploads require private S3 configuration and the attachment policy acknowledgement. Reminder jobs and task email are independently enabled; invitation mail needs the configured acceptance route. These controls do not imply unfinished application pages. See [deployment configuration](deployment/production.md) and [private attachments](deployment/private-card-attachments.md).

## Access and privacy

- Workspace roles are `ADMIN` and `MEMBER`. Board roles are separately `OWNER` and `MEMBER`; Workspace administration does not grant automatic access to private Boards.
- Workspace-visible Boards can grant eligible Workspace members read-only access without creating a Board membership. The server determines read, write and owner capabilities for every resource.
- Archived Boards are read-only; restore is an owner action. Card archive/restore preserves Card data and validates its Board/Column relationships.
- REST and Socket.IO authenticate the same account and enforce current access. Credential changes invalidate prior JWT versions and revoke old active socket receive grants in the current backend process.
- Browser caches, subscriptions and late request completions are scoped to the initiating session and authorized Board. Access loss removes protected data rather than leaving stale editable state.
- Board export requires current Board ownership. Account export is restricted to the caller's allowed metadata. Account deletion requires fresh proof and resolution of ownership blockers; shared work is retained with anonymized authorship.

See the [access blueprint](design/product-ux-blueprint.md), [Board authorization service](../apps/backend/src/api/board-members/board-authorization.service.ts) and the [account privacy record](tasks/frontend/p5-account-security-privacy-ui.md) for detailed rules.

## Domain vocabulary

| Concept                         | Responsibility                                                              |
| ------------------------------- | --------------------------------------------------------------------------- |
| `User`                          | Account, identity and personal preferences.                                 |
| `Workspace`                     | Personal or team grouping of Boards, memberships, invitations and policies. |
| `Board`                         | Collaborative work surface, visibility and settings.                        |
| `BoardMember`                   | Explicit Board membership and its role.                                     |
| `Column`                        | Ordered workflow stage within a Board.                                      |
| `Card` / `CardAssignee`         | Work item and its member assignments.                                       |
| Checklist, label and attachment | Card content and Board-scoped classification/file references.               |
| `Comment`                       | Discussion on a Card, including validated mentions.                         |
| `Activity`                      | Structured history of authorized business actions.                          |
| Notification                    | Recipient-specific event information and read state.                        |

Workspace is not another name for Board. A Card does not have a separate standalone completion checkbox; due states are derived from its dates, and workflow organization uses Columns.

## Architecture and code placement

- `apps/frontend`: React/TypeScript, Vite, routing/providers under `src/app/`, feature modules under `src/features/`, shared components under `src/components/` and tokens in `src/style.css`. TanStack Query owns server state; React owns local interaction state.
- `apps/backend`: NestJS modular monolith. Business services, DTOs and entities live under `src/api/<feature>/`; `src/realtime/` handles authenticated transport, access coordination and presence. File storage and mail integrations remain backend-only.
- `packages/shared`: shared contracts, types, enums and event names. It contains no TypeORM entities, business services or server credentials.
- PostgreSQL owns persistent business state. TypeORM uses Data Mapper repositories and explicit migrations, with `synchronize: false` and `migrationsRun: false`.
- REST handles initial loading, commands and queries. Socket.IO carries hints after commits and transient presence. Reconnects resynchronize with REST; events are not a durable replay log.
- The deployed topology is Caddy + NestJS + PostgreSQL on one EC2 host, with optional private S3 storage. Distributed realtime infrastructure is not part of the current architecture.

Read [system architecture](architecture/system-architecture.md), [frontend architecture](architecture/frontend-architecture.md), [backend architecture](architecture/backend-architecture.md) and [database design](architecture/database-design.md) for details.

## Main user flows

1. Sign up and verify an email, or sign in with Google. New accounts receive a Personal Workspace and the applicable starter Board onboarding; existing accounts are not backfilled with sample data.
2. Create or join a team Workspace, invite members and organize accessible Boards.
3. Open a Board in Kanban, Calendar or Table view; manage Cards according to the current access level. Other authorized viewers receive realtime hints and refresh the affected data.
4. Use Home, My Tasks, Search and Notifications to return to relevant work. Configure appearance, preferences and account security in Settings.
5. Export authorized data or complete the guarded account-deletion flow from Data & Privacy.

## Documentation map

| Documentation                                                          | Role                                                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [README](../README.md)                                                 | Public product introduction, local setup, development and deployment links.                         |
| [Architecture](architecture/system-architecture.md)                    | Current component boundaries, access and data flows.                                                |
| [Design index](design/README.md)                                       | Branding, visual specifications and the distinction between references and implementation captures. |
| [Task index](tasks/README.md)                                          | Historical implementation contracts and verification evidence, grouped by responsibility.           |
| [Original roadmap](roadmap/post-mvp.md)                                | Preserved planning and scope history; not a current feature-availability list.                      |
| [Deployment](deployment/production.md) and [CI/CD](deployment/cicd.md) | Operator configuration, explicit migrations, approvals, health checks and recovery.                 |

Historical milestones, older screenshots, planning documents and verification reports are retained in their original context. Use the current source and product overview for availability; use the relevant runbook and authorized deployment checks for the state of an individual installation.
