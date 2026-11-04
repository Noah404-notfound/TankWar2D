{-# LANGUAGE OverloadedStrings #-}
-- | Common.Types
-- Định nghĩa toàn bộ kiểu dữ liệu dùng chung giữa Client và Server.
-- Bao gồm: Vec2, Tank, Bullet, MysteryBox, Maze, WeaponState, GamePhase, v.v.
module Common.Types
  ( -- * Toán học 2D
    Vec2(..)
  , vec2Add, vec2Sub, vec2Scale, vec2Dot, vec2Len, vec2Normalize, vec2Reflect
  , vec2Rotate, vec2Angle, vec2Dist, vec2Zero

    -- * Loại đạn & Vũ khí
  , BulletType(..)
  , CooldownState(..)
  , WeaponState(..)
  , defaultWeaponState

    -- * Thực thể trong trận đấu
  , Tank(..)
  , TankColor(..)
  , Bullet(..)
  , LaserSegment(..)
  , MysteryBox(..)

    -- * Mê cung & Tường
  , Wall(..)
  , Maze(..)

    -- * Pha trận đấu (State Machine)
  , GamePhase(..)

    -- * Thông tin phòng
  , RoomInfo(..)

    -- * Trạng thái thế giới (broadcast mỗi tick)
  , WorldSnapshot(..)
  , ZoneState(..)

    -- * Input từ Client
  , PlayerInput(..)
  , emptyInput

    -- * Thông tin người chơi (DB)
  , PlayerStats(..)
  , PlayerProfile(..)
  , MatchRecord(..)
  , MatchPlayerRecord(..)
  ) where

import Data.Text    (Text)
import Data.Aeson   (ToJSON(..), FromJSON(..), genericToJSON, genericParseJSON,
                     defaultOptions, Options, fieldLabelModifier, constructorTagModifier,
                     sumEncoding, SumEncoding(..), withObject, (.:), (.:?), (.!=))
import GHC.Generics (Generic)
import Data.Char    (toLower)

--------------------------------------------------------------------------------
-- JSON tuỳ chỉnh: bỏ prefix trường, tag constructor lowercase
--------------------------------------------------------------------------------

tankWarJSONOptions :: String -> Data.Aeson.Options
tankWarJSONOptions prefix = defaultOptions
  { fieldLabelModifier    = camelTo . drop (length prefix)
  , constructorTagModifier = map toLower
  , sumEncoding           = ObjectWithSingleField
  }
  where
    camelTo []     = []
    camelTo (c:cs) = toLower c : cs

-- Dùng encoding mặc định (derive tự động) cho hầu hết các kiểu
-- Chỉ tuỳ chỉnh cho những kiểu cần thiết

--------------------------------------------------------------------------------
-- Toán học Vector 2D
--------------------------------------------------------------------------------

-- | Vector 2 chiều dùng cho vị trí và vận tốc.
data Vec2 = Vec2
  { vx :: {-# UNPACK #-} !Float
  , vy :: {-# UNPACK #-} !Float
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

vec2Zero :: Vec2
vec2Zero = Vec2 0 0

vec2Add :: Vec2 -> Vec2 -> Vec2
vec2Add (Vec2 x1 y1) (Vec2 x2 y2) = Vec2 (x1 + x2) (y1 + y2)

vec2Sub :: Vec2 -> Vec2 -> Vec2
vec2Sub (Vec2 x1 y1) (Vec2 x2 y2) = Vec2 (x1 - x2) (y1 - y2)

vec2Scale :: Float -> Vec2 -> Vec2
vec2Scale s (Vec2 x y) = Vec2 (s * x) (s * y)

vec2Dot :: Vec2 -> Vec2 -> Float
vec2Dot (Vec2 x1 y1) (Vec2 x2 y2) = x1 * x2 + y1 * y2

vec2Len :: Vec2 -> Float
vec2Len v = sqrt (vec2Dot v v)

vec2Normalize :: Vec2 -> Vec2
vec2Normalize v
  | len < 1e-8 = vec2Zero
  | otherwise  = vec2Scale (1.0 / len) v
  where len = vec2Len v

-- | Phản xạ vector v qua mặt phẳng có pháp tuyến n (đã chuẩn hoá).
--   v' = v - 2*(v·n)*n
vec2Reflect :: Vec2 -> Vec2 -> Vec2
vec2Reflect v n = vec2Sub v (vec2Scale (2.0 * vec2Dot v n) n)

-- | Xoay vector một góc (radian) ngược chiều kim đồng hồ.
vec2Rotate :: Float -> Vec2 -> Vec2
vec2Rotate angle (Vec2 x y) = Vec2
  (x * cos angle - y * sin angle)
  (x * sin angle + y * cos angle)

-- | Góc (radian) tạo bởi vector so với trục Ox.
vec2Angle :: Vec2 -> Float
vec2Angle (Vec2 x y) = atan2 y x

-- | Khoảng cách Euclid giữa hai điểm.
vec2Dist :: Vec2 -> Vec2 -> Float
vec2Dist a b = vec2Len (vec2Sub a b)

--------------------------------------------------------------------------------
-- Loại đạn (BulletType) từ Mystery Box
--------------------------------------------------------------------------------

-- | Các loại đạn trong trò chơi.
data BulletType
  = NormalBullet         -- ^ Đạn tiêu chuẩn, nảy qua tường
  | ShotgunBullet        -- ^ Bắn 3 viên hình rẻ quạt
  | LaserBullet          -- ^ Tia laser tốc độ ánh sáng, phản xạ tường
  | WallPiercingBullet   -- ^ Đạn xuyên tường, bay thẳng
  | GatlingBullet        -- ^ Liên thanh 3 viên rồi mới cooldown
  deriving (Show, Eq, Ord, Enum, Bounded, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Trạng thái Cooldown (State Machine nạp đạn)
--------------------------------------------------------------------------------

-- | Trạng thái máy bắn đạn.
data CooldownState
  = Ready                        -- ^ Sẵn sàng khai hoả
  | Reloading  {-# UNPACK #-} !Float
    -- ^ Đang nạp đạn, đếm ngược còn lại (giây). Đạn thường: 1.0s, Đạn box: 2.0s.
  | GatlingBurst {-# UNPACK #-} !Int {-# UNPACK #-} !Float
    -- ^ (Số viên còn lại trong loạt 3, delay giữa các viên)
  deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Trạng thái Vũ khí
--------------------------------------------------------------------------------

-- | Trạng thái vũ khí hiện tại của xe tăng.
data WeaponState = WeaponState
  { wsCurrentWeapon :: !BulletType
  , wsBuffTimeLeft  :: {-# UNPACK #-} !Float
    -- ^ Thời gian hiệu lực còn lại của buff Mystery Box (tối đa 15.0s)
  , wsCooldownState :: !CooldownState
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

-- | Trạng thái vũ khí mặc định (đạn thường, sẵn sàng bắn).
defaultWeaponState :: WeaponState
defaultWeaponState = WeaponState
  { wsCurrentWeapon = NormalBullet
  , wsBuffTimeLeft  = 0.0
  , wsCooldownState = Ready
  }

--------------------------------------------------------------------------------
-- Màu xe tăng
--------------------------------------------------------------------------------

data TankColor
  = TankRed | TankBlue | TankGreen | TankYellow
  deriving (Show, Eq, Ord, Enum, Bounded, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Xe tăng (Tank)
--------------------------------------------------------------------------------

-- | Trạng thái đầy đủ của một xe tăng trong trận đấu.
data Tank = Tank
  { tankId         :: !Text
    -- ^ Unique identifier (= username / connection ID)
  , tankPos        :: !Vec2
    -- ^ Vị trí tâm xe tăng trên bản đồ
  , tankVel        :: !Vec2
    -- ^ Vận tốc hiện tại
  , tankBodyAngle  :: {-# UNPACK #-} !Float
    -- ^ Góc xoay thân xe (radian)
  , tankTurretAngle :: {-# UNPACK #-} !Float
    -- ^ Góc xoay nòng pháo (radian, theo chuột)
  , tankColor      :: !TankColor
  , tankWeapon     :: !WeaponState
  , tankAlive      :: !Bool
  , tankScore      :: {-# UNPACK #-} !Int
    -- ^ Số round thắng (first to N wins)
  , tankKills      :: {-# UNPACK #-} !Int
    -- ^ Tổng kills trong match hiện tại
  , tankDeaths     :: {-# UNPACK #-} !Int
    -- ^ Số lần bị hạ trong match hiện tại
  , tankAssists    :: {-# UNPACK #-} !Int
    -- ^ Số lần hỗ trợ hạ gục (hiện 0 vì đạn gây hạ gục tức thì)
  , tankPoints     :: {-# UNPACK #-} !Int
    -- ^ Điểm cá nhân trong trận, tách biệt với số round thắng (tankScore)
  , tankKillStreak :: {-# UNPACK #-} !Int
    -- ^ Số mạng hạ liên tiếp kể từ lần bị hạ gần nhất
  , tankMultiKillCount :: {-# UNPACK #-} !Int
    -- ^ Số hạ gục trong cửa sổ thời gian multi-kill
  , tankMultiKillTimer :: {-# UNPACK #-} !Float
    -- ^ Thời gian còn lại để nối tiếp multi-kill
  , tankRespawnTimer :: {-# UNPACK #-} !Float
    -- ^ Thời gian còn lại trước khi hồi sinh
  , tankInvulnerabilityLeft :: {-# UNPACK #-} !Float
    -- ^ Thời gian bất tử còn lại sau hồi sinh
  , tankAmmo       :: {-# UNPACK #-} !Int
    -- ^ Đạn còn trong băng
  , tankMaxAmmo    :: {-# UNPACK #-} !Int
    -- ^ Dung lượng băng đạn
  , tankReloadTimer :: {-# UNPACK #-} !Float
    -- ^ Thời gian nạp băng đạn còn lại
  , tankSurvivalCarry :: {-# UNPACK #-} !Float
    -- ^ Tích lũy thời gian sống lẻ để tính 3 điểm cho mỗi giây hoàn chỉnh
  , tankHull       :: Text
    -- ^ Mã thân xe người chơi đã chọn ("01".."NN"), client dùng để vẽ đúng ngoại hình
  , tankGun        :: Text
    -- ^ Mã nòng pháo người chơi đã chọn
  , tankTeam       :: Int
    -- ^ Đội (0 = xanh, 1 = đỏ, -1 = Tử chiến không có đội)
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Đạn đang bay (Bullet)
--------------------------------------------------------------------------------

data Bullet = Bullet
  { bulPos      :: !Vec2
  , bulVel      :: !Vec2
  , bulType     :: !BulletType
  , bulOwnerId  :: !Text
    -- ^ ID người bắn (để tính điểm)
  , bulBounces  :: {-# UNPACK #-} !Int
    -- ^ Số lần đã nảy tường
  , bulLifetime :: {-# UNPACK #-} !Float
    -- ^ Thời gian sống còn lại (giây)
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Tia Laser (render tức thì)
--------------------------------------------------------------------------------

data LaserSegment = LaserSegment
  { lsStart :: !Vec2
  , lsEnd   :: !Vec2
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Hộp bí ẩn (Mystery Box)
--------------------------------------------------------------------------------

data MysteryBox = MysteryBox
  { mbPos       :: !Vec2
  , mbActive    :: !Bool
  , mbRespawnIn :: {-# UNPACK #-} !Float
    -- ^ Thời gian trước khi hộp mới xuất hiện (giây)
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Tường & Mê cung
--------------------------------------------------------------------------------

-- | Một đoạn tường (segment) trong mê cung.
data Wall = Wall
  { wallStart :: !Vec2
  , wallEnd   :: !Vec2
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

-- | Mê cung hoàn chỉnh.
data Maze = Maze
  { mazeWalls      :: ![Wall]
  , mazeWidth      :: {-# UNPACK #-} !Float
  , mazeHeight     :: {-# UNPACK #-} !Float
  , mazeSpawnPts   :: ![Vec2]
    -- ^ Điểm spawn cho xe tăng
  , mazeBoxSpawnPts :: ![Vec2]
    -- ^ Vị trí có thể spawn hộp bí ẩn
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Pha trận đấu (Game Phase State Machine)
--------------------------------------------------------------------------------

data GamePhase
  = LobbyPhase
    -- ^ Chờ người chơi, chủ phòng nhấn Start
  | CountdownPhase {-# UNPACK #-} !Float
    -- ^ Đếm ngược trước khi bắt đầu (3.0 -> 0.0)
  | InGamePhase
    -- ^ Đang giao tranh
  | RoundEndPhase {-# UNPACK #-} !Float !Text
    -- ^ (Thời gian hiển thị còn lại, tên người thắng round)
  | MatchOverPhase !Text
    -- ^ (Tên người thắng chung cuộc)
  deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Thông tin phòng (hiển thị trong lobby list)
--------------------------------------------------------------------------------

data RoomInfo = RoomInfo
  { riRoomId        :: !Text
  , riRoomName      :: !Text
  , riGameMode      :: !Text
  , riMaxPlayers    :: {-# UNPACK #-} !Int
  , riCurrentPlayers :: {-# UNPACK #-} !Int
  , riHasPassword   :: !Bool
  , riPhase         :: !GamePhase
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- World Snapshot (broadcast mỗi tick tới tất cả client)
--------------------------------------------------------------------------------

-- | Trạng thái vùng chiếm của chế độ Cấm Địa (đội 0 = xanh, đội 1 = đỏ).
data ZoneState = ZoneState
  { zsCx       :: !Float
  , zsCy       :: !Float
  , zsRadius   :: !Float
  , zsOpen     :: !Bool
  , zsLockLeft :: !Float
  , zsElapsed  :: !Float
  , zsProgress :: ![Float]
  , zsInside   :: ![Int]
  , zsOwner    :: !Int
  , zsOvertime :: !Bool
  , zsHold     :: !Float
  , zsHoldTeam :: !Int
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

data WorldSnapshot = WorldSnapshot
  { wsTanks        :: ![Tank]
  , wsBullets      :: ![Bullet]
  , wsLasers       :: ![LaserSegment]
  , wsMysteryBoxes :: ![MysteryBox]
  , wsMaze         :: !Maze
  , wsPhase        :: !GamePhase
  , wsScores       :: ![(Text, Int)]
    -- ^ (playerId, điểm cá nhân)
  , wsMode         :: Text
    -- ^ "deathmatch" | "team" | "zone"
  , wsClock        :: Float
    -- ^ Giây đã trôi qua trong trận (Tử chiến) hoặc trong round (Đấu đội)
  , wsClockLimit   :: Float
    -- ^ Giới hạn của wsClock; 0 = không giới hạn
  , wsRound        :: Int
  , wsRounds       :: Int
  , wsTeamWins     :: [Int]
  , wsZone         :: Maybe ZoneState
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Player Input (Client -> Server mỗi tick)
--------------------------------------------------------------------------------

data PlayerInput = PlayerInput
  { piMoveUp    :: !Bool   -- ^ W
  , piMoveDown  :: !Bool   -- ^ S
  , piMoveLeft  :: !Bool   -- ^ A
  , piMoveRight :: !Bool   -- ^ D
  , piMouseAngle :: {-# UNPACK #-} !Float
    -- ^ Góc nòng pháo (radian) từ vị trí chuột
  , piFire      :: !Bool   -- ^ Chuột trái / Space
  , piReload    :: !Bool   -- ^ Nhấn R để nạp lại băng đạn
  } deriving (Show, Eq, Generic, ToJSON)

-- | PlayerInput parser cho phép client cũ chưa có piReload tiếp tục điều khiển.
instance FromJSON PlayerInput where
  parseJSON = withObject "PlayerInput" $ \v -> PlayerInput
    <$> v .: "piMoveUp"
    <*> v .: "piMoveDown"
    <*> v .: "piMoveLeft"
    <*> v .: "piMoveRight"
    <*> v .: "piMouseAngle"
    <*> v .: "piFire"
    <*> (v .:? "piReload" .!= False)

-- | Input trống (không nhấn gì).
emptyInput :: PlayerInput
emptyInput = PlayerInput False False False False 0.0 False False

--------------------------------------------------------------------------------
-- Dữ liệu MongoDB: Hồ sơ người chơi
--------------------------------------------------------------------------------

data PlayerStats = PlayerStats
  { psTotalMatches   :: {-# UNPACK #-} !Int
  , psWins           :: {-# UNPACK #-} !Int
  , psKills          :: {-# UNPACK #-} !Int
  , psDeaths         :: {-# UNPACK #-} !Int
  , psBoxesCollected :: {-# UNPACK #-} !Int
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

data PlayerProfile = PlayerProfile
  { ppUsername    :: !Text
  , ppDisplayName :: !Text
  , ppCreatedAt  :: !Text      -- ISO 8601
  , ppStats      :: !PlayerStats
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Dữ liệu MongoDB: Kết quả trận đấu
--------------------------------------------------------------------------------

data MatchPlayerRecord = MatchPlayerRecord
  { mprUsername :: !Text
  , mprScore   :: {-# UNPACK #-} !Int
  , mprKills   :: {-# UNPACK #-} !Int
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)

data MatchRecord = MatchRecord
  { mrRoomId      :: !Text
  , mrStartTime   :: !Text     -- ISO 8601
  , mrEndTime     :: !Text     -- ISO 8601
  , mrWinner      :: !Text
  , mrPlayers     :: ![MatchPlayerRecord]
  , mrRoundsPlayed :: {-# UNPACK #-} !Int
  } deriving (Show, Eq, Generic, ToJSON, FromJSON)
