# VT-054 mutation, coverage và quality experiments

## Response-field mapping mutation

Actual self-directed prompt: “Sau baseline xanh, đổi duy nhất mapping public response format từ row.format thành json trên nhánh/commit tạm; chạy lại cùng test CSV, ghi diff/log, quay về nhánh nộp và xác minh phục hồi. Không đổi expected value.”

- Correct baseline: `e30de97779db3dd89b151647dd0aad5d2da92885`; 12/12 pass, `evidence/mutation-baseline.txt`.
- Temporary branch: `assignment/23001908-vt054-mutation-fresh`; deliberate-bug commit `44f8c6f`.
- Mutation: `format: row.format` → `format: 'json'` inside the real API status mapper `toExportJobResponse`.
- Result **KILLED**: 1 failed / 11 passed; TC12 expected csv and received json (`evidence/mutation-mutant.txt`). This is one tested mutation, not a broad mutation score for the application.
- Patch preserved at `evidence/mutation-response-format.patch`. Feature branch restored by git switch; 12/12 pass (`evidence/mutation-restored.txt`), mapper diff empty. `git merge-base --is-ancestor 44f8c6f HEAD` returned 1; deliberate bug is not in submission branch history.
- No test change needed to kill this mutation. A surviving mutant was not invented for the report.

## Coverage interpretation

Policy Jest instrumentation: 100% lines / 100% branches (`evidence/coverage-policy/coverage-summary.json`). This only covers mapper/retry predicate.

A real HTTP/worker/load run was separately collected with Node V8 and converted using already-installed v8-to-istanbul and TypeScript source maps. Initial report (`evidence/coverage-integration.json`): service 95.72% lines / 90.24% V8 branches; worker 97.67% / 91.66%; controller 88.14% / 88.88%. V8 block branches and Jest boolean branches are different metrics. The controller includes old account/sync methods, not all executed by this harness. Uncovered lines are listed, not excluded with coverage-ignore comments. Additional service repeat coverage and risk analysis remain pending.

Important limitation: the first instrumented load run also overlapped a backend build and had request failures. Execution counts still describe code reached, but its latency is not a clean performance benchmark. Later performance experiments omit profiling/build overlap. Coverage does not prove database uniqueness; the dedicated concurrency and lease assertions are the relevant behavioral evidence.

## Performance investigation in progress

The executable workload submits 120 independent JSON exports of a synthetic empty Board with two simultaneous same-key POSTs each, real JWT/Nest/PostgreSQL, 1s polling and download validation. Five warm-up operations precede measurement. This is 120 logical tasks, not 120 independently authenticated people or large-Board production traffic.

| Run                                  | Success | Ack p95 ms | Completion p95 ms | Outcome                                    |
| ------------------------------------ | ------- | ---------- | ----------------- | ------------------------------------------ |
| Initial profiled + overlapping build | 116/120 | 5865.09    | 45719.43          | 4 connection refusals; both targets failed |
| Supertest without profiling          | 116/120 | 4867.38    | 32452.59          | 4 connection refusals; both targets failed |
| Native Node Fetch without profiling  | 117/120 | 4217.39    | 27626.38          | 3 fetch failures; both targets failed      |

Raw samples and environment are preserved in load-*.json/txt. No failed row was removed to make latency pass. Native transport did not eliminate failures, so blaming Supertest is unproven. The harness currently asserts both acknowledgement and completion p95 <=3500ms and retains failed results before throwing. Investigation/optimization is still required; no performance pass or >=95 score is claimed.

## Flaky checks và coverage tổng hợp

- Hai seed thứ tự Jest 23001908 và 54: mỗi lượt 2 suites/45 tests pass, không retry failed test. Các fixture clock/policy không dựa vào sleep, và assertions giữ nguyên. Logs `flaky-order-*.txt`.
- Ba lượt service integration độc lập: mỗi lượt tạo/drop database ngẫu nhiên, 7 groups pass; bao gồm 120 same-key starts, 120 same-job retries và latch điều khiển stale completion. Logs `flaky-concurrency-1..3.txt`. Đây là bằng chứng cho hazards timing/concurrency và order/shared state trong phạm vi đã chạy, không chứng minh suite không bao giờ flaky.
- Coverage V8 tổng hợp (load + 3 service repeats): service 97.43% lines / 94% branches; worker 97.67% / 91.66%; controller 88.14% / 88.88%; mapper 100% / 100%. Summary gốc giữ tại coverage-integration-initial.json; summary tổng hợp và uncovered lines tại coverage-integration.json. Service exhausted-retry error path và worker transient-error log vẫn chưa đi qua; policy exhausted retry đã có unit assertion nhưng không thay thế service integration cho nhánh đó. Các controller sync/account lines thiếu ở V8 run có unit regression riêng, không cộng số liệu hai công cụ để quảng cáo coverage chung.

## Đo tải với HTTP keep-alive và worker nhận việc liên tục

Giữ 120 thao tác đồng thời, hai POST cho mỗi thao tác, polling mỗi giây và kiểm tra download. Node HTTP Agent tái sử dụng tối đa 32 socket. Mỗi tác vụ bắt đầu đo trước khi chờ socket, nên số liệu gồm cả thời gian client xếp hàng. Cả hai lượt dùng cùng cấu hình socket, cùng Board rỗng, cùng giới hạn bốn worker và pool PostgreSQL 10. Không bật profiling.

| Workload                                  | Success | Ack p50 / p95 / max (ms)    | Completion p50 / p95 / max (ms) | Download p50 / p95 / max (ms)  |
| ----------------------------------------- | ------- | --------------------------- | ------------------------------- | ------------------------------ |
| Keep-alive, một job mỗi worker mỗi tick   | 120/120 | 1774.85 / 3127.22 / 3263.51 | 10011.56 / 15192.19 / 16286.67  | 10643.23 / 15366.13 / 16372.99 |
| Keep-alive, worker nhận job tiếp khi rảnh | 120/120 | 1680.41 / 2982.56 / 3195.11 | 8735.25 / 10825.70 / 10849.55   | 9010.28 / 11056.10 / 11086.74  |

Cả hai lượt có 120 hàng, 120 key, 120 completed và 120 attempts. Acknowledgement đạt 3500 ms. Completion chưa đạt. Giữ exit 1 từ assertion completion trong cả hai lượt. Một lần đo cho mỗi cấu hình chỉ cho thấy cải thiện quan sát được, chưa đủ để kết luận mức cải thiện ổn định.

Prompt test-first: “Dùng fake timer để xác minh scheduler xử lý 12 job ngay tick đầu và tối đa 4 claim đang chạy. Giữ clock, state và timeout xác định.” RED nhận 4 thay vì 12. GREEN pass cùng assertions. Review patch: bốn lane, tối đa 32 job mỗi lane mỗi vòng để sweep vẫn chạy, dừng nhận việc mới lúc shutdown. Lease, attempt, quyền và kết quả tải giữ các checks cũ. Logs worker-drain-red/green và load-keepalive-baseline/drain là bằng chứng.
