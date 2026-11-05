-- | Common.Protocol
-- Định nghĩa tất cả gói tin trao đổi giữa Client và Server qua WebSocket.
-- Serialization: JSON (aeson).
module Common.Protocol
  ( -- * Client -> Server
    ClientMessage(..)
    -- * Server -> Client
  , ServerMessage(..)
  ) where

import Data.Text    (Text)
import Data.Aeson   (ToJSON, FromJSON, Value)
import GHC.Generics (Generic)

import Common.Types

--------------------------------------------------------------------------------
-- Client -> Server
--------------------------------------------------------------------------------

-- | Gói tin từ Client gửi lên Server.
data ClientMessage
  = CLogin
      { clUsername :: !Text
      , clDisplayName :: !Text
      }
    -- ^ Đăng nhập / Đăng ký (tự động tạo nếu chưa có)

  | CCreateRoom
      { ccrRoomName   :: !Text
      , ccrMaxPlayers :: !Int
      , ccrPassword   :: !(Maybe Text)
      , ccrGameMode   :: !Text
        -- ^ Nothing = phòng public, Just pw = phòng riêng tư
      }
    -- ^ Tạo phòng mới

  | CJoinRoom
      { cjrRoomId   :: !Text
        -- ^ Mã phòng 6 ký tự
      , cjrPassword :: !(Maybe Text)
      }

  | COpenDraft
  | CTankReady
  | CSetLoadout { clsHull :: !Text, clsGun :: !Text }
    -- ^ Thân xe và nòng pháo đã chọn (mã 2 chữ số)
  | CChooseTeam { cctTeam :: !Text }
  | CMapVote { cmvMapId :: !Text }
    -- ^ Tham gia phòng theo Room ID

  | CLeaveRoom
    -- ^ Rời phòng hiện tại

  | CStartGame
    -- ^ Chủ phòng nhấn bắt đầu trận đấu

  | CSelectMap !Text
    -- ^ Chủ phòng chọn preset mê cung trước khi bắt đầu trận

  | CPlayerInput !PlayerInput
    -- ^ Gửi input điều khiển mỗi tick (WASD + Mouse + Fire)

  | CListRooms
    -- ^ Yêu cầu danh sách phòng đang mở

  | CRequestLeaderboard
    -- ^ Yêu cầu bảng xếp hạng

  | CPing

  | CChat
      { cchText :: !Text
      , cchTeam :: !Bool
      }
    -- ^ Chat trong trận: cchTeam = True chỉ gửi cho đồng đội (phím U), False gửi cho cả phòng (phím Y)

  | CStartMatchmaking
      { csmMode     :: !Text
      , csmTeamSize :: !Int
      , csmHull     :: !Text
      , csmGun      :: !Text
      }
    -- ^ Vào hàng chờ ghép trận ngẫu nhiên ("deathmatch" | "team" | "zone")

  | CCancelMatchmaking
    -- ^ Rời hàng chờ ghép trận

  | CRequestHistory
    -- ^ Xin lịch sử đấu của chính mình
    -- ^ Heartbeat
  deriving (Show, Eq, Generic, ToJSON, FromJSON)

--------------------------------------------------------------------------------
-- Server -> Client
--------------------------------------------------------------------------------

-- | Gói tin từ Server gửi về Client.
data ServerMessage
  = SLoginSuccess
      { slsUsername :: !Text
      , slsProfile :: !PlayerProfile
      }
    -- ^ Đăng nhập thành công, kèm hồ sơ

  | SLoginError !Text
    -- ^ Lỗi đăng nhập (ví dụ: username đã online)

  | SRoomCreated !RoomInfo
    -- ^ Phòng được tạo thành công, trả về thông tin phòng

  | SRoomJoined !RoomInfo
    -- ^ Tham gia phòng thành công

  | SRoomLeft
    -- ^ Đã rời phòng

  | SRoomList ![RoomInfo]
    -- ^ Danh sách phòng hiện có

  | SRoomError !Text

  | SRoomDraft !Value
  | SDraftOpened
  | SSelectedMap !Text
    -- ^ Lỗi tạo/vào phòng (sai pass, phòng đầy, không tồn tại...)

  | SRoomRoster ![(Text, TankColor)]
    -- ^ Danh sách toàn bộ người chơi trong phòng [(username, color)]

  | SPlayerJoined !Text !TankColor
    -- ^ Một người chơi khác vào phòng (username, màu)

  | SPlayerLeft !Text
    -- ^ Một người chơi khác rời phòng

  | SCountdown !Float
    -- ^ Đếm ngược (3.0 -> 0.0)

  | SGameSnapshot !WorldSnapshot
    -- ^ Snapshot trạng thái thế giới mỗi tick (60 Hz)

  | SRoundEnd !Text ![(Text, Int)]
    -- ^ (Người thắng round, bảng điểm [(username, score)])

  | SMatchOver !Text ![(Text, Int)]
    -- ^ (Người thắng chung cuộc, bảng điểm cuối cùng)

  | SChat !Text !Text !Bool
    -- ^ (Người gửi, nội dung, có phải chat đội không)

  | SKillEvent !Text !Text
    -- ^ (Người giết, Người bị giết) — để hiển thị kill feed

  | SMysteryBoxPickup !Text !Text
    -- ^ (Người nhặt, Loại đạn nhận được)

  | SLeaderboard ![(Text, Int, Int)]
    -- ^ [(username, wins, kills)] — Top players

  | SError !Text
    -- ^ Lỗi chung

  | SPong

  | SMatchFound !Value
    -- ^ Đã ghép đủ người: {opponent, map, mode, players}

  | SMatchmakingStatus !Value
    -- ^ Tiến độ hàng chờ: {status, queueCount, needed}

  | SMatchHistory ![MatchRecord]
    -- ^ Lịch sử các trận gần nhất của người chơi
    -- ^ Heartbeat response
  deriving (Show, Eq, Generic, ToJSON, FromJSON)
