# Jira Personal Dashboard

Dashboard cá nhân cho Jira Server / Data Center: tasks, bugs, sprint, issue quá hạn, issue mình report / watch, performance theo tuần / ngày và lịch worklog có kéo thả để log work.

Next.js (App Router) + [Mantine](https://mantine.dev) 9 (theme light). Mọi lời gọi Jira đi qua API route của Next.js `/api/jira/*` chạy phía server — Jira Server/DC không trả CORS header nên trình duyệt không gọi thẳng được, và token trong `.env` không bao giờ xuống trình duyệt. Giao diện là React component dùng Mantine (Table, Badge, Modal, Autocomplete, SegmentedControl, notifications...); riêng lưới calendar dùng CSS riêng ([src/components/calendar.css](src/components/calendar.css)) vì Mantine không có heatmap tháng.

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

Mở http://localhost:5190. Server chỉ nghe trên `127.0.0.1` (không lộ ra mạng LAN), vì API route dùng token trong `.env`.

Bản production chạy local: `yarn build && yarn start`.

## Deploy bằng Docker trên VPS

NPM (Nginx Proxy Manager) và app cần cùng tham gia Docker network `npm_network`. Tạo network một lần nếu chưa có:

```bash
docker network create npm_network
```

Trong thư mục dự án, tạo `.env` từ `.env.example` và điền `JIRA_URL`, `JIRA_TOKEN` nếu muốn cấu hình Jira ở server; để trống thì có thể kết nối từ giao diện. Sau đó build và chạy:

```bash
docker compose up -d --build
```

Trong NPM, đặt Forward Hostname / IP là `jira-personal-dashboard` và Forward Port là `5190`. Compose không publish port ra host; chỉ proxy/container trong `npm_network` truy cập được app.

## Cấu hình

Có 2 cách, chọn một:

**1. Qua `.env` (khuyến nghị)** — token chỉ nằm trong server Next.js, không xuống trình duyệt. Màn hình Settings bị ẩn.

| Biến | Mô tả |
|---|---|
| `JIRA_URL` | URL gốc của Jira, gồm cả context path nếu có, ví dụ `https://jira.fpt.com/home` |
| `JIRA_TOKEN` | Personal Access Token (Jira → Profile → Personal Access Tokens) |
| `JIRA_INSECURE` | `1` nếu Jira dùng chứng chỉ self-signed / CA nội bộ (tắt kiểm tra TLS cho cả process Next.js) |

**2. Nhập trên màn hình** — để trống `JIRA_URL` / `JIRA_TOKEN`, app sẽ hiện form Connect. Token được gửi từ trình duyệt qua API route `/api/jira` tới Jira. Tick *Remember* sẽ lưu token dạng plain text trong `localStorage`; không tick thì chỉ giữ trong tab hiện tại (`sessionStorage`). Đổi / xoá qua nút **⚙ Settings**.

> Nếu Jira trả `301` hoặc lỗi lạ, kiểm tra context path: ví dụ `https://jira.fpt.com` redirect sang `/home`, nên `JIRA_URL` phải là `https://jira.fpt.com/home`.

## Tính năng

Thứ tự trên trang: header → summary cards → Performance → filter → Sprint → các section.

### Header

- **Member**: gõ để tìm thành viên (assignable users của các project đang hiển thị, bản thân ở đầu danh sách). Chọn một người sẽ tải lại toàn bộ dashboard cho người đó (thay `currentUser()` trong JQL bằng username của họ). Xoá ô để quay về bản thân.
- **Refresh ↻**: tải lại toàn bộ (không có auto refresh — dữ liệu tải khi mở trang, khi bấm Refresh và sau mỗi thao tác ghi lên Jira); dữ liệu cũ vẫn hiển thị trong lúc tải.
- **⚙ Settings**: chỉ hiện khi không cấu hình `.env` — đổi Jira URL / token hoặc Disconnect.

### Summary cards & sections

- **Summary cards**: số issue của từng nhóm, click để nhảy tới section.
- **Sections**: Đang làm, To do, Bugs, Quá hạn, Đã report, Đang watch, Xong 14 ngày qua. Mỗi section có link *Mở trong Jira* với JQL tương ứng; bảng có cột Assignee, due date quá hạn tô đỏ.
- **Search / filter**: lọc theo key / summary, status category, project, type (lọc phía client trên dữ liệu đã tải, giữ nguyên khi Refresh).
- **Sprint**: mặc định hiện các sprint đang active; dropdown ở tiêu đề section cho chọn sprint khác (active / future / closed) mà member đang xem có issue, kèm progress và ngày bắt đầu / kết thúc. Danh sách lấy từ 200 issue cập nhật gần nhất của member.

### Performance

Của member đang xem. Nút **Calendar / List** ở tiêu đề section (mặc định Calendar).

**List** — theo tuần (4 / 8 / 12 tuần) hoặc theo ngày (7 / 14 / 30 ngày):

| Cột | Ý nghĩa |
|---|---|
| Nhận mới | issue giao cho member được tạo trong kỳ |
| Hoàn thành | issue Done có lần đổi status cuối rơi vào kỳ |
| Estimate / Spent (task xong) | tổng original estimate / time spent của các task hoàn thành trong kỳ |
| Logged | giờ chính member log trong kỳ, kèm thanh so sánh |
| Issues có log | số issue member log trong kỳ |

Click một tuần / ngày để xem chi tiết từng issue; dòng cuối là tổng.

**Calendar** — lịch tháng (T2 → CN), ‹ › đổi tháng, *Tháng này* quay về hiện tại:

- Mỗi ô ngày tô màu theo giờ logged (< 4h, 4–8h, ≥ 8h), hiện từng worklog (số issue, summary, giờ), ✓ số task hoàn thành, + số task nhận mới. Click ô để xem danh sách issue bên dưới; **click một worklog (hoặc task trên sidebar) để mở popup chi tiết**: issue, parent, assignee / reporter, due date, estimate / đã log / còn lại, mô tả, và thông tin chính worklog đó (ngày, giờ bắt đầu, số giờ, người log, ghi chú). **Worklog của chính bạn sửa được ngay trong popup** (ngày, giờ bắt đầu, số giờ, ghi chú → *Lưu worklog*; đổi số giờ thì remaining estimate tự điều chỉnh); worklog của người khác chỉ xem.
- T7, CN: cột hẹp, tô cam. Ngày thường (đến hôm nay) không có worklog và không có task nào: tô đỏ nhạt, ghi *⚠ Chưa log*.
- **Kéo worklog sang ngày khác** để đổi ngày log trên Jira (giữ giờ bắt đầu và số giờ, không đổi remaining estimate). Có modal xác nhận trước khi ghi.
- **Sidebar "Chưa logwork"** bên trái: task giao cho bạn chưa có worklog nào, ở mọi trạng thái (kể cả đã Resolved). **Kéo task vào ô ngày** để log work: modal hỏi số giờ (mặc định = remaining estimate; vd `8h`, `1.5h`, `1,5`, `30m`), worklog bắt đầu 9:00 ngày đó và trừ remaining estimate như Jira.
- **Nút + ở góc dưới phải ô ngày**: popup tạo task và log work ngày đó.
  - Luôn tạo **Sub-task** giao cho bạn (reporter cũng là bạn); **bắt buộc chọn parent**. Gợi ý: tất cả issue không phải sub-task trong các sprint active của bạn (và sprint đang chọn ở section Sprint), parent dùng gần đây xếp đầu; gõ được theo key hoặc summary. Tiêu đề đầy đủ của parent hiện dưới ô nhập.
  - Parent phải tồn tại, không phải sub-task và cùng project — kiểm tra trước khi tạo.
  - Mặc định: estimate và log work = **8h trừ số giờ đã log trong ngày**, due date = ngày đó. Để trống ô Log work thì chỉ tạo task.
- **Nút "+ Tạo task" trên sidebar**: cùng popup nhưng chỉ tạo task (estimate 8h, due date hôm nay, không log work); task mới hiện trong sidebar để kéo vào ngày sau.
- Sidebar, nút + và nút Tạo task chỉ dùng được khi xem dashboard của chính mình (worklog luôn được tạo dưới tên người kết nối).
- Lỗi khi ghi lên Jira (không có quyền, số giờ sai...) hiện dưới dạng notification góc trên phải; lỗi trong popup hiện ngay trong popup.

## Dữ liệu app ghi lên Jira

Chỉ những thao tác sau, đều do người dùng chủ động:

| Thao tác | API |
|---|---|
| Kéo worklog sang ngày khác (sau khi xác nhận) | `PUT /rest/api/2/issue/{key}/worklog/{id}?adjustEstimate=leave` |
| Sửa worklog trong popup chi tiết (nút Lưu) | `PUT /rest/api/2/issue/{key}/worklog/{id}?adjustEstimate=auto` |
| Kéo task từ sidebar vào ngày | `POST /rest/api/2/issue/{key}/worklog` |
| Popup tạo task | `POST /rest/api/2/issue` (+ `POST .../worklog` nếu có log work) |

API route chỉ chuyển tiếp GET và đúng các request ghi trên (theo path); mọi request ghi khác bị chặn (405). Request từ origin khác bị chặn (403).

## Tuỳ biến

Sửa mảng `SECTIONS` trong [src/lib/jira.js](src/lib/jira.js): mỗi phần tử là `{ title, jql, color }`, `color` là màu Mantine (vd `blue.6`, `red.6`, `teal.7`) hoặc bỏ trống.

Các query dùng `statusCategory` thay vì `resolution` vì workflow không set Resolution khi chuyển sang Done. Vì vậy "Xong 14 ngày qua" dùng `updated` làm mốc, còn "Hoàn thành" trong Performance dùng lần đổi status cuối — cả hai là xấp xỉ.

## Giới hạn

- Cần server Next.js (`yarn dev` / `yarn start`) vì Jira được gọi qua API route; không export tĩnh được.
- Mỗi section tối đa 50 issue, sprint tối đa 200, danh sách sprint lấy từ 200 issue gần nhất. Performance / calendar đọc đủ mọi trang kết quả.
- Ngày của worklog lấy theo timezone của chính worklog, giả định trùng timezone trình duyệt.
- Kéo thả cần chuột (không hỗ trợ cảm ứng).
- Chỉ hỗ trợ Jira Server / Data Center (auth `Bearer <PAT>`). Jira Cloud dùng email + API token, chưa hỗ trợ.

## Cấu trúc

```
app/api/jira/[...path]/route.js  # API route /api/jira/* → Jira: config từ .env hoặc header, allowlist method/path, chặn origin lạ
app/page.js                      # server component: đọc .env, chỉ truyền URL + "đã cấu hình chưa" xuống client
app/layout.js                    # <html>, CSS của Mantine + calendar
app/providers.js                 # MantineProvider (theme light, primary orange, link xanh), ModalsProvider, Notifications
src/lib/jira.js                  # client gọi /api/jira, SECTIONS, sprint, performance, members, createmeta / parent
src/lib/format.js                # helper ngày / giờ / duration
src/components/App.js            # root: màn Connect hoặc Dashboard
src/components/ConnectForm.js    # màn Connect / Settings
src/components/Dashboard.js      # header (member, Refresh, Settings), cards, filter, sections
src/components/SprintSection.js  # section Sprint + chọn sprint
src/components/Performance.js    # Performance: List / Calendar, kéo thả, log work, mở popup
src/components/PerfList.js       # bảng theo tuần / ngày
src/components/PerfCalendar.js   # lịch tháng + sidebar Chưa logwork
src/components/CreateTaskModal.js# popup tạo sub-task + log work
src/components/DetailModal.js    # popup chi tiết + sửa worklog
src/components/IssueTable.js     # bảng issue, StatusBadge
src/components/calendar.css      # lưới lịch, màu heat, T7/CN, Chưa log
```
