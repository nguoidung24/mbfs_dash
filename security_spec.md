# Security Specification & Payload-First TDD (`dama2`)

## 1. Data Invariants
1. **Master Gate & Default Deny**: Mọi đường dẫn ngoài các collection đã khai báo đều bị từ chối tuyệt đối (`allow read, write: if false`).
2. **Identity Integrity & Email Verification**: Mọi thao tác ghi đều yêu cầu `request.auth != null && request.auth.token.email_verified == true`. Người dùng không thể tự gán vai trò `ADMIN`, `TRUONG_PHONG`, `PHO_PHONG` khi tạo mới hồ sơ (trừ Admin đã được bootstrap qua email xác thực hoặc user Admin trong CSDL).
3. **PII Isolation**: `email` và `phone` nằm trong `users/{userId}/private/info`; người dùng thông thường không đọc được PII của đồng nghiệp khác.
4. **Task Completion Lock & Role Segregation**: Chuyên viên (`assigneeId`) chỉ được cập nhật trạng thái làm việc và nộp kết quả (`DANG_THUC_HIEN`, `CHO_XAC_NHAN`), tuyệt đối bị từ chối nếu tự chuyển sang `HOAN_THANH` hoặc tự thay đổi `reviewResult = 'DA_HOAN_THANH'`, hoặc sửa công việc đã khóa (`isLocked == true`).
5. **WorkLog Date Lock (UTC+7)**: Không cho phép ghi log work vào ngày tương lai (`workDateNum > todayVN`). Không cho phép thêm/sửa/xóa log work của ngày quá khứ trừ khi tồn tại tài liệu mở khóa hợp lệ `workLogUnlocks/{userId}_{workDate}` do Admin hoặc Trưởng/Phó phòng tạo.
6. **Immutability & Temporal Integrity**: `createdAt` và `updatedAt` phải khớp `request.time`. Các trường gốc như `creatorId`, `userId` (trong `workLogs`), `departmentId` là bất biến sau khi tạo.
7. **Size & Regex Limits**: Mọi ID document phải khớp `^[a-zA-Z0-9_\-]+$` và `<= 128` ký tự; mọi trường string đều có giới hạn độ dài để chống tấn công phình dữ liệu.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Privilege Escalation on `users`**: Chuyên viên cố tình ghi `roles: ["ADMIN"]` vào hồ sơ cá nhân -> `PERMISSION_DENIED`.
2. **Shadow Field Injection on `tasks`**: Gửi kèm trường lạ `ghostAdminOverride: true` -> `PERMISSION_DENIED` (nhờ `keys().hasOnly(...)`).
3. **Unverified Email Spoofing**: Tài khoản có `email_verified: false` thực hiện ghi dữ liệu -> `PERMISSION_DENIED`.
4. **PII Blanket Read**: Chuyên viên A gọi `get` trên `users/usr_b/private/info` -> `PERMISSION_DENIED`.
5. **Specialist Self-Approval**: Chuyên viên cố gắng cập nhật `status: "HOAN_THANH"` và `reviewResult: "DA_HOAN_THANH"` trên task của chính mình -> `PERMISSION_DENIED`.
6. **Editing Locked Completed Task**: Người thực hiện sửa tiêu đề hoặc hạn của task có `isLocked == true` -> `PERMISSION_DENIED`.
7. **Future WorkLog Fraud**: Nhân sự ghi `workLog` cho ngày mai (`workDateNum > todayVN`) -> `PERMISSION_DENIED`.
8. **Past Locked WorkLog Tampering**: Nhân sự thêm/sửa/xóa `workLog` của ngày hôm qua khi chưa có `workLogUnlocks/{userId}_{workDate}` -> `PERMISSION_DENIED`.
9. **Unauthorized WorkLog Unlock**: Chuyên viên hoặc Trưởng nhóm tự tạo tài liệu trong `workLogUnlocks` -> `PERMISSION_DENIED`.
10. **Path Variable Poisoning**: Gửi document ID dài 1500 ký tự hoặc chứa ký tự đặc biệt `$..` -> `PERMISSION_DENIED`.
11. **Client Timestamp Spoofing**: Gửi `createdAt` lùi về quá khứ thay vì `serverTimestamp()` (`request.time`) -> `PERMISSION_DENIED`.
12. **Blanket Query Scraping**: Query `workLogs` của người khác khi không phải Admin/Lãnh đạo -> `PERMISSION_DENIED`.
