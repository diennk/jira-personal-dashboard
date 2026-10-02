# Jira Personal Dashboard

Dashboard cá nhân cho Jira Server / Data Center: tasks, bugs, sprint hiện tại, issue quá hạn, issue mình report / watch, issue đã xong gần đây.

Vite thuần + vanilla JS, không có backend riêng. Vite dev server đóng vai trò proxy tới Jira (Jira Server/DC không trả CORS header nên trình duyệt không gọi thẳng được).

## Yêu cầu

- Node.js 20+
- Yarn 4 (hoặc npm)
- Jira Server / Data Center có bật Personal Access Token (Jira 8.14+)

## Cài đặt & chạy

```bash
yarn install
cp .env.example .env   # tuỳ chọn, xem phần Cấu hình
yarn dev
```

Mở http://localhost:5190.

## Cấu hình

Có 2 cách, chọn một:

**1. Qua `.env` (khuyến nghị)** — token chỉ nằm trong Vite dev server, không xuống trình duyệt. Màn hình Settings bị ẩn.

| Biến | Mô tả |
|---|---|
| `JIRA_URL` | URL gốc của Jira, gồm cả context path nếu có, ví dụ `https://jira.fpt.com/home` |
| `JIRA_TOKEN` | Personal Access Token (Jira → Profile → Personal Access Tokens) |
| `JIRA_INSECURE` | `1` nếu Jira dùng chứng chỉ self-signed / CA nội bộ (tắt kiểm tra TLS cho cả dev server) |
| `PORT` | Cổng dev server, mặc định `5190` |

**2. Nhập trên màn hình** — để trống `JIRA_URL` / `JIRA_TOKEN`, app sẽ hiện form Connect. Token được gửi từ trình duyệt qua proxy tới Jira. Tick *Remember* sẽ lưu token dạng plain text trong `localStorage`; không tick thì chỉ giữ trong tab hiện tại (`sessionStorage`). Đổi / xoá qua nút **⚙ Settings**.

> Nếu Jira trả `301` hoặc lỗi lạ, kiểm tra context path: ví dụ `https://jira.fpt.com` redirect sang `/home`, nên `JIRA_URL` phải là `https://jira.fpt.com/home`.

## Tính năng

- **Summary cards**: số issue của từng nhóm, click để nhảy tới section.
- **Sprint**: mặc định hiện các sprint đang active; dropdown ở tiêu đề section cho chọn sprint khác (active / future / closed) mà member đang xem có issue, kèm progress và ngày bắt đầu / kết thúc. Danh sách lấy từ 200 issue cập nhật gần nhất của member.
- **Sections**: Đang làm, To do, Bugs, Quá hạn, Đã report, Đang watch, Xong 14 ngày qua. Mỗi section có link *Mở trong Jira* với JQL tương ứng.
- **Member** (header): gõ để tìm thành viên (assignable users của các project đang hiển thị, bản thân ở đầu danh sách). Chọn một người sẽ tải lại toàn bộ dashboard cho người đó (thay `currentUser()` trong JQL bằng username của họ). Xoá ô để quay về bản thân.
- **Search / filter**: lọc theo key/summary, status category, project, type (lọc phía client trên dữ liệu đã tải).
- **Auto refresh**: Off / 10s / 30s / 60s / 5m, có đếm ngược.

## Tuỳ biến

Sửa mảng `SECTIONS` trong [src/main.js](src/main.js): mỗi phần tử là `[tiêu đề, JQL, màu card]`. Màu card: `c-blue`, `c-sky`, `c-amber`, `c-red`, `c-green` hoặc `''`.

Các query dùng `statusCategory` thay vì `resolution` vì workflow có thể không set Resolution khi chuyển sang Done. "Xong 14 ngày qua" dùng `updated` làm mốc nên là xấp xỉ.

## Giới hạn

- Chỉ chạy qua `yarn dev` hoặc `vite preview` (cần proxy). Build tĩnh deploy lên host khác sẽ bị CORS.
- Mỗi section tối đa 50 issue, sprint tối đa 200.
- Chỉ hỗ trợ Jira Server / Data Center (auth `Bearer <PAT>`). Jira Cloud dùng email + API token, chưa hỗ trợ.

## Cấu trúc

```
vite.config.js   # proxy middleware /jira/* → Jira, đọc config từ .env hoặc header
src/main.js      # gọi API, render dashboard, form Connect, filter, auto refresh
src/style.css    # layout đồng bộ với gitlab-pipelines-viewer, theme light
```
