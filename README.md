# 🏢 Office — văn phòng ảo 3D

Văn phòng ảo 3D cho team: mỗi người mở link, nhập mã văn phòng, tạo nhân vật rồi đi lại, ngồi vào bàn làm việc, nói chuyện khi đứng gần nhau, họp trong phòng họp, kéo task trên Kanban.

**Tính năng**

- Văn phòng 3D (three.js): khu làm việc 24 bàn, 2 phòng họp vách kính có TV, pantry, lounge, thư viện yên tĩnh, sảnh có bảng Kanban.
- Nhân vật tuỳ biến (màu da, tóc, quần áo, phụ kiện, chiều cao). Có bộ model Quaternius thì dùng model có xương + animation; chưa có thì dùng nhân vật dựng bằng code.
- Đi bằng WASD/mũi tên (Shift chạy) hoặc click để tự tìm đường; click ghế để ngồi, E để tương tác, phím 1–8 để biểu cảm.
- **Voice/video theo khoảng cách** (WebRTC): lại gần ≤ 3,5 m là nghe thấy nhau, càng xa càng nhỏ. Trong phòng họp ai cũng nghe thấy nhau, thư viện thì không có voice. Chia sẻ màn hình hiện lên TV phòng họp.
- Chat cả văn phòng + chat riêng theo khu vực, bong bóng chat trên đầu, `@tên` để gọi (có thông báo khi tab đang ẩn).
- Trạng thái tự động theo vị trí (Làm việc / Họp / Nghỉ / Tập trung / Vắng), Pomodoro hiển thị trên đầu nhân vật.
- Check-in khi ngồi vào bàn, tự cộng giờ làm, số pomodoro, số task xong trong ngày (panel “Hôm nay”).
- Kanban To do / Doing / Review / Done kéo thả realtime, gán người, độ ưu tiên; task đang làm hiện dưới tên nhân vật; xong task thì nhân vật ăn mừng + confetti.

- **Góc nhìn thứ nhất** (phím V / nút 🎥), ánh sáng văn phòng đổi theo giờ thật (ngày / chiều tà / tối), âm thanh văn phòng tổng hợp bằng WebAudio (điều hoà, gõ phím của người ngồi gần, bước chân, máy pha cà phê).
- **Rạp chiếu phim** (cửa phía nam sảnh): 60 ghế, màn hình 11 m. Dán link YouTube → cả rạp xem đồng bộ (server giữ mốc thời gian chung); ngồi ghế là tự vào góc nhìn thứ nhất, đèn rạp tối dần khi chiếu.
- **Màn hình Claude Code** trên bàn làm việc: Cài đặt → "Màn hình Claude Code" → tạo mã → dán đoạn hooks vào `~/.claude/settings.json`. Monitor ở bàn bạn ngồi sẽ hiện Claude đang làm gì (chỉ tên công cụ + tên file/mô tả lệnh; prompt chỉ hiện nếu bạn bật). Click vào monitor để xem đầy đủ.
- **Phòng họp**: ai trong phòng cũng nghe nhau; chia sẻ màn hình hiện lên TV; click TV để phóng to, cuộn chuột để zoom, kéo để xem chỗ khác.

- **Báo khi Office đông vui** (Web Push): đóng tab rồi vẫn nhận được thông báo "4 người đang ở Office" trên điện thoại/máy tính. Bật trong ⋯ → Cài đặt. Chỉ báo khi có từ 3 người trở lên, nhiều nhất một lần mỗi 6 tiếng mỗi người, và chỉ trong khung giờ `PUSH_HOURS`.

**Kiến trúc**: một Cloudflare Worker phục vụ cả frontend (Workers Static Assets, tương đương Pages) lẫn API. Durable Object `OfficeRoom` giữ phòng realtime qua WebSocket (Hibernation API). D1 lưu người dùng, task, chat, worklog.

```
worker/           Worker + Durable Object + D1 + xác thực mã văn phòng
shared/           protocol, layout văn phòng (map.ts), cấu hình avatar — dùng chung client/server
src/world/        thế giới 3D: engine, office, furniture, controller, pathfinding, avatar/
src/rtc/          voice/video theo khoảng cách
src/ui/           React HUD: đăng nhập, tạo nhân vật, toolbar, chat, Kanban…
scripts/          smoke-test, e2e (Chrome headless), inspect/prepare assets
migrations/       schema D1
```

## Chạy ở máy mình

```bash
npm install
npm run dev            # http://localhost:5173 — mã văn phòng mặc định: office-dev (file .dev.vars)
```

`localhost` được coi là HTTPS nên mic/cam dùng được khi test local. Mở thêm một cửa sổ ẩn danh để thử 2 người.

**Bản đang chạy:** https://office.quyenpv020803.workers.dev (D1: `office`).

## Nhân vật Quaternius (CC0)

Bộ Standard miễn phí chỉ có thân người mặc đồ lót, nên game tự "mặc đồ" bằng shader (`src/world/avatar/clothing.ts`): áo ngắn/dài tay, quần, giày đổi màu được; tóc và râu là mesh riêng gắn vào khung xương; màu da/tóc được chỉnh theo texture gốc. `scripts/assets.config.json` đã cấu hình sẵn cho bộ này (animation đi/chạy/ngồi/nói chuyện/nhảy, 5 kiểu tóc, râu, độ lệch khi ngồi ghế).

### Cập nhật / thay bộ nhân vật

1. Tải bản **Standard** (miễn phí) của
   [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) và
   [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) (nút “Download on Itch.io”, nhập giá 0 được).
2. Giải nén cả hai vào `assets-src/` (thư mục này không được deploy).
3. Chạy:
   ```bash
   npm run assets:inspect    # xem có những mesh / material / animation nào
   npm run assets:prepare    # đoán cấu hình → scripts/assets.config.json, xuất file nén vào public/models/
   ```
   Nếu đoán sai (ví dụ animation ngồi, tên material của áo/quần), sửa `scripts/assets.config.json` rồi chạy lại `npm run assets:prepare`.

Không có `public/models/manifest.json` thì game tự dùng nhân vật dựng bằng code.

## Deploy lên Cloudflare

```bash
npx wrangler login                                   # một lần
npx wrangler d1 create office                    # copy database_id in ra vào wrangler.jsonc
npm run db:migrate:remote                            # tạo bảng (DO cũng tự tạo nếu thiếu)
npx wrangler secret put OFFICE_PASSCODE              # mã văn phòng cho cả team
npx wrangler secret put SESSION_SECRET               # chuỗi ngẫu nhiên dài
node scripts/gen-vapid.mjs                           # sinh cặp khoá thông báo (in ra hướng dẫn)
npx wrangler secret put VAPID_PRIVATE_KEY            # dán khoá riêng vừa sinh
npx wrangler secret put VAPID_SUBJECT                # mailto:ban@congty.com
npm run deploy                                       # → https://office.<subdomain>.workers.dev
```

Đổi `OFFICE_PASSCODE` là mọi phiên đăng nhập cũ hết hiệu lực. Tên văn phòng và múi giờ nằm ở `vars` trong `wrangler.jsonc`.

**TURN (nên bật)**: trong mạng công ty/Wi-Fi thường bị chặn kết nối trực tiếp giữa 2 máy → voice không nghe được (thanh trạng thái sẽ báo "Mạng chặn voice"). Cách bật: nếu có đồng nghiệp làm remote sau mạng chặn P2P (không nghe được nhau), tạo TURN key trong Cloudflare Dashboard → Realtime → TURN, rồi `wrangler secret put TURN_KEY_ID` và `TURN_KEY_API_TOKEN`.

**Thông báo đẩy (Web Push)**: dùng chuẩn W3C + VAPID, **không cần Firebase, không tốn phí** — Google/Mozilla/Apple đều chuyển phát miễn phí. Khoá công khai đặt ở `vars.VAPID_PUBLIC_KEY` trong `wrangler.jsonc` (khoá này không phải bí mật), khoá riêng là secret. Khung giờ được phép báo chỉnh ở `vars.PUSH_HOURS` (mặc định `8-22`, theo giờ văn phòng). Trên iPhone, thông báo chỉ chạy sau khi người dùng **thêm Office vào màn hình chính** — đây là giới hạn của iOS, không phải của app.

**Gói Free**: ~100k request/ngày (tin nhắn WebSocket gửi lên tính 20 tin = 1 request) và giới hạn thời lượng Durable Object — đủ cho team ~20 người giờ hành chính. Client chỉ gửi vị trí khi đang di chuyển (≈10 lần/giây).

## Kiểm thử

```bash
npm run typecheck
npm test               # 25 bước kiểm tra giao thức với 3 client giả (cần npm run dev đang chạy)
npm run e2e            # Chrome headless, 2 người thật: đi lại, voice WebRTC, camera, chat, Kanban, ngồi bàn
BASE=https://office.xxx.workers.dev PASSCODE=... npm test   # chạy với bản đã deploy
```

## Tuỳ biến văn phòng

Toàn bộ layout nằm ở `shared/map.ts` (zones, tường, bàn ghế, điểm tương tác) — server dùng chung file này để biết ai đang ở khu nào. Nội thất được dựng bằng code trong `src/world/furniture.ts`.
