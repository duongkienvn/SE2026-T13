# Kanvexa UI Design — MVP & Post-MVP

Thư mục `screens/` tách hai loại ảnh có mục đích khác nhau:

- [`screens/reference/`](screens/reference/) chứa các visual target đã được
  duyệt. Đây là baseline để triển khai giao diện, không phải ảnh chụp sản phẩm.
- [`screens/implementation/`](screens/implementation/) chứa ảnh kiểm chứng từ
  các task frontend đã hoàn thành. Các task tương ứng trong
  [`../tasks/frontend/`](../tasks/frontend/) giải thích behavior và phạm vi.

Đọc [`design-guidelines.md`](design-guidelines.md) trước khi triển khai hoặc
đánh giá frontend.

## Approved reference screens

| File                                                                       | Purpose                            |
| -------------------------------------------------------------------------- | ---------------------------------- |
| [`screens/reference/login.png`](screens/reference/login.png)               | Login screen                       |
| [`screens/reference/boards.png`](screens/reference/boards.png)             | Boards list                        |
| [`screens/reference/kanban-board.png`](screens/reference/kanban-board.png) | Board workspace                    |
| [`screens/reference/card-detail.png`](screens/reference/card-detail.png)   | Card detail modal                  |
| [`screens/reference/team-members.png`](screens/reference/team-members.png) | Board-member management appearance |

Reference screens có một số thành phần nằm ngoài MVP. Guidelines mô tả cách
giữ visual fidelity mà không tự ý mở rộng product scope.

## Implementation evidence

Mỗi thư mục con dưới `screens/implementation/` dùng cùng slug với tài liệu task
frontend. Ảnh mới phải được đặt tại đây, không đặt trong `docs/tasks/`.

## Post-MVP Design

Thiết kế Post-MVP mở rộng Kanvexa theo roadmap, bao gồm Workspace, Board/Card,
Home Dashboard, My Tasks, Notifications và Account Settings.

Đây là thiết kế và phạm vi đã duyệt cho giai đoạn tiếp theo. Trạng thái chức năng
đã triển khai được phân biệt riêng trong [project overview](../project-overview.md);
mockup Post-MVP không phải ảnh kiểm chứng MVP.

- [Product & UX Blueprint](product-ux-blueprint.md) mô tả cấu trúc sản phẩm,
  navigation và các quyết định tương tác đã duyệt.
- [Post-MVP design guidelines](design-guidelines.post-mvp.md) bổ sung hướng dẫn
  thiết kế cho các khu vực Post-MVP.
- [Visual reference register](post-mvp/visual-reference-register.md) ghi nhận
  các visual reference đã duyệt; mockup và UX spec tương ứng nằm trong
  [thư mục `post-mvp/`](post-mvp/).
- [Post-MVP roadmap](../roadmap/post-mvp.md) xác định phạm vi và các giai đoạn
  triển khai.

Các nguyên tắc áp dụng cho thiết kế và triển khai Post-MVP:

- Giữ nguyên branding và design system Kanvexa.
- Mockup Post-MVP đã duyệt là visual reference; chi tiết trong mockup không tự
  động bổ sung chức năng ngoài phạm vi đã duyệt.
- Hỗ trợ desktop/mobile và các theme Light/Dark/System.
- Không có Free Plan, Upgrade to Pro, pricing hay subscription.
- Không tự mở rộng phạm vi ngoài roadmap.
- Không làm ảnh hưởng chức năng MVP hiện tại.
