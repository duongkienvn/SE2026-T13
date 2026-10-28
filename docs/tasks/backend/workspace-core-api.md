# P2-02 — Core Workspace API and access-scoped queries

Phạm vi: backend WS-01/WS-04 trên nền P2-01; không triển khai Workspace UI,
invitation/member management (P2-03), WORKSPACE_VISIBLE grant (P2-04), policy/move
(P2-05), billing hoặc realtime authorization mới.

## Quyết định và tính tương thích

- Giữ riêng `WorkspaceRole.ADMIN/MEMBER` và Board `OWNER/MEMBER`. Theo
  [blueprint](../../design/product-ux-blueprint.md), cả hai Workspace role được
  tạo Board mặc định. ADMIN chỉ sửa Workspace metadata; không tự đọc Board PRIVATE.
- Workspace managed APIs yêu cầu Workspace membership. Board Guest vẫn truy cập
  Board/Card URL theo ACL hiện hành nhưng không được đọc Workspace context,
  overview hoặc danh sách Board của Workspace.
- Không thêm wire types vào shared khi frontend chưa sử dụng. Các identity/role
  P2-01 được tái sử dụng; DTO mới nằm trong backend. Presentation models frontend
  hiện có không phải wire DTO; P2-06/P2-07 cần adapter theo contract dưới đây.
- Tên Team không unique. Hai POST độc lập, kể cả cùng tên, tạo hai Team khác nhau;
  không tự retry POST sau lỗi kết nối không rõ commit. Chỉ ensure Personal và
  transaction đọc snapshot có retry an toàn.

## Routes và request

Tất cả dùng JWT Bearer, global validation/response/error conventions, rate limit
hiện hành và `Cache-Control: no-store` trên Workspace responses thành công.

| Method / route                              | Request                                     | Quyền / kết quả                                                                |
| ------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| GET `/api/workspaces`                       | `page`, `limit`                             | Paginated joined Workspace summaries; ensure Personal của caller trước khi đọc |
| GET `/api/workspaces/personal`              | Không                                       | Ensure/read Personal của caller, 200, idempotent kể cả nhiều tab               |
| GET `/api/workspaces/:workspaceId`          | UUID                                        | Workspace member, 200 detail cùng schema summary                               |
| POST `/api/workspaces`                      | CreateWorkspaceDto                          | Tạo TEAM + đúng một creator ADMIN trong transaction, 201                       |
| PATCH `/api/workspaces/:workspaceId`        | UpdateWorkspaceDto                          | ADMIN; selective patch, 200                                                    |
| GET `/api/workspaces/:workspaceId/boards`   | `page`, `limit`, `status`, `search`, `sort` | Workspace member; Board ACL được lọc trong SQL trước count/page                |
| GET `/api/workspaces/:workspaceId/overview` | Không                                       | Workspace member; counts và tối đa 5 recent Board đọc được                     |
| POST `/api/boards`                          | CreateBoardDto thêm `workspaceId?: uuid-v4` | Có ID: yêu cầu Workspace membership; không có ID: ensure Personal của caller   |

`CreateWorkspaceDto`: `name: string` (trim, 1–120 ký tự),
`description?: string | null` (trim, 0–2000 ký tự),
`icon?: 'briefcase' | 'users' | 'code' | 'palette' | 'layers' | null`.
Không nhận URL, SVG, binary, owner ID, type, role hay policy fields từ client.
Description/icon mặc định null. Icon là khóa biểu tượng; client dùng fallback
Workspace khi null. Giới hạn icon 16 ký tự; không có upload icon trong task này.

Update dùng cùng field validation, tất cả optional; phải gửi ít nhất một field.
`name: null` bị từ chối; `description: null` và `icon: null` xóa giá trị;
field vắng mặt được giữ nguyên. Unknown fields bị từ chối (400), kể cả policy.

Workspace list/Board list: `page` nguyên 1–1,000,000 (mặc định 1), `limit` nguyên
1–100 (mặc định 20); không nhận cursor. Workspace order `joinedAt ASC, membership
id ASC`. Board `status=active|archived` (mặc định active), `search` trim tối đa
120 ký tự, tìm tên không phân biệt hoa thường; `%`, `_`, `\` là ký tự literal,
không phải wildcard. `sort=updatedAt|createdAt|name` (mặc định updatedAt);
timestamps DESC + Board id DESC, name ASC + Board id ASC. Sort khác bị từ chối.
Offset pages xác định với cùng snapshot dữ liệu; khi dữ liệu thay đổi giữa hai
request, client cần tải lại trang. Page vượt dữ liệu trả `[]` và total thật.

CreateBoardDto vẫn giữ `name`/`description` như trước; `workspaceId` nếu gửi phải
là UUID hợp lệ, không nhận null. Server luôn gán creator từ JWT, visibility
PRIVATE và một Board OWNER trong cùng transaction với Workspace association.
Board response, ID, URL, archive/restore và Card permalink hiện có giữ contract.
Không move Board hiện hữu hoặc đổi visibility.

## Response schemas cho P2-06/P2-07

`WorkspaceResponseDto` (summary/detail):

| Field                    | Type / ý nghĩa                                          |
| ------------------------ | ------------------------------------------------------- |
| `id`, `type`, `name`     | UUID; PERSONAL/TEAM; tên thật                           |
| `description`, `icon`    | Chuỗi nullable theo validation trên                     |
| `role`                   | Workspace ADMIN/MEMBER của chính caller                 |
| `canManage`              | true chỉ khi ADMIN; hint UI, server vẫn kiểm tra        |
| `canCreateBoards`        | true cho Workspace member theo default policy hiện hành |
| `joinedAt`               | Timestamp membership của caller                         |
| `createdAt`, `updatedAt` | Timestamp Workspace                                     |

Timestamps response là ISO 8601 UTC. Không trả creator User, email, invitation,
member roster hay thông tin Board ẩn trong summary/detail.

`WorkspaceBoardResponseDto` tái sử dụng allowlist của `BoardResponseDto`:
`id`, `name`, `description`, `createdById`, `isArchived`, `archivedAt`, `createdAt`,
`updatedAt`, `currentUserRole` (Board OWNER/MEMBER), cộng `workspaceId`,
`visibility` (PRIVATE/WORKSPACE_VISIBLE), `canEdit` (false khi archived).
Không có members/presence/thumbnail/activity. `canEdit` chỉ mô tả khả năng cộng
tác Board; thao tác quản trị vẫn theo OWNER và các rule creator/last-owner.

P2-02 chỉ trả Board có direct Board membership, kể cả khi database có giá trị
WORKSPACE_VISIBLE. Chưa có actor read-only do Workspace visibility. P2-04 phải
cập nhật query grant, nullable Board role/capability contract và REST/Socket.IO
đồng bộ trước khi UI dùng visibility để mở Board.

`WorkspaceOverviewDto`:

- `workspace: WorkspaceResponseDto`.
- `visibleBoardCount`, `activeBoardCount`, `archivedBoardCount`: số nguyên chỉ
  tính Board caller có direct membership trong Workspace, gồm archive state thật.
- `memberCount: number | null`: count Workspace members chỉ cho ADMIN; MEMBER
  nhận null (không được phép), không phải 0. Không trả roster/Guest/invitations.
- `recentBoards: WorkspaceBoardResponseDto[]`: tối đa 5, gồm active/archived;
  `Board.updatedAt DESC, id DESC`. Timestamp này là cập nhật bản ghi Board,
  không phải last-viewed, thời điểm hoạt động Card hay productivity metric.

Ví dụ request `GET /api/workspaces/:id/boards?status=active&limit=20` khi không
có Board đọc được:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Create example: `POST /api/workspaces` với
`{"name":"Engineering","description":"Team boards","icon":"code"}`;
response 201 có `data.type="TEAM"`, `data.role="ADMIN"`, `data.canManage=true`.
Board create: `POST /api/boards` với `{"name":"Sprint","workspaceId":"<uuid>"}`;
response 201 vẫn là BoardResponseDto cũ, `currentUserRole="OWNER"`.
Single responses dùng `{success:true,statusCode,message,data}`; list thêm meta.

## Errors, phiên đăng nhập và concurrency

Error envelope: `{success:false,statusCode,code,message,timestamp,path,details?,requestId?}` theo
global filter. JWT thiếu/hết hạn/invalidated hoặc User đã bị xóa: 401 UNAUTHORIZED.
Input/UUID không hợp lệ: 400; DTO validation là VALIDATION_FAILED.
Workspace thiếu và nonmember/Board Guest cùng 404 NOT_FOUND, message
`Workspace not found`. MEMBER sửa metadata: 403 FORBIDDEN. FK/unique conflicts
được sanitize 409 theo global filter; rate limit 429; lỗi bất ngờ 500 không có
SQL/stack/credential. Không cache kết quả protected trong server.

Metadata writes khóa Workspace trước khi đọc/khóa membership; giữ grant tới
commit, merge các field patch trên bản ghi mới nhất để không mất concurrent
selective updates. Board creation khóa Workspace và membership trong transaction.
P2-03 nên giữ cùng thứ tự khóa Workspace → WorkspaceMember khi sửa/xóa grant.
Existing Board mutation locks và board-coordination/realtime không đổi.

Lists/overview dùng REPEATABLE READ cho data/count nhất quán; Board list/overview
khóa đọc Workspace grant tới commit. Serialization/deadlock do thay đổi grant được retry
tối đa 3 lần, chỉ cho transaction đọc. Board ACL được đánh giá trên snapshot DB
của request; việc revoke sau snapshot không thu hồi response đã đọc. Request kế
tiếp luôn kiểm tra lại DB. Không có server response cache hoặc temporary allow-all.
P2-03/P2-04 chịu trách nhiệm event invalidation/revocation mới; UI owners phải key
cache theo session/Workspace, xóa protected cache khi đổi phiên hoặc nhận 401/404,
và không render stale dữ liệu sau access loss.

UI handoff: pending → loading; 200 `[]`/count 0 → empty readable Boards dù Workspace
có thể chứa Board ẩn; không suy ra số Board ẩn. `memberCount=null` → không hiển
thị số thành viên. 401 → yêu cầu đăng nhập lại; 404 → Workspace unavailable cùng
trạng thái cho missing/nonmember; 403 write → bỏ quyền chỉnh sửa/refetch;
5xx/network → lỗi có retry. Không thêm fake data hoặc metric khi API thiếu dữ liệu.

## Migration và kiểm chứng

Migration `1793232000000-WorkspaceIcon`: thêm nullable `workspaces.icon varchar(16)`
với CHECK danh sách key; không backfill/move Board hay sửa IDs/timestamps.
Chạy migration rõ ràng trước bản app này (không auto-run). `down` xóa cột và mất
icon đã lưu; không chạy down khi chưa chủ động chấp nhận mất icon. Các metadata và
domain data khác được giữ. Không có migration production nào được chạy trong task.

Kiểm thử mới: `workspace-api.dto.spec.ts` và `workspace-api.integration.mjs` cùng
các scenario lifecycle/privacy/concurrency; PostgreSQL thật, app/JWT/controller/
validation/serialization thật. Script chỉ nhận local host +
`WORKSPACE_DATABASE_TESTS=local-only`, không đọc connection từ `.env`, tạo/drop
database ngẫu nhiên. Lệnh từ root: `pnpm --filter @kanban/backend test:workspace-api:database`
sau khi cấu hình explicit local test server và build shared.

## Kết quả kiểm tra tại checkout

Thực hiện trên Node 22.14.0, pnpm 10.18.3, PostgreSQL 16 trong container riêng
chỉ bind localhost. Mọi database fixture/migration đều nằm trong database ngẫu
nhiên, được drop ở cuối script; container test đã được dừng/xóa. Không dùng
database development/production, không commit/push/PR/deploy. Không thay đổi
frontend, shared contracts hoặc lockfile; dependency đã khai báo được cài lại
theo frozen lockfile để kiểm tra.

| Lệnh từ repository root                                               | Kết quả                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                           | PASS, cả lần cuối sau chỉnh sửa Swagger                                                                                                                                                                                                            |
| `pnpm build`                                                          | PASS toàn workspace; frontend có cảnh báo chunk lớn, không phải lỗi build                                                                                                                                                                          |
| `pnpm --filter @kanban/backend build`                                 | PASS sau thay đổi cuối                                                                                                                                                                                                                             |
| `pnpm --filter @kanban/backend test`                                  | PASS: 58 suites, 568 tests                                                                                                                                                                                                                         |
| `pnpm --filter @kanban/frontend test -- --maxWorkers=2`               | PASS: 92 files, 826 tests                                                                                                                                                                                                                          |
| `pnpm test`                                                           | FAIL ở lần chạy chung: frontend 8 failed/818 passed, chủ yếu timeout; chạy riêng tất cả frontend với 2 worker sau đó PASS. Shared 7/7 PASS; backend được chạy riêng đầy đủ như trên                                                                |
| `node apps/backend/test/workspaces/workspace-api.integration.mjs`     | PASS: actual HTTP/JWT/Swagger, Personal concurrency, TEAM lifecycle, ADMIN/MEMBER/Guest ACL, search/paging/counts, archive, Card permalink, SQL-failure rollback, grant-lock races, expiry/invalidation/deleted User, icon down/up và schema drift |
| `node apps/backend/test/workspaces/workspaces.integration.mjs`        | PASS: 18 nhóm kiểm tra P2-01, legacy backfill/bridge, migration rollback/retry, signup/provisioning/concurrency                                                                                                                                    |
| `node apps/backend/test/database/database-foundation.integration.mjs` | PASS: migration/schema/constraints, TypeScript/compiled discovery, offset/cursor pagination, rollback/reapply                                                                                                                                      |
| `node apps/backend/test/boards/boards.integration.mjs`                | PASS: persistence/OWNER/rollback, ACL, archive/restore, concurrency và real AppModule HTTP                                                                                                                                                         |
| `pnpm format:check`                                                   | FAIL ở repository: nhiều file ngoài phạm vi chưa theo Prettier; không format lại các file không liên quan                                                                                                                                          |
| Prettier `--check` trên toàn bộ file thay đổi                         | PASS                                                                                                                                                                                                                                               |
| `git diff --check` và local Markdown link/path checks                 | PASS                                                                                                                                                                                                                                               |

Trước khi dùng Node 22, lần thử Node 24 phát hiện script shared `node --test`
tự thu thập thêm file typecheck `.ts`, dẫn đến module-resolution failure của file
đó. Không sửa shared tests ngoài phạm vi; Node 22 cho kết quả 7/7 PASS.
Lần chạy test trong sandbox cũng bị EACCES localhost/cache; các kết quả PASS
ở trên là chạy lại với quyền localhost và cache trong workspace.

Phần triển khai: `WorkspaceApiModule` tách HTTP/JWT khỏi foundation module để
không tạo vòng dependency với Auth; controller/DTO/service lifecycle/query nằm
trong `apps/backend/src/api/workspaces/`. Board create dùng lại foundation grant
helper, transaction và Board DTO hiện hành. Migration nằm trong database/migrations;
test scenario chia theo lifecycle/privacy/concurrency. Tài liệu database và task
index đã được cập nhật.

Tự rà soát: input được parse/validate ở DTO boundary; response dùng allowlist;
quyền dùng helper chung; không thêm dependency, unchecked cast hay fallback quyền.
Các file production mới dưới 200 dòng logic; BoardsService hiện khoảng 219 dòng,
nên tách phần chịu trách nhiệm khi có yêu cầu mở rộng tiếp. Không refactor test
file cũ ngoài việc bỏ `workspaceId` khỏi fixture giả mạo vì đây đã là field hợp lệ.
Các thay đổi domain đều có regression checks. Không chạy visual QA vì không sửa UI;
không chạy production smoke/deployment hoặc các PostgreSQL suite domain không đổi.

Các kết quả này không chứng minh deployment hoặc trạng thái issue/PR. Migration
icon vẫn cần được chạy rõ ràng trong quy trình release trước khi chạy app mới.
