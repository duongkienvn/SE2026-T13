# Task Documentation

Tài liệu task được chia theo phần chịu trách nhiệm để dễ tìm và review:

- [`backend/`](backend/) chứa API, persistence, authorization và realtime phía
  server.
- [`frontend/`](frontend/) chứa UI, client integration, responsive behavior và
  realtime phía trình duyệt.

Các task records ghi lại phạm vi, quyết định và kết quả tại thời điểm thực hiện;
không phải danh sách trạng thái release hiện tại. Xem [project overview](../project-overview.md)
cho MVP đã triển khai và [Post-MVP roadmap](../roadmap/post-mvp.md) cho phạm vi
đã duyệt tiếp theo. Mục lục dưới đây liệt kê toàn bộ task documents hiện có.

## Quy tắc đặt tài liệu

- Thư mục `docs/tasks/` chỉ chứa file `README.md` này. Không tạo task document
  trực tiếp ở thư mục gốc.
- Đặt tài liệu trong `backend/` khi phần chịu trách nhiệm chính là API, domain
  rules, authorization, persistence, migration, mail hoặc server-side realtime.
- Đặt tài liệu trong `frontend/` khi phần chịu trách nhiệm chính là UI, browser
  behavior, responsive/accessibility, client state hoặc frontend realtime.
- Với task liên quan cả hai phía, đặt một task record tại nơi có phần triển khai
  chính và liên kết tài liệu phía còn lại nếu cần; không nhân bản cùng một record.
- Dùng tên file kebab-case và cập nhật mục lục này cùng mọi liên kết khi tạo,
  di chuyển hoặc đổi tên tài liệu.

## Backend tasks

- [P5-03 Safe account deletion and identity erasure](backend/p5-account-deletion.md)

- [P5-02 Verified email change and identity security](backend/p5-secure-email-change.md)

- [P5-01 Authorized Board and Account Data Export](backend/p5-authorized-data-export.md)

- [STAB-01 Backend stabilization](backend/stab-01-backend-stabilization.md)

- [P4-05 Due reminders and task email](backend/p4-due-reminders-task-email.md)

- [P4-04 Notification events and comment mentions](backend/p4-notification-events-mentions.md)

- [P4-03 Persistent Notification Foundation](backend/p4-notification-foundation.md)

- [P4-02 ACL-safe Global Search backend](backend/p4-global-search.md)

- [P4-01 Cross-board My Tasks and Home API](backend/p4-my-tasks-home-api.md)

- [Board discovery and customization backend](backend/board-discovery-customization.md)

- [Phase 2 database integrity and deletion-policy audit](backend/phase2-database-integrity.md)
- [Phase 2 PostgreSQL schema inventory](backend/phase2-schema-inventory.md)
- [Board Member added email notification](backend/board-member-added-email.md)
- [Workspace activity API](backend/workspace-activity.md)
- [Authorized Workspace and Board member summaries](backend/workspace-authorized-member-counts.md)
- [Secure Workspace invitation decline](backend/workspace-invitation-decline.md)
- [ACL-safe Workspace Guests Directory API](backend/workspace-guests-directory-api.md)
- [Workspace policies, Board move and deletion](backend/workspace-policies-board-move.md)
- [Board visibility, authorization and realtime access enforcement](backend/board-visibility-access-control.md)
- [Workspace invitation email delivery](backend/workspace-invitation-email-delivery.md)
- [Workspace members, roles and secure invitations](backend/workspace-members-invitations-api.md)
- [Core Workspace API and access-scoped queries](backend/workspace-core-api.md)
- [Workspace data foundation and legacy Board migration](backend/workspace-data-foundation.md)

- [Backend foundation](backend/backend-foundation-pr-description.md)
- [Authentication](backend/backend-authentication.md)
- [Registration password policy](backend/auth-registration-password-policy.md)
- [Email verification](backend/email-verification.md)
- [Google Sign-In and account linking](backend/google-auth-account-linking.md)
- [User preferences API and persistence](backend/user-preferences.md)
- [Private profile avatar uploads](backend/profile-avatar-upload.md)
- [Password recovery and account security](backend/password-recovery-security.md)
- [Verification email layout](backend/verification-email-layout.md)
- [Welcome email and new user onboarding](backend/welcome-email-onboarding.md)
- [Board management API](backend/board-management-api.md)
- [Board archive management](backend/board-archive-management.md)
- [Board members management](backend/board-members-management.md)
- [Column management API](backend/column-management-api.md)
- [Board Card filtering and preview summaries](backend/board-card-filtering.md)
- [Card management API](backend/card-management-api.md)
- [Same-Board Card duplicate API](backend/card-duplicate.md)
- [Advanced Card start/due dates](backend/card-advanced-dates.md)
- [Card attachment foundation](backend/card-attachments-foundation.md)
- [Secure private Card file attachments](backend/private-card-attachments.md)
- [Card checklists backend](backend/card-checklists.md)
- [Board-scoped labels and Card associations](backend/board-card-labels.md)
- [Archived cards management and restore](backend/card-archive-restore.md)
- [Realtime foundation](backend/realtime-foundation.md)
- [Realtime board events](backend/realtime-board-events.md)
- [Board presence backend](backend/board-presence.md)
- [Comments API](backend/comments-api.md)
- [Comment realtime synchronization](backend/comment-realtime.md)
- [Activity core and read API](backend/activity-core.md)
- [Activity integration with business mutations](backend/activity-integration.md)

## Frontend tasks

- [Phase 5 Board views and global UI polish](frontend/p5-board-views-ui-polish.md)

- [P5-05 Table View](frontend/p5-table-view.md)

- [P5-04 Calendar View](frontend/p5-calendar-view.md)

- [STAB-02 Frontend stabilization and Home Dashboard V2](frontend/stab-02-frontend-stabilization.md)

- [P4-10 Comment @Mentions UI and Safe Rendering](frontend/p4-comment-mentions-ui.md)

- [P4-08 Global Search UI](frontend/p4-global-search-ui.md)
- [P4-09 Notification Center, Bell and Preferences UI](frontend/p4-notifications-ui.md)

- [P4-07 Home Dashboard UI](frontend/p4-home-dashboard-ui.md)

- [P4-06 My Tasks UI](frontend/p4-my-tasks-ui.md)

- [Final landing page and password recovery polish](frontend/landing-auth-final-polish.md)

- [Card Detail V2 visual and UX polish](frontend/card-detail-v2-polish.md)

- [Final Kanban Board UI refinement](frontend/final-kanban-ui-refinement.md)

- [Final Board layout and full Kanban canvas](frontend/full-kanban-canvas.md)

- [Board filtering and Card preview V2](frontend/board-filtering-card-preview-v2.md)

- [Board discovery and customization UI](frontend/board-discovery-customization-ui.md)
- [Board and Card visual polish](frontend/board-card-visual-polish.md)

- [Workspace Overview visual redesign](frontend/workspace-overview-redesign.md)

- [Board Navigation & Settings UX Polish](frontend/board-navigation-settings-polish.md)

- [Board Settings and Board UX V2](frontend/board-settings-ux-v2.md)

- [Auth V2 reference refinement and home-logo navigation](frontend/auth-v2-reference-refinement.md)

- [Auth pages redesign — Forward, together](frontend/auth-pages-redesign.md)

- [Card Detail V2, safe duplicate and quick actions](frontend/card-detail-v2.md)
- [Card checklists and Board-scoped labels UI](frontend/checklists-labels.md)
- [Card attachments and advanced dates UI](frontend/card-attachments-advanced-dates.md)
- [Workspace UX, navigation and responsive polish](frontend/workspace-ux-navigation-polish.md)
- [Phase 2 access consistency and Board/invitation polish](frontend/p2-access-consistency-board-invitation-polish.md)
- [Board OWNER visibility and move actions from Board Detail](frontend/board-owner-actions-detail.md)
- [ACL-scoped Workspace Guests tab](frontend/workspace-guests-directory-ui.md)
- [Workspace frontend API integration](frontend/workspace-api-integration.md)
- [Workspace Shell, Navigation and Overview UI V1](frontend/workspace-shell-overview.md)
- [Workspace Boards UI V1, Filters and Create Board](frontend/workspace-boards-ui.md)
- [Workspace Members, Guests and Invitations UI V1](frontend/workspace-members-invitations-ui.md)
- [Workspace Settings, policies and safe management UI V1](frontend/workspace-settings-ui.md)
- [Frontend application foundation](frontend/frontend-foundation.md)
- [Kanvexa branding](frontend/kanvexa-branding.md)
- [Frontend authentication](frontend/frontend-auth.md)
- [Cross-tab authentication](frontend/cross-tab-authentication.md)
- [Authentication integration with the real backend](frontend/frontend-auth-integration.md)
- [Google Sign-In UI polish](frontend/google-sign-in-ui-polish.md)
- [Frontend compact layout](frontend/frontend-compact-layout.md)
- [Boards and board members frontend](frontend/boards-frontend.md)
- [Kanban board UI](frontend/kanban-board-ui.md)
- [Card permalinks and route-linked detail](frontend/card-permalinks.md)
- [Realtime frontend synchronization](frontend/realtime-frontend.md)
- [Board presence frontend](frontend/board-presence.md)
- [Card comments UI](frontend/comments-ui.md)
- [Activity History frontend](frontend/activity-history.md)
- [Sidebar navigation and board creation UX](frontend/app-navigation-board-ux.md)
- [Public landing page](frontend/public-landing-page.md)
- [App Shell V2 and responsive navigation](frontend/app-shell-v2.md)
- [Account Settings, Appearance and Preferences](frontend/account-settings-appearance.md)

## Quy ước

- Không đặt screenshot trong `docs/tasks/`. Ảnh thiết kế mẫu nằm trong
  [`../design/screens/reference/`](../design/screens/reference/); ảnh chụp giao
  diện thực tế nằm trong
  [`../design/screens/implementation/<task-slug>/`](../design/screens/implementation/).
- Tài liệu task frontend liên kết tới ảnh implementation bằng relative path để
  link hoạt động trên GitHub và trong editor.
- Khi di chuyển hoặc đổi tên task, phải cập nhật mọi liên kết trong repository
  và chạy format/link checks trước khi commit.
