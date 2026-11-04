# 🎮 TankWar (Haskell Backend & Web Browser Edition)

[![Haskell](https://img.shields.io/badge/Language-Haskell-purple.svg?style=flat&logo=haskell)](https://www.haskell.org/)
[![GHC](https://img.shields.io/badge/GHC-9.4%2B-5e5086.svg?style=flat)](https://www.haskell.org/ghc/)
[![Frontend](https://img.shields.io/badge/Frontend-HTML5%20Canvas%20%2F%20JS-orange.svg?style=flat&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![Networking](https://img.shields.io/badge/Network-WebSockets%20%2F%20STM-green.svg?style=flat)](https://hackage.haskell.org/package/websockets)
[![Database](https://img.shields.io/badge/Database-MongoDB-47A248.svg?style=flat&logo=mongodb)](https://www.mongodb.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](LICENSE)

> Tựa game chiến thuật đối kháng xe tăng 2D góc nhìn từ trên xuống (top-down), kết hợp giữa **Haskell Authoritative Server** và **Web Browser Client (HTML5 Canvas)**. Lấy cảm hứng từ tựa game huyền thoại **Tank Trouble**, bổ sung cơ chế **Mystery Box (Hộp quà bí ẩn)** hiệu lực **15 giây**, hỗ trợ **Chơi thử Offline** ngay trên trình duyệt và **Chơi Online Multiplayer** qua WebSockets với hệ thống phòng chơi bảo mật, lưu trữ dữ liệu bền vững trên **MongoDB**.

---

## 📖 Mục lục

- [Giới thiệu](#-giới-thiệu)
- [Điểm nổi bật & Tính năng](#-điểm-nổi-bật--tính-năng)
- [Hai chế độ chơi: Offline & Online](#-hai-chế-độ-chơi-offline--online)
- [Cơ chế Hộp quà Bí ẩn (?) & Hệ thống Vũ khí](#-cơ-chế-hộp-quà-bí-ẩn--hệ-thống-vũ-khí)
- [Quản lý Game Logic & Vòng lặp trò chơi](#-quản-lý-game-logic--vòng-lặp-trò-chơi)
- [Hệ thống Máy chủ & Quản lý Phòng (Lobby & Rooms)](#-hệ-thống-máy-chủ--quản-lý-phòng-lobby--rooms)
- [Quản lý Dữ liệu với MongoDB](#-quản-lý-dữ-liệu-với-mongodb)
- [Hướng dẫn điều khiển](#-hướng-dẫn-điều-khiển)
- [Kiến trúc Công nghệ](#-kiến-trúc-công-nghệ)
- [Cấu trúc thư mục dự án](#-cấu-trúc-thư-mục-dự-án)
- [Yêu cầu hệ thống & Hướng dẫn khởi chạy](#-yêu-cầu-hệ-thống--hướng-dẫn-khởi-chạy)
- [Ghi chú triển khai Production (HTTPS / WSS)](#-ghi-chú-triển-khai-production-https--wss)
- [Lộ trình phát triển (Roadmap)](#-lộ-trình-phát-triển-roadmap)
- [Đóng góp & Giấy phép](#-đóng-góp--giấy-phép)

---

## 🎯 Giới thiệu

Trong **TankWar**, mỗi người chơi điều khiển một chiếc xe tăng chiến thuật trong mê cung khép kín kích thước chuẩn `832 × 576` pixel. Các phát đạn tiêu chuẩn có khả năng dội nảy vật lý qua các bức tường gạch, biến từng góc khuất thành cạm bẫy bất ngờ.

Phiên bản **Web Browser Edition** mang lại sự tiện lợi tối đa:
- **Không cần cài đặt thư viện đồ họa máy bàn (như OpenGL/GLUT):** Chỉ cần mở trình duyệt web là có thể tham gia trận đấu.
- **Client Web Canvas mượt mà:** Render vector và sprite thời gian thực ở 60 FPS, giao diện Tactical Sci-Fi hiện đại.
- **Chơi thử Offline không cần server:** Người chơi có thể làm quen ngay với thao tác bắn, di chuyển và né đạn.
- **Chơi Online đồng bộ thời gian thực:** Kết nối với Backend Haskell viết bằng Software Transactional Memory (STM) và WebSockets có độ trễ cực thấp.

---

## ✨ Điểm nổi bật & Tính năng

- 🌐 **Web Client thuần Canvas 2D:** Chạy trực tiếp trên mọi trình duyệt hiện đại (Chrome, Edge, Firefox, Safari), không cần cài đặt thêm runtime phụ.
- ⚡ **Chế độ Offline Practice:** Tích hợp bộ mô phỏng vật lý ngay trong trình duyệt để huấn luyện và chơi thử mà không cần bật Server hay Database.
- 🛡️ **Haskell Authoritative Server (Online Mode):** Toàn bộ trạng thái trận đấu, di chuyển, va chạm đạn - tường và hộp bí ẩn do Server tính toán ở tần số **60 Tick/s**, chống gian lận và sai lệch trạng thái (desync).
- 🏷️ **Quản lý phòng linh hoạt:**
  - Tạo phòng 2 đến 4 người chơi.
  - Tham gia phòng nhanh bằng **Mã phòng (Room ID)** 6 ký tự.
  - Hỗ trợ **Mật khẩu phòng** cho các trận đấu riêng tư giữa bạn bè.
- 🎯 **Cơ chế điều khiển tách biệt (WASD + Chuột):**
  - Thân xe tăng xoay và di chuyển bằng cụm phím `W / A / S / D`.
  - Nòng pháo xoay tự do 360° theo con trỏ chuột.
- ⏱️ **Cơ chế hồi đạn cân bằng (Cooldown):**
  - Đạn thường: Hồi đạn **0.5 giây**, nảy tối đa **5 lần** qua tường gạch trước khi biến mất.
  - Đạn đặc biệt Mystery Box: Hồi đạn **1.0 giây** (hoặc loạt 3 viên Gatling liên thanh).
- 🧱 **Mê cung ngẫu nhiên mỗi trận (Random Labyrinth Maze):** Hệ thống tường dày đặc phong phú ngẫu nhiên thay đổi mỗi ván/round, vị trí hồi sinh xe tăng hoàn toàn ngẫu nhiên trên toàn bản đồ.
- ❓ **Hộp bí ẩn (Mystery Box) 15 giây:** Bắn nổ hộp quà để nhận 1 trong 4 loại đạn nâng cấp với hiệu lực đúng **15 giây**.
- 🍃 **Lưu trữ MongoDB:** Lưu thông tin hồ sơ tài khoản, lịch sử từng ván đấu và dữ liệu bảng xếp hạng.

---

## 🕹️ Hai chế độ chơi: Offline & Online

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        TRANG CHỦ / VÀO GAME                            │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
     [CHƠI THỬ NGAY (OFFLINE)]              [KẾT NỐI ONLINE]
                    │                                │
                    ▼                                ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│       Offline Practice Mode          │  │     Online WebSocket Multiplayer     │
│ - Chạy hoàn toàn trên trình duyệt    │  │ - Kết nối ws://localhost:8081        │
│ - Mô phỏng vật lý & bot bằng JS      │  │ - Máy chủ Haskell Authoritative 60Hz │
│ - Thử nghiệm ngắm bắn & di chuyển    │  │ - Tạo / Tìm phòng có mã số & pass    │
│ - Không cần MongoDB hay Server       │  │ - Lưu lịch sử trận vào MongoDB       │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
```

---

## 🎁 Cơ chế Hộp quà Bí ẩn (?) & Hệ thống Vũ khí

### 1. Thời gian hồi đạn tiêu chuẩn (Cooldown Reset)

- **Đạn thường (Normal Bullet):** Thời gian hồi **0.5 giây**, nảy tối đa **5 lần** qua tường gạch trước khi biến mất.
- **Đạn đặc biệt:** Thời gian hồi **1.0 giây**.
- Giao diện HUD trên web hiển thị thanh đo thời gian hồi (cooldown track) trực quan theo thời gian thực.

### 2. Sự kiện Hộp bí ẩn (Mystery Box)

Hộp quà dấu hỏi (`?`) ngẫu nhiên xuất hiện trong đấu trường sau mỗi 20–30 giây. Khi người chơi bắn nổ hộp, xe tăng nhận được đạn đặc biệt tồn tại trong **15.0 giây**:

| Biểu tượng | Loại đạn | Cơ chế hoạt động & Hồi đạn |
| :---: | :--- | :--- |
| 💥 | **Đạn chùm (Shotgun / Triple Shot)** | Bắn ra **3 viên đạn cùng lúc** theo hình rẻ quạt (góc tản ~14.3°). Phủ rộng góc hẹp. Hồi đạn: **1.0s**. |
| ⚡ | **Tia Laser (Laser Beam)** | Năng lượng phát xạ tức thì, phản xạ tức thời qua tường tối đa **5 phân đoạn**. Hồi đạn: **1.0s**. |
| 👻 | **Đạn xuyên tường (Wall-piercing Bullet)** | Bỏ qua các bức tường gạch của mê cung, **bay thẳng qua vật cản** để tiêu diệt đối phương. Hồi đạn: **1.0s**. |
| 🚀 | **Đạn liên thanh (Gatling / Burst Fire)** | Xả liên tiếp **3 viên đạn** với giãn cách cực ngắn (0.12s/viên), sau đó bước vào thời gian hồi đạn **1.0s**. |

> ⏳ **Khi hết 15 giây:** Hệ thống tự động chuyển lại vũ khí về đạn tiêu chuẩn với thời gian nạp đạn 0.5 giây.

---

## ⚙️ Quản lý Game Logic & Vòng lặp trò chơi

Ở chế độ Online, toàn bộ tính toán được điều phối tập trung trên **Haskell Server**:

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                 HASKELL SERVER GAME LOOP (Tick Rate 60Hz)              │
 └──────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 1. INPUT PROCESSING: Nhận gói PlayerInput (W/A/S/D, Góc chuột, Shoot)  │
 ├────────────────────────────────────────────────────────────────────────┤
 │ 2. WEAPON & COOLDOWN LOGIC:                                            │
 │    - Cập nhật thời gian hồi đạn (0.5s đạn thường, 1.0s đạn đặc biệt).  │
 │    - Xử lý Gatling Burst Queue (bắn liên tiếp 3 viên rồi hồi đạn).     │
 │    - Đếm ngược buff Mystery Box (15.0s -> 0.0s).                       │
 ├────────────────────────────────────────────────────────────────────────┤
 │ 3. MOVEMENT & PHYSICS:                                                 │
 │    - Cập nhật vận tốc, vị trí thân xe và góc nòng pháo.                │
 │    - Kiểm tra va chạm Tank - Tường (Sliding collision).                │
 │    - Cập nhật quỹ đạo đạn, phản xạ đạn nảy khi chạm tường gạch.        │
 ├────────────────────────────────────────────────────────────────────────┤
 │ 4. COLLISION & COMBAT RESOLUTION:                                      │
 │    - Đạn trúng Xe tăng -> Người trúng đạn phát nổ, cộng điểm người bắn.│
 │    - Đạn trúng Mystery Box -> Nhận ngẫu nhiên 1 trong 4 loại đạn (15s).│
 ├────────────────────────────────────────────────────────────────────────┤
 │ 5. BROADCAST: Gửi WorldSnapshot (JSON) đến các Web Client qua WebSocket│
 └────────────────────────────────────────────────────────────────────────┘
```

### Các trạng thái phòng đấu (Match State Machine)

1. `LobbyState`: Người chơi tập hợp trong phòng, chọn cấu hình, chờ chủ phòng bắt đầu (yêu cầu tối thiểu 2 người).
2. `CountdownState`: Đếm ngược 3 giây sẵn sàng vào trận.
3. `InGameState`: Giai đoạn thi đấu chính (60 Tick/s).
4. `RoundEndState`: Xác định xe sống sót cuối cùng, chờ 3 giây rồi sang hiệp tiếp theo.
5. `MatchOverState`: Khi có người chơi đạt điểm thắng quy định (`winningScore = 5`), kết thúc trận và ghi nhận vào **MongoDB**.

---

## 🏠 Hệ thống Máy chủ & Quản lý Phòng (Lobby & Rooms)

Máy chủ (`tankwar-server`) quản lý danh sách phòng đa luồng, hỗ trợ người chơi truy cập từ mạng LAN hoặc Internet:

```text
               ┌──────────────────────────────────────┐
               │         TANKWAR HASKELL SERVER       │
               │   (Port 8081: WebSockets + STM + DB) │
               └──────────────────┬───────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Phòng #A8F2K1   │    │  Phòng #B4M9X2   │    │  Phòng #C1K7P0   │
│  (Công khai 4/4) │    │(Có Mật khẩu 2/2) │    │  (Chờ đấu 1/2)   │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
   Trình duyệt 1..4         Trình duyệt 5..6        Trình duyệt 7
```

- **Tạo phòng (Create Room):** Chọn số người (2-4), đặt tên phòng và mật khẩu bảo mật (tùy chọn). Server tự sinh mã phòng 6 ký tự ngẫu nhiên.
- **Vào phòng theo mã (Join Room):** Nhập mã 6 ký tự và mật khẩu tương ứng để vào thẳng phòng đấu.
- **Bắt đầu trận đấu:** Chỉ chủ phòng (Host) có quyền bấm Bắt đầu khi phòng có từ 2 người chơi trở lên.

---

## 🍃 Quản lý Dữ liệu với MongoDB

Dự án kết nối MongoDB tại `mongodb://localhost:27017/TankWar` thông qua thư viện Haskell `mongoDB` và `bson`. Hồ sơ và kết quả trận được lưu chung trong collection `tankwar_server`, phân biệt bằng trường `type` (`player` hoặc `match`):

- **Loại `player`:** Hồ sơ người chơi, tổng số trận, số ván thắng, số mạng hạ gục (kills), số lần tử trận (deaths) và số hộp bí ẩn đã nhặt.
- **Loại `match`:** Lưu lại thông tin phòng, thời gian bắt đầu/kết thúc, người chiến thắng, điểm số từng người và số vòng đã chơi.
- **Bảng xếp hạng:** Được truy vấn từ hồ sơ `player` trong collection này, sắp xếp theo số trận thắng hoặc kills.

---

## 🕹️ Hướng dẫn điều khiển

| Thao tác | Phím / Chuột | Mô tả hành động |
| :---: | :---: | :--- |
| **Di chuyển thân xe** | `W` / `A` / `S` / `D` | `W` (Tiến), `S` (Lùi), `A` (Rẽ trái), `D` (Rẽ phải) |
| **Xoay nòng pháo** | **Con trỏ chuột** | Nòng pháo tự động quay 360° theo vị trí chuột trên sàn đấu |
| **Khai hỏa (Bắn)** | **Click chuột trái (LMB)** hoặc `Space` | Bắn theo hướng nòng pháo (Đạn thường hồi 1.0s, Gatling xả 3 viên liên thanh) |
| **Rời trận / Menu** | `Esc` hoặc nút **RỜI TRẬN** | Mở menu tạm dừng hoặc rời ván đấu trở về trang chủ |
| **Bật/Tắt âm thanh** | Nút **♫** trên thanh tiêu đề | Bật hoặc tắt hiệu ứng âm thanh cảnh báo |

---

## 🛠️ Kiến trúc Công nghệ

### 1. Backend (Haskell)
- **Ngôn ngữ:** Haskell (GHC 9.4+).
- **Web Framework / Networking:** `websockets` (truyền nhận gói tin real-time) kết hợp `aeson` (JSON format).
- **Concurrency & State:** `stm` (Software Transactional Memory) với cấu trúc `TVar (Map RoomId RoomState)`, loại bỏ hoàn toàn race condition và deadlock.
- **Database Driver:** `mongoDB` và `bson`.

### 2. Frontend (Web Browser Edition)
- **Công nghệ cốt lõi:** HTML5, CSS3, JavaScript thuần (Vanilla JS), không cần bundler cồng kềnh.
- **Renderer:** HTML5 Canvas API (832 × 576), hỗ trợ vẽ sprite xe tăng, nòng súng xoay động, tia laser phản xạ và hạt hiệu ứng.
- **Giao diện:** Thiết kế Tactical Dark Theme, HUD hiển thị thời gian hồi đạn, thanh buff 15s và bảng chiến báo (Combat Log).
- **Mạng phía Web:** `WebSocket` API bản địa của trình duyệt, tự động kết nối và xử lý thông điệp JSON tương thích với giao thức Haskell.

---

## 📁 Cấu trúc thư mục dự án

```text
LTH-TankWar-HaskellGame-main/
├── src/
│   └── Common/
│       ├── Config.hs           -- Hằng số trò chơi (TickRate 60, Cooldown 1s/2s, Buff 15s)
│       ├── Protocol.hs         -- Giao thức mạng JSON (ClientMessage, ServerMessage)
│       └── Types.hs            -- Kiểu dữ liệu Tank, Bullet, MysteryBox, Maze
│
├── server/
│   ├── Main.hs                 -- Điểm khởi chạy WebSocket Server & kết nối MongoDB
│   └── Server/
│       ├── State.hs            -- Quản lý TVar chứa danh sách phòng và kết nối client
│       ├── RoomManager.hs      -- Xử lý logic tạo phòng, mã phòng, mật khẩu
│       ├── GameEngine.hs       -- Vòng lặp vật lý 60Hz, nảy đạn, Gatling 3 viên, buff 15s
│       └── Database/
│           ├── Connection.hs   -- Quản lý MongoDB Connection Pool
│           ├── PlayerRepo.hs   -- Thao tác CRUD hồ sơ người chơi và thống kê
│           └── MatchRepo.hs    -- Lưu trữ lịch sử kết quả trận đấu
│
├── web/                        -- Frontend Web Browser Client
│   ├── index.html              -- Màn hình menu, phòng chờ (lobby) và sàn đấu canvas
│   ├── style.css               -- Giao diện Tactical Sci-Fi, responsive
│   ├── app.js                  -- Canvas Renderer, chế độ Offline & WebSocket Client
│   ├── README.md               -- Hướng dẫn nhanh cho riêng web frontend
│   └── assets/
│       └── img/                -- Sprite xe tăng, đạn và hiệu ứng
│
├── package.yaml                -- Cấu hình gói Haskell (Hpack)
├── stack.yaml                  -- Cấu hình Stack toolchain
├── tankwar.cabal               -- Cabal build file
└── README.md                   -- Tài liệu dự án chính
```

---

## 🚀 Yêu cầu hệ thống & Hướng dẫn khởi chạy

### Yêu cầu tiên quyết

1. **Trình duyệt web:** Google Chrome, Microsoft Edge, Firefox hoặc Safari.
2. **Một Static Web Server nhẹ:** Python 3 (`py -m http.server`) hoặc Live Server (VS Code) / `npx serve`.
3. **Chơi Online (Haskell Server & Database):**
   - [GHC](https://www.haskell.org/ghc/) phiên bản >= 9.2 (khuyên dùng qua [GHCup](https://www.haskell.org/ghcup/))
   - [Stack](https://docs.haskellstack.org/) hoặc [Cabal](https://www.haskell.org/cabal/)
   - [Docker](https://www.docker.com/) (để chạy MongoDB tiện lợi)

---

### Hướng dẫn 1: Chơi thử ngay chế độ Offline (Không cần Haskell hay MongoDB)

Chỉ cần một dòng lệnh mở web server:

```powershell
# Chạy tại thư mục gốc của dự án
py -m http.server 5173
```

Mở trình duyệt tại:
```text
http://localhost:5173/web/
```

Nhập tên chiến binh và nhấn **CHƠI THỬ NGAY (OFFLINE)** để trải nghiệm điều khiển xe tăng ngay lập tức.

---

### Chơi online giữa các mạng khác nhau (khuyến nghị)

Repo có server Node.js phục vụ cả trang web và WebSocket trên cùng cổng, không cần MongoDB:

```powershell
node server.js 3000
```

Mở `http://localhost:3000/` để kiểm tra trên máy chủ. Để bạn bè ở mạng khác vào, máy chủ phải có IP công khai/tên miền. Nếu chạy tại nhà, đặt IP LAN cố định cho máy chủ, cho phép Node.js/cổng TCP `3000` trong firewall Windows, rồi cấu hình router chuyển tiếp TCP `3000` về máy đó. Gửi bạn bè `http://IP-CÔNG-KHAI:3000/`; client tự kết nối WebSocket cùng địa chỉ. Nếu ISP dùng CGNAT, hãy chạy server trên VPS/hosting có IP công khai. Với tên miền HTTPS, cần reverse proxy TLS hỗ trợ WebSocket (`wss://`). Không mở cổng MongoDB ra Internet.

### Khởi chạy Online Multiplayer bằng Haskell (cần MongoDB)

#### Bước 1: Khởi động Cơ sở dữ liệu MongoDB

Chạy container MongoDB bằng Docker:

```powershell
docker run -d -p 27017:27017 --name tankwar-mongo mongo:latest
```

*(Nếu container đã tồn tại từ trước, chỉ cần chạy: `docker start tankwar-mongo`)*

#### Bước 2: Khởi động Haskell Dedicated Server

Mở một cửa sổ Terminal mới tại thư mục gốc dự án:

```powershell
# Đặt PowerShell/Windows Console dùng UTF-8 để hiển thị tiếng Việt
chcp 65001
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

# Sử dụng Stack (Khuyên dùng)
stack exec tankwar-server -- --port 8081 --mongo-uri "mongodb://localhost:27017/TankWar"

# Hoặc sử dụng Cabal
cabal run tankwar-server -- --port 8081 --mongo-uri "mongodb://localhost:27017/TankWar"
```

Khi server sẵn sàng, terminal sẽ thông báo lắng nghe tại cổng `8081` và kết nối thành công tới MongoDB.

#### Bước 3: Mở Web Client & Kết nối

1. Mở trình duyệt tại `http://localhost:5173/web/`.
2. Nhập tên của bạn, giữ nguyên địa chỉ WebSocket `ws://localhost:8081`.
3. Nhấn **KẾT NỐI ONLINE**.
4. Người chơi 1 bấm **TẠO PHÒNG MỚI**, sau đó gửi **Mã phòng** (ví dụ `TNK889`) cho bạn bè.
5. Người chơi 2 mở trình duyệt (hoặc máy tính khác cùng mạng), nhập mã phòng và bấm **VÀO PHÒNG**.
6. Khi đủ từ 2 người trở lên, chủ phòng nhấn **BẮT ĐẦU TRẬN** để chiến đấu!

---

### Hướng dẫn 3: Khởi chạy 1 lệnh duy nhất với Docker Compose

Nếu máy đã cài Docker Desktop, từ thư mục gốc dự án chạy MongoDB, Haskell Server và web client cùng nhau:

```powershell
docker compose up --build -d
```

Compose build image ứng dụng, chờ MongoDB khỏe mạnh rồi khởi động game server. Trang game sẵn sàng tại `http://localhost:10000/`; WebSocket dùng cùng địa chỉ. Dữ liệu MongoDB được giữ trong volume `mongo-data`.

#### Cho máy khác trong LAN hoặc Internet truy cập

Compose công khai cổng TCP `10000` trên các card mạng của máy chủ. Client tự kết nối WebSocket qua cùng địa chỉ `/ws`, vì vậy người chơi chỉ cần mở một URL:

1. Khởi động stack: `docker compose up --build -d`.
2. Cho phép TCP `10000` qua Windows Defender Firewall trên máy chủ (PowerShell chạy bằng quyền Administrator):

   ```powershell
   New-NetFirewallRule -DisplayName "TankWar Docker Server" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 10000
   ```

3. Máy trong cùng mạng Wi-Fi/LAN mở `http://IP-LAN-CUA-MAY-CHU:10000/`. Tìm IP LAN bằng `ipconfig` (thường là địa chỉ IPv4 của Wi-Fi/Ethernet, ví dụ `192.168.1.20`). Đặt DHCP reservation cho máy chủ trong router để IP này không thay đổi.
4. Để bạn bè ngoài Internet truy cập, cấu hình router **port forwarding TCP 10000** tới IP LAN của máy chủ và gửi `http://IP-CÔNG-KHAI:10000/` cho họ. Không forward cổng MongoDB `27017`.

Nếu router không có IP WAN công khai (CGNAT), port forwarding sẽ không truy cập được từ Internet. Khi đó cần xin nhà mạng IP công khai hoặc dùng VPS/tunnel có public endpoint. Giữ máy tính bật, Docker Desktop chạy, và để máy không ngủ trong lúc host.

Truy cập Internet hiện dùng HTTP/WS; phù hợp để thử nghiệm nhưng không mã hóa lưu lượng. Nếu dùng domain/HTTPS, đặt reverse proxy có TLS phía trước và proxy cả HTTP lẫn WebSocket tới cổng `10000`.

Lệnh vận hành thường dùng:

```powershell
docker compose logs -f tankwar  # xem log server
docker compose down             # dừng server; volume dữ liệu MongoDB vẫn còn
```

---

### 🧪 Chạy bộ kiểm thử tự động (Automated Unit Tests)

Dự án tích hợp bộ test tự động kiểm tra Vector math, Cooldown vũ khí và tính toàn vẹn gói tin JSON Protocol:

```powershell
# Chạy toàn bộ 16 test cases bằng Cabal
cabal test
```

---

## 🔒 Ghi chú triển khai Production (HTTPS / WSS)

- **Frontend tĩnh:** Có thể deploy thư mục `web/` lên bất kỳ dịch vụ hosting tĩnh nào như Vercel, Netlify, Cloudflare Pages hoặc GitHub Pages.
- **WebSocket bảo mật:** Khi web client được phân phối qua giao thức HTTPS, trình duyệt bắt buộc phải kết nối WebSocket bảo mật (**`wss://`**).
- Để triển khai Server ra Internet:
  1. Cấu hình Nginx / Caddy làm Reverse Proxy với chứng chỉ SSL/TLS miễn phí (Let's Encrypt).
  2. Proxy đường truyền WebSocket từ cổng 443 về cổng nội bộ `8081` của Haskell Server.
  3. Người chơi nhập URL dạng `wss://yourdomain.com` vào ô cấu hình server trên web.

---

## 📄 Tài liệu đồ án

Nội dung trình bày chi tiết kiến trúc, eager/lazy evaluation, STM, WebSocket, MongoDB, kiểm thử và phân công trách nhiệm nằm tại [BAO_CAO_DO_AN.md](BAO_CAO_DO_AN.md).

---

## 🗺️ Lộ trình phát triển (Roadmap)

- [x] Chuyển đổi giao diện sang nền tảng **Web Browser (HTML5 Canvas)** tiện lợi, không phụ thuộc OpenGL/GLUT.
- [x] Chế độ **Offline Practice** giúp người chơi làm quen thao tác ngay trong trình duyệt.
- [x] Hệ thống âm thanh **Web Audio SoundFX** (tiếng súng riêng từng loại đạn, nổ, nảy tường, nhặt hộp, đếm ngược).
- [x] Đồng bộ hóa danh sách phòng chờ hoàn chỉnh (**Lobby Roster Sync** qua `SRoomRoster`).
- [x] Cơ chế điều khiển thân xe WASD + nòng pháo xoay 360° theo chuột.
- [x] Hệ thống phòng (Room ID 6 ký tự, Mật khẩu, Tạo & Tham gia phòng).
- [x] Server Authoritative xử lý vật lý 60Hz bằng Haskell STM.
- [x] Tích hợp cơ sở dữ liệu MongoDB lưu trữ hồ sơ, lịch sử trận đấu và điểm số.
- [x] Bộ kiểm thử tự động (**16/16 Unit Tests**) kiểm tra toán học vector và giao thức mạng.
- [x] Đóng gói container hóa toàn diện với **Dockerfile** & **docker-compose.yml**.
- [ ] Tính năng Chat thời gian thực trong phòng chờ (In-game Lobby Chat).
- [ ] Bảng xếp hạng trực tiếp trong game (Live In-game Leaderboard modal).

---

## 🤝 Đóng góp & Giấy phép

Mọi đóng góp, báo cáo lỗi (Issue) hoặc đề xuất tính năng mới (Pull Request) đều được hoan nghênh!

Dự án được phân phối dưới giấy phép **MIT License**. Chi tiết xem tại tệp [LICENSE](LICENSE).
