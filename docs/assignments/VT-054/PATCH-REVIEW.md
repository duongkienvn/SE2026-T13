# Policy PATCH review và GREEN

Prompt thực tế: “Triển khai tối thiểu mapper allowlist và retry predicate theo 12 tests RED, không đổi expected results. Không serialize raw row; failed errors dùng mã cố định.”

Patch: `toExportJobResponse` liệt kê 7 trường công khai, state mapping giữ nguyên; PENDING progress 0, COMPLETED 100, các trạng thái khác null. `canRetryExportJob` chỉ cho FAILED với attempts < 3 và expiry > clock hiện tại.

Review self-directed: Scope chỉ policy; design không có I/O/side effect, dễ đưa vào service; correctness giữ equality tại expiry là expired và không restart completed; evidence cùng 12 tests chạy lại không thay assertions. Kết quả: 12 passed/12, exit 0, 25.741s; log `evidence/green-policy.txt`. Chưa tích hợp API/job persistence; TC01 HTTP vẫn RED. Không gọi phần này là feature hoàn chỉnh hoặc chứng minh database uniqueness.

Nguy cơ còn lại: raw entity có private fields cần select hợp lý ở service; thời gian job phải kiểm tra tại database claim/commit; retry predicate unit không bảo vệ race nếu UPDATE thiếu điều kiện. Test PostgreSQL phải xác minh các điều kiện đó.
