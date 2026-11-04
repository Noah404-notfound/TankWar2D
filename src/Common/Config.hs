-- | Common.Config
-- Tất cả hằng số cấu hình của trò chơi TankWar.
-- Được dùng chung giữa Client (render) và Server (game logic).
module Common.Config where

import Common.Types (BulletType(..))

--------------------------------------------------------------------------------
-- Tick Rate & Timing
--------------------------------------------------------------------------------

-- | Số lần cập nhật game loop mỗi giây (Server Authoritative).
tickRate :: Int
tickRate = 60

-- | Số snapshot gửi tới mỗi client mỗi giây. Đặt bằng 'tickRate' để client
-- nhận trạng thái mới ở mọi tick; 30 Hz làm hình ảnh chỉ còn 30 fps.
snapshotRate :: Int
snapshotRate = 60

-- | Số tick vật lý giữa hai snapshot mạng. Luôn ít nhất một tick để cấu hình
-- vẫn an toàn nếu snapshotRate được thay đổi.
snapshotEveryTicks :: Int
snapshotEveryTicks = max 1 (tickRate `div` snapshotRate)

-- | Delta time mỗi tick (giây).
dt :: Float
dt = 1.0 / fromIntegral tickRate    -- ≈ 0.01667s

--------------------------------------------------------------------------------
-- Cooldown & Vũ khí
--------------------------------------------------------------------------------

-- | Thời gian hồi đạn thường sau mỗi phát bắn (giây).
normalBulletCooldown :: Float
normalBulletCooldown = 0.5

-- | Thời gian hồi đạn sự kiện / đạn đặc biệt từ Mystery Box (giây).
specialBulletCooldown :: Float
specialBulletCooldown = 1.0

-- | Thời gian nạp lại đầy băng đạn, khớp chế độ đấu nhanh.
magazineReloadSeconds :: Float
magazineReloadSeconds = 2.2

-- | Số viên trong băng đạn tiêu chuẩn.
magazineSize :: Int
magazineSize = 6

-- | Hàm tính thời gian hồi đạn theo loại vũ khí:
-- Đạn thường 0.5 giây, đạn sự kiện Mystery Box 1.0 giây.
weaponCooldown :: BulletType -> Float
weaponCooldown NormalBullet = normalBulletCooldown
weaponCooldown _            = specialBulletCooldown

-- | Alias thời gian hồi đạn mặc định (tương thích ngược).
cooldownTime :: Float
cooldownTime = normalBulletCooldown

-- | Thời gian hiệu lực buff từ Mystery Box (giây).
buffDuration :: Float
buffDuration = 15.0

-- | Số viên đạn trong một loạt Gatling burst.
gatlingBurstCount :: Int
gatlingBurstCount = 3

-- | Khoảng cách thời gian giữa mỗi viên trong loạt Gatling (giây).
gatlingBurstDelay :: Float
gatlingBurstDelay = 0.12

-- | Góc mở tối đa (radian) mỗi bên cho Shotgun (tổng = 2x).
shotgunSpreadAngle :: Float
shotgunSpreadAngle = 0.25   -- ≈ 14.3°

--------------------------------------------------------------------------------
-- Đạn (Bullet)
--------------------------------------------------------------------------------

-- | Tốc độ đạn tiêu chuẩn (pixel/giây).
bulletSpeed :: Float
bulletSpeed = 1220.0

-- | Tốc độ đạn xuyên tường (chậm hơn một chút để cân bằng).
wallPiercingSpeed :: Float
wallPiercingSpeed = 1067.0

-- | Đạn không còn nảy; giữ trường cấu hình để tương thích protocol cũ.
maxBulletBounces :: Int
maxBulletBounces = 0

-- | Thời gian sống tối đa của đạn (giây).
bulletMaxLifetime :: Float
bulletMaxLifetime = 5.0

-- | Bán kính va chạm của viên đạn.
bulletRadius :: Float
bulletRadius = 4.0

-- | Số phân đoạn phản xạ tối đa của laser.
laserMaxReflections :: Int
laserMaxReflections = 5

-- | Chiều dài tối đa mỗi phân đoạn laser (pixel).
laserSegmentMaxLen :: Float
laserSegmentMaxLen = 2000.0

--------------------------------------------------------------------------------
-- Xe tăng (Tank)
--------------------------------------------------------------------------------

-- | Tốc độ di chuyển của xe tăng (pixel/giây).
tankSpeed :: Float
tankSpeed = 450.0

-- | Kích thước nửa cạnh (half-size) của hitbox vuông xe tăng.
tankHalfSize :: Float
tankHalfSize = 16.0

-- | Bán kính va chạm của xe tăng (dùng circle collider cho đơn giản).
tankRadius :: Float
tankRadius = 18.0

--------------------------------------------------------------------------------
-- Mystery Box
--------------------------------------------------------------------------------

-- | Khoảng thời gian tối thiểu giữa các lần spawn hộp bí ẩn (giây).
boxSpawnIntervalMin :: Float
boxSpawnIntervalMin = 20.0

-- | Khoảng thời gian tối đa giữa các lần spawn (giây).
boxSpawnIntervalMax :: Float
boxSpawnIntervalMax = 30.0

-- | Bán kính va chạm của hộp bí ẩn.
boxRadius :: Float
boxRadius = 14.0

--------------------------------------------------------------------------------
-- Mê cung (Maze)
--------------------------------------------------------------------------------

-- | Kích thước ô lưới cơ bản của mê cung (pixel).
cellSize :: Float
cellSize = 64.0

-- | Chiều rộng bản đồ mê cung mặc định (pixel).
defaultMazeWidth :: Float
defaultMazeWidth = 1344.0   -- 21 ô * 64px

-- | Chiều cao bản đồ mê cung mặc định (pixel).
defaultMazeHeight :: Float
defaultMazeHeight = 704.0   -- 11 ô * 64px

-- | Độ dày tường (dùng cho render, collider dùng segment).
wallThickness :: Float
wallThickness = 4.0

--------------------------------------------------------------------------------
-- Phòng (Room)
--------------------------------------------------------------------------------

-- | Số người chơi tối thiểu để bắt đầu trận đấu.
minPlayersToStart :: Int
minPlayersToStart = 2

-- | Số người chơi tối đa mỗi phòng.
maxPlayersPerRoom :: Int
maxPlayersPerRoom = 4

-- | Độ dài Room ID tự sinh.
roomIdLength :: Int
roomIdLength = 6

-- | Số round cần thắng để kết thúc trận đấu (First to N).
winningScore :: Int
winningScore = 5

-- | Thời gian countdown trước round (giây).
countdownDuration :: Float
countdownDuration = 3.0

-- | Thời gian hiển thị kết quả kết thúc round trước khi reset (giây).
roundEndDelay :: Float
roundEndDelay = 3.0

--------------------------------------------------------------------------------
-- Mạng (Network)
--------------------------------------------------------------------------------

-- | Cổng WebSocket mặc định.
defaultPort :: Int
defaultPort = 8081

-- | Cổng MongoDB mặc định.
defaultMongoPort :: Int
defaultMongoPort = 27017

-- | Tên database MongoDB.
mongoDbName :: String
mongoDbName = "TankWar"

-- | Khoảng thời gian ping WebSocket (giây).
wsPingInterval :: Int
wsPingInterval = 30

--------------------------------------------------------------------------------
-- Luật chơi online (đồng bộ với chế độ offline trong web/app.js)
--------------------------------------------------------------------------------

-- | Thời gian chờ hồi sinh (giây). Đấu đội không hồi sinh trong cùng một round.
respawnSeconds :: Float
respawnSeconds = 5.0

-- | Thời gian bất tử sau khi hồi sinh (giây).
invulnerableSeconds :: Float
invulnerableSeconds = 1.5

-- | Điểm cho mỗi giây còn sống.
survivalPointsPerSecond :: Int
survivalPointsPerSecond = 3

-- | Điểm cho mỗi lần hạ đối thủ.
killPoints :: Int
killPoints = 10

-- | Điểm thưởng khi chặn đứng chuỗi hạ liên tiếp của đối thủ.
shutdownBonus :: Int
shutdownBonus = 20

-- | Số mạng hạ liên tiếp để được tính là một chuỗi (shutdown).
streakStartKills :: Int
streakStartKills = 3

-- | Thời lượng trận Tử chiến (giây).
deathmatchSeconds :: Float
deathmatchSeconds = 300.0

-- | Số round tối đa của Đấu đội (thắng quá nửa số round là thắng trận).
teamRounds :: Int
teamRounds = 5

-- | Thời lượng một round Đấu đội (giây).
teamRoundSeconds :: Float
teamRoundSeconds = 120.0

-- | Thời gian hiển thị kết quả round Đấu đội (giây).
teamRoundEndDelay :: Float
teamRoundEndDelay = 5.0

-- | Bán kính vùng chiếm Cấm Địa (pixel).
zoneRadius :: Float
zoneRadius = 480.0

-- | Thời gian vùng chiếm bị khoá lúc đầu trận (giây).
zoneLockSeconds :: Float
zoneLockSeconds = 10.0

-- | Thời gian để một đội chiếm đủ 100% (giây).
zoneCaptureSeconds :: Float
zoneCaptureSeconds = 300.0

-- | Hệ số tốc độ khi đội đạt từ 70%.
zoneSpeedAt70 :: Float
zoneSpeedAt70 = 1.1

-- | Hệ số tốc độ của đội còn dưới 50% khi đội kia đã đạt 50%.
zoneSpeedBehindAt50 :: Float
zoneSpeedBehindAt50 = 1.2

-- | Thời gian áp đảo liên tục để thắng khi cả hai đội cùng 99%.
zoneContestSeconds :: Float
zoneContestSeconds = 5.0

-- | Tầm bay tối đa của đạn (pixel) = 30% kích thước bản đồ 4096.
bulletRange :: Float
bulletRange = 1228.8

-- | Bán kính trúng đạn của xe tăng và của viên đạn (chỉ dùng cho va chạm đạn).
tankHitRadius :: Float
tankHitRadius = 36.0

bulletHitRadius :: Float
bulletHitRadius = 14.0
