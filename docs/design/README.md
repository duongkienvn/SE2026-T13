# Kanban UI Design and Implementation Screens

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
