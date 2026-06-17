# fk-skills

Hướng dẫn thiết kế cho AI coding agents. 1 skill, 23 lệnh, chế độ live iteration trên trình duyệt, và 44 quy tắc phát hiện lỗi thiết kế tất định dành cho frontend do AI tạo ra.

> **Bắt đầu nhanh:** Từ thư mục gốc của project, chạy `npx fk install`, sau đó chạy `/fk setup` trong AI coding tool của bạn.

---

## Tại sao cần fk-skills?

Mọi model AI đều được huấn luyện trên cùng một bộ template SaaS. Không có định hướng thiết kế, bạn sẽ nhận được kết quả giống nhau ở mọi project: font Inter cho tất cả mọi thứ, gradient tím-xanh, card lồng trong card, chữ xám trên nền màu, icon tile vuông bo góc phía trên mọi heading.

fk-skills giải quyết vấn đề đó bằng cách:

- **Một luồng setup.** `/fk setup` tạo ra `PRODUCT.md` và `DESIGN.md`, giúp các lệnh sau biết được đối tượng người dùng, định hướng brand/sản phẩm, voice, các tham chiếu cần tránh, màu sắc, typography, và components.
- **23 lệnh.** Ngôn ngữ thiết kế chung giữa bạn và AI: `finish`, `check`, `review`, `trim`, `motion`, `amplify`, `calm`, và nhiều hơn nữa.
- **44 quy tắc phát hiện tất định** cộng với các kiểm tra chỉ dùng LLM. CLI và browser extension chạy các quy tắc tất định mà không cần LLM hay API key.

---

## Cách hoạt động

fk-skills hoạt động theo 3 tầng:

**Tầng 1 — Context (Ngữ cảnh)**
Trước khi làm bất cứ điều gì, skill cần hiểu project của bạn. `/fk setup` viết ra `PRODUCT.md` (chiến lược: người dùng, brand, nguyên tắc) và `DESIGN.md` (thị giác: màu sắc, typography, components). Mọi lệnh khác đọc 2 file này trước khi làm việc — đây là lý do tại sao AI hiểu được "tone" của từng project thay vì ra kết quả generic.

**Tầng 2 — Commands (Lệnh)**
23 lệnh được tổ chức theo mục đích, từ setup cho đến kiểm tra, cải thiện thị giác, kỹ thuật, và live iteration. Mỗi lệnh nhận context từ Tầng 1 và áp dụng đúng bộ hướng dẫn thiết kế cho nhiệm vụ đó.

**Tầng 3 — Detector (Phát hiện lỗi)**
44 quy tắc tất định chạy trên HTML/CSS để tự động phát hiện anti-pattern — không cần AI, không cần API key. Chạy được trong CLI, browser extension, và hook tích hợp với editor.

---

## 23 Lệnh — 6 Nhóm

### Nhóm 1: Khởi tạo & Lên kế hoạch

Chạy các lệnh này đầu tiên. Chúng tạo ra ngữ cảnh mà tất cả các lệnh khác dựa vào.

| Lệnh | Chức năng |
|------|-----------|
| `/fk setup` | Lệnh khởi tạo bắt buộc khi bắt đầu project mới. Hỏi về người dùng, brand, nguyên tắc thiết kế, sau đó tự viết `PRODUCT.md` và `DESIGN.md`. Chỉ cần chạy một lần. |
| `/fk plan` | Lên kế hoạch UX/UI trước khi code. Chạy discovery interview, xem mockup nếu có, tạo design brief đã được xác nhận. |
| `/fk spec` | Tự đọc codebase hiện tại rồi tạo `DESIGN.md` — extract màu sắc, font, spacing, border radius, pattern đang dùng. Hữu ích khi cần document design của project đã có sẵn. |
| `/fk build` | Flow đầy đủ từ đầu đến cuối: khám phá yêu cầu, xem mockup, build, iterate bằng mắt cho đến khi đúng. |

**Ví dụ:**
```
/fk setup
/fk plan thêm trang checkout mới
```

---

### Nhóm 2: Đánh giá & Kiểm tra

Dùng để tìm vấn đề trước khi sửa.

| Lệnh | Chức năng |
|------|-----------|
| `/fk review` | Đánh giá UX tổng thể: visual hierarchy, information architecture, cognitive load, cảm xúc người dùng. Ra điểm định lượng, test theo persona, tự phát hiện anti-pattern. |
| `/fk check` | Kiểm tra kỹ thuật: accessibility, performance, responsive, theming. Ra báo cáo với mức độ nghiêm trọng P0–P3 và hướng xử lý cụ thể. |

**Ví dụ:**
```
/fk review trang landing
/fk check trang blog
```

---

### Nhóm 3: Cải thiện thị giác

Dùng khi design đang chạy được nhưng chưa đẹp hoặc chưa đúng.

| Lệnh | Chức năng |
|------|-----------|
| `/fk amplify` | Design quá nhàm, quá an toàn, thiếu cá tính? Lệnh này tăng visual impact mà vẫn giữ usability. |
| `/fk calm` | Design quá mạnh, quá chói, quá áp đảo? Lệnh này giảm bớt cường độ mà vẫn giữ chất lượng. |
| `/fk trim` | Bỏ đi những thứ không cần thiết. Làm UI gọn hơn, tập trung hơn, bớt ồn ào. |
| `/fk color` | Thêm màu sắc chiến lược vào UI đang quá đơn điệu hoặc xám xịt. |
| `/fk type` | Cải thiện typography: chọn font đúng, phân cấp heading/body rõ ràng, kích thước và weight hợp lý. |
| `/fk space` | Sửa layout và khoảng cách: grid đơn điệu, spacing lộn xộn, hierarchy yếu, thứ không thẳng hàng. |
| `/fk finish` | Pass cuối cùng trước khi ship: sửa alignment, spacing, inconsistency — các chi tiết nhỏ quyết định cảm giác "bóng" hay "thô". |

**Ví dụ:**
```
/fk amplify trang hero
/fk finish form thanh toán
/fk trim sidebar navigation
```

---

### Nhóm 4: Cảm xúc & Chuyển động

Dùng khi design cần "thở" và "sống động" hơn.

| Lệnh | Chức năng |
|------|-----------|
| `/fk joy` | Thêm moments of joy và unexpected touches — từ "chạy được" lên "thích dùng". Micro-animation, easter egg nhỏ, chi tiết bất ngờ. |
| `/fk motion` | Thiết kế animation và micro-interaction có mục đích — không chỉ cho đẹp mà cải thiện trải nghiệm thực sự. |
| `/fk wow` | Khi muốn làm thứ gì đó thực sự ấn tượng, vượt giới hạn thông thường: shader, spring physics, scroll animation, 60fps. |

**Ví dụ:**
```
/fk motion trang onboarding
/fk wow hero section
```

---

### Nhóm 5: Kỹ thuật & Production

Dùng khi cần đảm bảo UI hoạt động tốt ngoài thực tế.

| Lệnh | Chức năng |
|------|-----------|
| `/fk responsive` | Làm design hoạt động trên mọi màn hình: điện thoại, tablet, desktop. Thêm breakpoints, fluid layout, touch target đúng kích thước. |
| `/fk perf` | Chẩn đoán và sửa hiệu năng UI: tải chậm, giật lag, animation nặng, ảnh chưa tối ưu, bundle quá to. |
| `/fk prod` | Hardening trước production: xử lý error state, hỗ trợ đa ngôn ngữ, text overflow, edge case dữ liệu thực tế. |
| `/fk tokens` | Gom các pattern lặp đi lặp lại thành design tokens và components dùng chung — dọn dẹp sự không nhất quán trong codebase. |

**Ví dụ:**
```
/fk responsive header navigation
/fk prod trang checkout
/fk perf trang danh sách sản phẩm
```

---

### Nhóm 6: Nội dung & Onboarding

Dùng cho chữ viết trong UI và trải nghiệm người dùng mới.

| Lệnh | Chức năng |
|------|-----------|
| `/fk copy` | Cải thiện nội dung chữ trong UI: error message, label, tooltip, hướng dẫn. Làm cho chúng rõ ràng, tự nhiên hơn. |
| `/fk welcome` | Thiết kế luồng onboarding, màn hình đầu tiên, empty state — dẫn người dùng mới đến chỗ thấy giá trị sản phẩm nhanh nhất có thể. |

**Ví dụ:**
```
/fk copy trang đăng ký
/fk welcome flow onboarding mới
```

---

### Đặc biệt: Live Mode

| Lệnh | Chức năng |
|------|-----------|
| `/fk live` | Thử nghiệm trực tiếp trên trình duyệt: chọn một element trên trang, chọn kiểu chỉnh, AI tạo ra nhiều phiên bản CSS/HTML khác nhau và hot-swap ngay lập tức. Cần dev server đang chạy. |

Live mode hoạt động theo luồng:
1. Chọn element muốn chỉnh trên trang
2. Chọn hành động (đổi màu, thay layout, thêm animation, v.v.)
3. AI tạo 3 phiên bản khác nhau
4. Xem trực tiếp trên trình duyệt, chọn phiên bản muốn giữ
5. Code được áp dụng vào source file

---

## Anti-Patterns Detector

Skill tích hợp 44 quy tắc phát hiện lỗi thiết kế tự động — chạy mà không cần AI hay API key.

**Các lỗi AI slop thường gặp mà detector phát hiện:**
- Dùng font quá phổ biến như Inter, Arial cho mọi thứ
- Gradient tím-xanh dập khuôn
- Chữ xám trên nền màu (contrast thấp)
- Card lồng trong card
- Icon tile vuông bo góc phía trên mọi heading
- Bounce/elastic easing (cảm giác lỗi thời)
- Glow tối trên nền tối

**Các lỗi chất lượng thiết kế:**
- Line length quá dài khó đọc
- Padding quá chật
- Touch target quá nhỏ
- Heading bị bỏ qua trong cấu trúc

---

## Cài đặt

### Cách 1: CLI installer (Khuyến nghị)

Từ thư mục gốc của project:

```bash
npx fk-skills install
```

Lệnh này tự phát hiện harness folder của bạn (`~/.claude`, `~/.codex`, `.cursor`...), cho chọn providers, sau đó hỏi cài project-specific hay global. Hỗ trợ Cursor, Claude Code, Gemini CLI, Codex CLI, và các tool khác.

Để cập nhật sau này:

```bash
npx fk-skills update
```

### Cách 2: Git Submodule

Cho team muốn vendor fk-skills và cập nhật qua Git:

```bash
git submodule add https://github.com/ThinhTP204/fk-skills .fk-skills
npx fk link --source=.fk-skills --providers=claude,cursor
git add .gitmodules .fk-skills .claude .cursor
git commit -m "Add fk-skills"
```

Để cập nhật sau:

```bash
git submodule update --remote .fk-skills
npx fk link --source=.fk-skills --providers=claude,cursor
```

### Cách 3: Copy thủ công

**Cursor:**
```bash
cp -r dist/cursor/.cursor your-project/
```

> Cursor cần bật: Nightly channel trong Settings → Beta, và Agent Skills trong Settings → Rules.

**Claude Code:**
```bash
# Chỉ cho project hiện tại
cp -r dist/claude-code/.claude your-project/

# Hoặc global (áp dụng cho mọi project)
cp -r dist/claude-code/.claude/* ~/.claude/
```

**OpenCode:**
```bash
cp -r dist/opencode/.opencode your-project/
```

**Gemini CLI:**
```bash
cp -r dist/gemini/.gemini your-project/
```

> Gemini CLI cần: `npm i -g @google/gemini-cli@preview`, sau đó `/settings` → bật "Skills".

**Codex CLI:**
```bash
# Project-local
cp -r dist/agents/.agents your-project/
mkdir -p your-project/.codex
cp dist/codex/.codex/hooks.json your-project/.codex/hooks.json
```

**GitHub Copilot:**
```bash
cp -r dist/github/.github your-project/
```

**Trae:**
```bash
# Trae China
cp -r dist/trae/.trae-cn/skills/* ~/.trae-cn/skills/

# Trae International
cp -r dist/trae/.trae/skills/* ~/.trae/skills/
```

**Rovo Dev:**
```bash
cp -r dist/rovo-dev/.rovodev your-project/
```

**Qoder:**
```bash
cp -r dist/qoder/.qoder your-project/
```

---

## Sử dụng

Sau khi cài, mọi lệnh đều chạy qua `/fk`:

```
/fk check        # Tìm vấn đề
/fk finish       # Dọn dẹp cuối
/fk trim         # Bỏ bớt phức tạp
/fk review       # Review design toàn diện
```

Gõ `/fk` một mình để xem danh sách lệnh đầy đủ.

Hầu hết lệnh nhận argument tùy chọn để chỉ định khu vực cụ thể:

```
/fk check header
/fk finish form checkout
/fk prod trang đăng nhập
```

Nếu bạn dùng một lệnh thường xuyên, dùng `/fk pin check` để tạo shortcut `/check` riêng.

---

## Design Hook

Trên Claude Code, Codex và Cursor, `npx fk-skills install` tự cài hook tích hợp với editor. Hook chạy detector khi bạn chỉnh sửa file UI và đưa kết quả vào luồng agent.

- **Claude Code**: `.claude/settings.local.json` → chạy `hook.mjs` sau khi edit
- **Cursor**: `.cursor/hooks.json` → chạy `hook-before-edit.mjs` trước khi write (block lỗi trước khi land)
- **Codex**: `.codex/hooks.json` → chạy `hook.mjs` sau khi edit

Hook giữ nguyên các cài đặt không liên quan. Nếu manifest bị lỗi, install/update sẽ dừng lại — chạy lại với `--force` để backup file lỗi và thay thế.

---

## CLI Phát hiện Anti-Pattern

fk-skills có CLI độc lập để quét lỗi mà không cần AI:

```bash
npx fk-skills detect src/                   # quét thư mục
npx fk-skills detect index.html             # quét file HTML
npx fk-skills detect https://example.com    # quét URL (cần Puppeteer)
npx fk-skills detect --json .               # output JSON cho CI
npx fk-skills detect --no-config src/       # quét thô, bỏ qua config
npx fk-skills ignores list                  # xem danh sách ignore
npx fk-skills ignores add-file "src/legacy/**"
npx fk-skills ignores add-value overused-font Inter --reason "Brand font"
```

---

## Công cụ được hỗ trợ

- [Cursor](https://cursor.com)
- [Claude Code](https://claude.ai/code)
- [OpenCode](https://opencode.ai)
- [Pi](https://pi.dev)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Codex CLI](https://github.com/openai/codex)
- [VS Code Copilot](https://code.visualstudio.com)
- [Kiro](https://kiro.dev)
- [Trae](https://trae.ai)
- [Rovo Dev](https://www.atlassian.com/software/rovo)
- [Qoder](https://qoder.com)

---

## Nâng cấp từ impeccable

fk-skills được fork từ [impeccable](https://github.com/impeccable-style/fk). Nếu đang migrate, đây là những thay đổi:

### Lệnh đã đổi tên

| Cũ (`/fk`) | Mới (`/fk`) |
|------------|-------------|
| `init` | `setup` |
| `craft` | `build` |
| `critique` | `review` |
| `audit` | `check` |
| `polish` | `finish` |
| `distill` | `trim` |
| `harden` | `prod` |
| `shape` | `plan` |
| `document` | `spec` |
| `extract` | `tokens` |
| `bolder` | `amplify` |
| `quieter` | `calm` |
| `colorize` | `color` |
| `delight` | `joy` |
| `overdrive` | `wow` |
| `animate` | `motion` |
| `adapt` | `responsive` |

### Lệnh giữ nguyên tên

`copy`, `type`, `space`, `perf`, `welcome`, `live`

### Thư mục config

Từ v1.0.5, thư mục config đổi từ `.fk-skills/` sang `.fk-skills/`. Chạy `npx fk-skills install` hoặc `npx fk-skills update` để tự migrate.

---

## Đóng góp

Xem [DEVELOP.md](docs/DEVELOP.md) để biết hướng dẫn đóng góp và build instructions.

## License

Apache 2.0. Xem [LICENSE](LICENSE).

---

Tạo bởi Trần Phú Thịnh
