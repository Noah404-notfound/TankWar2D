# Báo cáo đồ án TankWar

## 1. Giới thiệu và mục tiêu
TankWar là game xe tăng đối kháng nhiều người, gồm backend Haskell, giao thức WebSocket và frontend HTML5 Canvas. Máy chủ là phía có thẩm quyền (authoritative server), tính toán trạng thái trận đấu, va chạm và vật lý đạn ở tần số 60 Hz.

## 2. Kiến trúc hệ thống
- `src/Common`: kiểu dữ liệu dùng chung, cấu hình, giao thức JSON, parser Megaparsec và luật game thuần.
- `server/Server`: trạng thái STM, quản lý phòng, game engine, truy cập MongoDB và lưu lịch sử trận JSON cục bộ.
- `server/Main.hs`: khởi tạo server WebSocket và điều phối kết nối.
- `web`: giao diện Canvas, chế độ offline và client WebSocket.
- `test/Spec.hs`: kiểm thử vector, cooldown và tuần tự hóa giao thức.

## 3. Kỹ thuật lập trình hàm đã sử dụng

### Kiểu dữ liệu và máy trạng thái
Dự án sử dụng ADT cho xe tăng, đạn, loại đạn, pha trận đấu và thông điệp giao thức. Các kiểu rời rạc giúp game engine xác định trạng thái bằng chuyển mẫu thay vì điều kiện chuỗi phức tạp.

### Hàm bậc cao, đệ quy và danh sách
Vòng lặp game được mô hình hóa bằng hàm đệ quy. Dữ liệu xe tăng và đạn được xử lý bằng `map`, `filter`, `Map.mapWithKey`, `fold`, danh sách comprehension và các hàm xử lý va chạm.

### Monad và xử lý I/O
Máy chủ dùng `IO` cho mạng, WebSocket, MongoDB, đọc/ghi file JSON và hẹn giờ. STM dùng `STM`/`atomically` để cập nhật trạng thái phòng và danh sách client. Các lỗi ngoại lệ được bắt bằng `try`; kết nối MongoDB không khả dụng không làm server crash, còn lịch sử trận vẫn được ghi trong `data/match-history.json` dưới khóa `MVar`.

### Parser combinator
`Common.CommandParser` dùng Megaparsec để phân tích tham số khởi động `--port` và `--mongo-uri`. Parser kiểm tra miền cổng, URI MongoDB và lựa chọn trùng lặp; lỗi giữ vị trí nguồn rõ ràng từ `errorBundlePretty`. Nhờ vậy đây là parser có ngữ pháp và thông báo lỗi, không chỉ là tách chuỗi thủ công.

### Đồng bộ hóa
Trạng thái toàn cục được lưu trong TVar. Đăng ký username, tạo phòng, vào phòng và chuyển Lobby sang Countdown kiểm tra điều kiện rồi cập nhật room/client trong đúng một transaction STM; vì vậy không vượt sức chứa phòng hoặc fork lặp game hai lần do hai request cùng lúc. Mỗi phòng có một game loop riêng bằng `forkIO`. Tệp cấu hình server bật `-threaded`, `-with-rtsopts=-N` để hỗ trợ nhiều capability Haskell runtime.

## 4. Tính eager/lazy và đánh giá hiệu năng
Haskell mặc định dùng lazy evaluation. Trong dự án, danh sách/map có thể được trì hoãn cho đến khi render hoặc broadcast; điều này tránh tính toán không cần thiết một phần. Tuy nhiên, trạng thái game tick và broadcast là dữ liệu nhạy cảm về thời gian nên đã dùng strict fields (`!`) cho các trường thường xuyên truy cập, đồng thời dùng strict Map operations trong trạng thái và thao tác atomic bằng STM.

Các hàm quản lý snapshot tạo dữ liệu hợp lý mỗi tick; Strict fields và bang patterns trong các module cấu hình/state giảm việc giữ nhiều thunk và giúp duy trì 60 Hz. Cần tránh gom danh sách đạn/quả cầu trong một vòng đệ quy dài mà không buộc dữ liệu, vì lazy list có thể tích tụ thunk và làm latency không ổn định. Khi benchmark cần chạy với `+RTS -s -N`, đo số tick, độ trễ WebSocket và bộ nhớ để xác nhận.

## 5. Lưu trữ và mạng
Backend hỗ trợ WebSocket hai chiều và MongoDB cho hồ sơ/kết quả trận. `Server.Persistence` lưu/nạp lịch sử trận bằng Aeson JSON, làm bảng xếp hạng cục bộ khi MongoDB vắng mặt. Các thông điệp WebSocket được tuần tự hóa bằng Aeson JSON, có kiểm thử round-trip.

## 6. Kiểm thử
`cabal test` kiểm tra:
- phép tính vector và reflection;
- cooldown của các loại đạn;
- độ dài buff và số đạn Gatling/bounces;
- mã hóa/giải mã JSON của `ClientMessage` và `ServerMessage`.
- parser Megaparsec với URI hợp lệ, cổng sai và option không hợp lệ;
- state machine vũ khí, laser hitscan và phản xạ laser.

## 7. Đường dẫn chứng minh
| Nội dung | Chứng minh |
|---|---|
| ADT, JSON, strict fields | `src/Common/Types.hs`, `src/Common/Protocol.hs` |
| Parser combinator | `src/Common/CommandParser.hs` |
| Luật game thuần và laser | `src/Common/GameRules.hs`, `server/Server/GameEngine.hs` |
| STM/TVar | `server/Server/State.hs` |
| Game loop/thread 60 Hz | `server/Server/GameEngine.hs`, `tankwar.cabal` |
| Quản lý phòng | `server/Server/RoomManager.hs` |
| WebSocket/MongoDB | `server/Main.hs`, `server/Server/Database/` |
| Lưu/nạp JSON cục bộ | `server/Server/Persistence.hs` |
| GUI | `web/index.html`, `web/app.js`, `web/style.css` |
| Kiểm thử | `test/Spec.hs` |

## 8. Phân công trách nhiệm
- Backend Haskell, game engine và STM: phát triển vòng đời game, cập nhật vật lý, đồng bộ và broadcast.
- Mô hình dữ liệu/protocol: khai báo ADT, JSON và cấu hình dùng chung.
- Quản lý phòng/MongoDB: lobby, kết nối, lưu trữ hồ sơ và kết quả trận.
- Web frontend: Canvas renderer, điều khiển, offline practice và client WebSocket.
- Kiểm thử: vector, cooldown, JSON round-trip, parser và luật vũ khí/laser.

## 9. Hạn chế và hướng hoàn thiện
- MongoDB hiện là một kết nối tự reconnect, chưa phải pool production đầy đủ.
- Cần chạy tích hợp nhiều client cùng lúc để kiểm tra desync, sức chịu tải và kết thúc thread khi phòng trống.
- Cần đo benchmark thực tế với `+RTS -s -N` và ghi số liệu vào báo cáo nộp.
