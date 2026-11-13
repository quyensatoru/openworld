# 🏢 Office — văn phòng 3D

Văn phòng 3D cho team: mỗi người mở link, nhập mã văn phòng, tạo nhân vật rồi đi lại, ngồi vào bàn làm việc, nói chuyện khi đứng gần nhau, họp trong phòng họp, kéo task trên Kanban.

**Tính năng**

- Văn phòng 3D (three.js): khu làm việc 24 bàn, 2 phòng họp vách kính có TV, pantry, lounge, thư viện yên tĩnh, sảnh có bảng Kanban.
- Nhân vật tuỳ biến (màu da, tóc, quần áo, phụ kiện, chiều cao). Có bộ model Quaternius thì dùng model có xương + animation; chưa có thì dùng nhân vật dựng bằng code.
- Đi bằng WASD/mũi tên (Shift chạy) hoặc click để tự tìm đường; click ghế để ngồi, E để tương tác, phím 1–8 để biểu cảm.
- **Voice/video theo khoảng cách** (WebRTC): lại gần ≤ 3,5 m là nghe thấy nhau, càng xa càng nhỏ. Trong phòng họp ai cũng nghe thấy nhau, thư viện thì không có voice. Chia sẻ màn hình hiện lên TV phòng họp.
- Hai kênh chat thôi, tách theo **ai được đọc**:
  - 🏢 **Văn phòng của bạn** — bạn và toàn bộ nhân viên đang làm việc cho bạn. **Mỗi việc là một thread** (kiểu Mattermost): bạn gõ một câu là mở một thread, rồi Tổng quản, phòng này, phòng kia trao đổi với nhau ngay trong thread đó — bạn mở ra đọc được từng câu họ nói với nhau. Việc của người khác nằm ở kênh của họ, không lẫn vào đây.
  - 📍 **Khu vực** — chỉ người đang đứng cùng chỗ với bạn; kèm tin chung của văn phòng (ai xong việc, ai bật phim).

  Bong bóng chat trên đầu, `@tên` để gọi, có thông báo khi tab đang ẩn, có vạch ngăn ngày.
- Trạng thái tự động theo vị trí (Làm việc / Họp / Nghỉ / Tập trung / Vắng), Pomodoro hiển thị trên đầu nhân vật.
- Check-in khi ngồi vào bàn, tự cộng giờ làm, số pomodoro, số task xong trong ngày (panel “Hôm nay”).
- Kanban To do / Doing / Review / Done kéo thả realtime, gán người, độ ưu tiên; task đang làm hiện dưới tên nhân vật; xong task thì nhân vật ăn mừng + confetti.

- **Góc nhìn thứ nhất** (phím V / nút 🎥), ánh sáng văn phòng đổi theo giờ thật (ngày / chiều tà / tối), âm thanh văn phòng tổng hợp bằng WebAudio (điều hoà, gõ phím của người ngồi gần, bước chân, máy pha cà phê).
- **Rạp chiếu phim** (cửa phía nam sảnh): 60 ghế, màn hình 11 m. Dán link YouTube → cả rạp xem đồng bộ (server giữ mốc thời gian chung); ngồi ghế là tự vào góc nhìn thứ nhất, đèn rạp tối dần khi chiếu.
- **🧠 Tổng quản + các phòng ban làm việc thật.** Bạn không cần biết giao cho ai: nói việc cần làm ở tab chat **🏢 Văn phòng của bạn**, Tổng quản chọn phòng ban, chia việc sao cho phần nào độc lập thì chạy song song, trả lời thẳng những gì trả lời được, và chỉ hỏi lại khi đoán sai là hỏng việc. Máy trực cử nhân viên của phòng tương ứng ngồi vào bàn làm, bàn giao qua Kanban, rồi nộp tóm tắt để đúc rút kinh nghiệm. Xem mục [Nhân viên văn phòng](#nhân-viên-văn-phòng-ai).
- **Màn hình Claude Code** trên bàn làm việc: Cài đặt → "Màn hình Claude Code" → tạo mã → dán lệnh cài vào terminal. Monitor ở bàn bạn ngồi sẽ hiện Claude trên máy bạn đang làm gì (chỉ tên công cụ + tên file/mô tả lệnh; prompt chỉ hiện nếu bạn bật). Phiên của bạn vẫn là của bạn — nó không thành nhân viên văn phòng.
- **Phòng họp**: ai trong phòng cũng nghe nhau; chia sẻ màn hình hiện lên TV; click TV để phóng to, cuộn chuột để zoom, kéo để xem chỗ khác.

- **Báo khi Office đông vui** (Web Push): đóng tab rồi vẫn nhận được thông báo "4 người đang ở Office" trên điện thoại/máy tính. Bật trong ⋯ → Cài đặt. Chỉ báo khi có từ 3 người trở lên, nhiều nhất một lần mỗi 6 tiếng mỗi người, và chỉ trong khung giờ `PUSH_HOURS`.

**Kiến trúc**: một Cloudflare Worker phục vụ cả frontend (Workers Static Assets, tương đương Pages) lẫn API. Durable Object `OfficeRoom` giữ phòng realtime qua WebSocket (Hibernation API). D1 lưu người dùng, task, chat, worklog.

```
worker/           Worker + Durable Object + D1 + xác thực mã văn phòng
worker/brain.ts   🧠 Tổng quản: hàng đợi yêu cầu, prompt quyết định, áp quyết định lên bảng việc
worker/agents.ts  nhân viên các phòng ban: chỗ ngồi, MCP, hồ sơ phòng, giao thức máy trực
shared/           protocol, layout văn phòng (map.ts), cấu hình avatar, brain.ts — dùng chung client/server
src/world/        thế giới 3D: engine, office, furniture, controller, pathfinding, avatar/
src/rtc/          voice/video theo khoảng cách
src/ui/           React HUD: đăng nhập, tạo nhân vật, toolbar, chat, Kanban…
scripts/          smoke-test, e2e (Chrome headless), inspect/prepare assets
migrations/       schema D1
```

## Nhân viên văn phòng (AI)

Văn phòng tự có người làm việc. Kiến trúc hai tầng, và chỗ khác nhau giữa hai tầng chính là chỗ tiết kiệm:

| | Nghĩ (🧠 Tổng quản) | Làm (các phòng ban) |
|---|---|---|
| Là gì | `claude -p` rất ngắn, **thư mục trống**, **không công cụ nào**, trả về một object JSON | `claude -p` đầy đủ trong dự án của bạn, theo hồ sơ phòng ban |
| Mất bao lâu | vài giây | vài phút tới vài chục phút |
| Khi nào chạy | mỗi yêu cầu của người | chỉ khi Tổng quản đã quyết là cần |

Một yêu cầu đi như sau:

1. Bạn nói ở tab **🏢 Văn phòng của bạn**. Câu đó mở một **thread** — mọi thứ về việc này sau đó nằm gọn trong thread, kể cả lúc hai phòng nói chuyện với nhau.
2. Tổng quản đọc tình hình văn phòng (bảng việc, ai đang bận, sổ kinh nghiệm, ngân sách còn lại) rồi quyết **một** trong năm việc: trả lời thẳng · chia việc cho các phòng · hỏi lại đúng một câu · gộp vào việc đang chạy · bỏ qua.
3. Chia việc thì mỗi phần một phòng; phần nào không phụ thuộc nhau sẽ **chạy song song**, phần nào phải chờ thì nằm im tới khi phần trước xong — hoặc tới khi phòng làm phần đó bàn giao lại (cột **Chờ duyệt**), vì chính phòng sau mới là người kiểm.
4. Máy trực mở phiên làm việc cho từng phần. Nhân viên phòng đó ngồi vào bàn, màn hình hiện nó đang làm gì, báo tiến độ **trong thread của việc**, hỏi lại bạn ở đó khi cần, bàn giao phần của phòng khác qua Kanban — và vì việc bàn giao vẫn thuộc thread cũ, bạn thấy luôn hai phòng trao đổi với nhau.
5. Khi **mọi phần** (kể cả phần được bàn giao thêm) đã xong, Tổng quản đọc ghi chú của từng việc và gửi **một tin 📋 Kết quả** trong thread: làm được gì, ở đâu, còn gì dở, bạn cần làm gì tiếp. Bạn không bị báo lẻ từng phần. Cách chia việc lần đó tốt hay dở được ghi lại làm kinh nghiệm cho Tổng quản lần sau.
6. **Bổ sung giữa chừng: cứ trả lời ngay trong thread đó.** Nếu nhân viên đang làm trong thread, tin nhắn đến thẳng họ ở bước tiếp theo, được ghi vào thẻ việc, và bạn nhận dòng “📨 Đã chuyển cho …”. Nếu chưa ai làm, hoặc việc đã ở Chờ duyệt, Tổng quản nhận tin, biết nó thuộc luồng nào và gộp vào thẻ đó. Thẻ đang Chờ duyệt sẽ được đưa về làm lại kèm phần bổ sung, xong lại có 📋 Kết quả.
7. Gõ `@` trong chat chỉ gợi ý Tổng quản, các phòng ban và nhân viên AI đang có mặt, không gợi ý người thật. `@Tên-nhân-viên` ở kênh chung cũng đến Tổng quản để chuyển cho đúng người.

**Mất mạng, Claude sập, máy trực khởi động lại** — việc không mất, cũng không làm lại từ đầu:

- Mỗi phiên có session id riêng. Phiên bị ngắt vì Claude không trả lời (lỗi API, hết hạn mức, mất mạng, hoặc im lặng quá 12 phút) thì nhân viên **ngồi chờ ở bàn**, thread báo "sẽ tự làm tiếp", máy trực lùi dần (30 giây → tối đa 10 phút, hoặc đúng giờ hạn mức được mở lại) rồi chạy `claude --resume` **đúng cuộc hội thoại đó**. Bị ngắt 6 lần liền mới trả việc về bảng.
- Mất liên lạc với Office: phiên vẫn làm, kết quả được giữ trong `~/.office-agent/<máy>.json` và gửi lên khi có mạng.
- Máy trực chết hẳn: lúc chạy lại nó tự nhận lại các phiên cũ. Máy không liên lạc 20 phút thì Office trả việc về bảng cho máy khác.
- Một việc mà phiên làm việc hỏng giữa chừng 3 lần sẽ dừng ở cột Chờ duyệt kèm lý do, không lặp vô tận.
- Tổng quản không trả lời được vì mất mạng thì yêu cầu được giữ, thử lại sau — không bị tính là "không hiểu yêu cầu".

**Mỗi máy trực một dự án.** Máy trực báo tên dự án (tên repo trên git remote, hoặc `--project`). Tổng quản ghi dự án lên từng việc và chỉ máy của dự án đó nhận; nhiều dự án mà yêu cầu không rõ thì nó hỏi. **Sổ kinh nghiệm** cũng theo phạm vi: bài của dự án (mặc định), bài riêng một máy (shell, công cụ cài trên máy đó) và bài chung — phiên làm việc chỉ đọc bài đúng với dự án và máy của nó. Mỗi dự án tự đúc rút trên máy của mình; bài trùng ý bị chặn để gộp.

**Duyệt quyền** (🧠 → Cách Tổng quản làm việc):

| Chế độ | Ai quyết khi nhân viên muốn làm thứ ngoài hồ sơ phòng |
|---|---|
| 🧠 Tổng quản tự duyệt (mặc định) | Đọc, test/build, sửa file trong dự án: cho luôn. Thứ khác: Tổng quản xét theo đúng việc đang làm. Push/deploy/xoá/gửi ra ngoài chỉ được cho khi việc ghi rõ — không rõ thì mới hỏi chủ máy (thẻ 🔐). |
| 🚀 Tự động hoàn toàn | Phiên chạy ở chế độ `auto` của Claude Code, phần còn lại Tổng quản quyết, không hỏi ai; không chắc thì từ chối và ghi vào việc. |
| 🙋 Hỏi chủ máy | Như cũ: mọi thứ thành thẻ 🔐. |

Những gì Tổng quản tự duyệt hiện ở panel 🧠 ("Tổng quản vừa tự duyệt"); thao tác khó đảo ngược mà nó cho phép còn được báo trong thread của việc.

Tất cả chỉnh ở panel 🧠 (phím/nút Nhân viên văn phòng):

- **Model quyết định** — mặc định Sonnet. Haiku rẻ và nhanh hơn, Opus cho quyết định khó.
- **Trần phiên/giờ** cho cả văn phòng và cho mỗi người — đây là trần chi phí thật, vì phiên làm việc mới là thứ tốn tiền.
- **Họp tự động** — mặc định **tắt**. Mỗi ghế họp là một phiên chạy song song tới 25 phút, nên đây là thứ tốn kém nhất; tắt thì Tổng quản tự ra kế hoạch bằng một lượt nghĩ. Phòng họp vẫn dùng bình thường cho người thật.
- **Quyền giao việc** — mặc định máy trực chỉ nhận việc từ chủ máy; chọn thêm đồng nghiệp ở tab 🔑.

Agent **không** tự gọi nhau nữa: việc sang phòng khác chỉ đi qua bảng Kanban. Một yêu cầu vì thế không thể nở ra thành hàng chục phiên. Ranh giới cố định: chỉ Phát triển sửa code, chỉ Kiểm thử kết luận đạt/không đạt, chỉ Vận hành deploy, Tài liệu chỉ sửa file tài liệu. Khi Kiểm thử trả lỗi về Phát triển, việc kiểm thử nằm chờ đúng bản sửa đó rồi mới tự chạy lại — không ai nhận lại để kiểm đúng lỗi cũ.

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
npm run test:agents    # 🧠 Tổng quản, luồng chat riêng, MCP, máy trực, ngân sách, họp, quyền giao việc, dự án, tự duyệt, báo cáo cuối
npm run test:runner    # máy trực thật với một claude giả: mất mạng giữa phiên, máy trực chết rồi chạy lại, Ctrl+C
npm run e2e            # Chrome headless, 2 người thật: đi lại, voice WebRTC, camera, chat, Kanban, ngồi bàn
BASE=https://office.xxx.workers.dev PASSCODE=... npm test   # chạy với bản đã deploy
```

## Tuỳ biến văn phòng

Toàn bộ layout nằm ở `shared/map.ts` (zones, tường, bàn ghế, điểm tương tác) — server dùng chung file này để biết ai đang ở khu nào. Nội thất được dựng bằng code trong `src/world/furniture.ts`.
