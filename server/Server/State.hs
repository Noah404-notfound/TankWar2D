-- | Server.State
-- Quản lý trạng thái toàn cục của server bằng STM (Software Transactional Memory).
-- Bao gồm: danh sách phòng, kết nối client, trạng thái trận đấu.
module Server.State
  ( -- * Kiểu dữ liệu trạng thái
    ServerState(..)
  , RoomState(..)
  , ClientConn(..)

    -- * Khởi tạo
  , newServerState

    -- * Truy vấn (STM)
  , getRoom
  , getAllRooms
  , getRoomClients
  , getClientRoom

    -- * Thay đổi (STM)
  , addRoom
  , removeRoom
  , modifyRoom
  , addClient
  , registerClient
  , removeClient
  , setClientRoom
  , clearClientRoom

    -- * Broadcast
  , broadcastToRoom
  , sendToClient
  ) where

import Control.Concurrent.STM
import Data.Map.Strict        (Map)
import qualified Data.Map.Strict as Map
import Data.Text              (Text)
import Data.Aeson             (encode)
import Control.Monad          (forM_, when)
import Control.Exception      (SomeException, try)

import qualified Network.WebSockets as WS

import Common.Types
import Common.Protocol

--------------------------------------------------------------------------------
-- Kiểu dữ liệu
--------------------------------------------------------------------------------

-- | Kết nối WebSocket của một client.
data ClientConn = ClientConn
  { ccUsername   :: !Text
  , ccConnection :: !WS.Connection
  , ccRoomId     :: !(Maybe Text)
    -- ^ Phòng hiện tại mà client đang tham gia (Nothing = ở lobby)
  }

-- | Trạng thái đầy đủ của một phòng đấu.
data RoomState = RoomState
  { rsRoomId      :: !Text
  , rsRoomName    :: !Text
  , rsGameMode    :: !Text
  , rsDraftStage  :: !Text
  , rsTeams       :: !(Map Text Text)
  , rsVotes       :: !(Map Text Text)
  , rsPassword    :: !(Maybe Text)
    -- ^ Nothing = public, Just pw = private
  , rsMaxPlayers  :: !Int
  , rsHostPlayer  :: !Text
    -- ^ Username của chủ phòng (người tạo)
  , rsPlayerIds   :: ![Text]
    -- ^ Danh sách username của người chơi trong phòng
  , rsPhase       :: !GamePhase
    -- ^ Pha hiện tại (Lobby, Countdown, InGame, RoundEnd, MatchOver)
  , rsTanks       :: !(Map Text Tank)
    -- ^ Trạng thái xe tăng của từng người chơi
  , rsBullets     :: ![Bullet]
    -- ^ Danh sách đạn đang bay
  , rsLasers      :: ![LaserSegment]
    -- ^ Tia laser hiện tại (chỉ tồn tại 1 tick)
  , rsMysteryBoxes :: ![MysteryBox]
    -- ^ Danh sách hộp bí ẩn trên bản đồ
  , rsMaze        :: !Maze
    -- ^ Mê cung hiện tại
  , rsMapId       :: !Text
    -- ^ Map đấu nhanh đã được cả phòng bỏ phiếu, giữ nguyên qua các round
  , rsInputs      :: !(Map Text PlayerInput)
    -- ^ Input mới nhất từ mỗi client
  , rsRoundNumber :: !Int
    -- ^ Số round hiện tại
  , rsStartTime   :: !Text
    -- ^ Thời gian bắt đầu trận đấu (ISO 8601)
  , rsBoxTimer    :: !Float
    -- ^ Đếm ngược đến lần spawn hộp bí ẩn tiếp theo
  , rsMatchClock  :: !Float
    -- ^ Giây đã trôi qua trong trận (Tử chiến) hoặc trong round hiện tại (Đấu đội)
  , rsTeamWins    :: ![Int]
    -- ^ Số round thắng của đội 0 và đội 1 (Đấu đội)
  , rsZone        :: !(Maybe ZoneState)
    -- ^ Trạng thái vùng chiếm (chỉ có ở chế độ Cấm Địa)
  }

-- | Trạng thái toàn cục của server.
data ServerState = ServerState
  { ssRooms   :: !(TVar (Map Text RoomState))
    -- ^ Tất cả phòng đấu, key = roomId
  , ssClients :: !(TVar (Map Text ClientConn))
    -- ^ Tất cả client đang kết nối, key = username
  }

--------------------------------------------------------------------------------
-- Khởi tạo
--------------------------------------------------------------------------------

-- | Tạo trạng thái server trống.
newServerState :: IO ServerState
newServerState = do
  rooms   <- newTVarIO Map.empty
  clients <- newTVarIO Map.empty
  return ServerState
    { ssRooms   = rooms
    , ssClients = clients
    }

--------------------------------------------------------------------------------
-- Truy vấn (STM transactions)
--------------------------------------------------------------------------------

-- | Lấy một phòng theo Room ID.
getRoom :: ServerState -> Text -> STM (Maybe RoomState)
getRoom ss roomId = do
  rooms <- readTVar (ssRooms ss)
  return $ Map.lookup roomId rooms

-- | Lấy tất cả phòng.
getAllRooms :: ServerState -> STM [RoomState]
getAllRooms ss = do
  rooms <- readTVar (ssRooms ss)
  return $ Map.elems rooms

-- | Lấy danh sách ClientConn trong một phòng.
getRoomClients :: ServerState -> Text -> STM [ClientConn]
getRoomClients ss roomId = do
  clients <- readTVar (ssClients ss)
  return [ cc | cc <- Map.elems clients, ccRoomId cc == Just roomId ]

-- | Lấy Room ID mà client đang tham gia.
getClientRoom :: ServerState -> Text -> STM (Maybe Text)
getClientRoom ss username = do
  clients <- readTVar (ssClients ss)
  return $ case Map.lookup username clients of
    Just cc -> ccRoomId cc
    Nothing -> Nothing

--------------------------------------------------------------------------------
-- Thay đổi (STM transactions)
--------------------------------------------------------------------------------

-- | Thêm phòng mới.
addRoom :: ServerState -> RoomState -> STM ()
addRoom ss room =
  modifyTVar' (ssRooms ss) $ Map.insert (rsRoomId room) room

-- | Xoá phòng.
removeRoom :: ServerState -> Text -> STM ()
removeRoom ss roomId =
  modifyTVar' (ssRooms ss) $ Map.delete roomId

-- | Thay đổi trạng thái phòng.
modifyRoom :: ServerState -> Text -> (RoomState -> RoomState) -> STM ()
modifyRoom ss roomId f =
  modifyTVar' (ssRooms ss) $ Map.adjust f roomId

-- | Đăng ký client mới (khi WebSocket kết nối).
addClient :: ServerState -> Text -> WS.Connection -> STM ()
addClient ss username conn =
  modifyTVar' (ssClients ss) $ Map.insert username ClientConn
    { ccUsername   = username
    , ccConnection = conn
    , ccRoomId     = Nothing
    }

-- | Register a new client only if its username is not currently in use.
-- The lookup and insertion occur in one STM transaction, avoiding a race
-- between two simultaneous WebSocket logins.
registerClient :: ServerState -> Text -> WS.Connection -> STM Bool
registerClient ss username conn = do
  clients <- readTVar (ssClients ss)
  if Map.member username clients
    then pure False
    else do
      writeTVar (ssClients ss) $ Map.insert username ClientConn
        { ccUsername = username
        , ccConnection = conn
        , ccRoomId = Nothing
        } clients
      pure True

-- | Xoá client (khi WebSocket ngắt kết nối).
removeClient :: ServerState -> Text -> STM ()
removeClient ss username =
  modifyTVar' (ssClients ss) $ Map.delete username

-- | Gán phòng cho client.
setClientRoom :: ServerState -> Text -> Text -> STM ()
setClientRoom ss username roomId =
  modifyTVar' (ssClients ss) $
    Map.adjust (\cc -> cc { ccRoomId = Just roomId }) username

-- | Bỏ gán phòng cho client (về lobby).
clearClientRoom :: ServerState -> Text -> STM ()
clearClientRoom ss username =
  modifyTVar' (ssClients ss) $
    Map.adjust (\cc -> cc { ccRoomId = Nothing }) username

--------------------------------------------------------------------------------
-- Broadcast (IO, gửi tin nhắn qua WebSocket)
--------------------------------------------------------------------------------

-- | Gửi ServerMessage tới tất cả client trong một phòng.
broadcastToRoom :: ServerState -> Text -> ServerMessage -> IO ()
broadcastToRoom ss roomId msg = do
  clients <- atomically $ getRoomClients ss roomId
  let payload = encode msg
  forM_ clients $ \cc -> do
    result <- try @SomeException $ WS.sendTextData (ccConnection cc) payload
    case result of
      Left err -> putStrLn $ "[WS] Lỗi gửi tới " ++ show (ccUsername cc)
                           ++ ": " ++ show err
      Right _  -> return ()

-- | Gửi ServerMessage tới một client cụ thể.
sendToClient :: ServerState -> Text -> ServerMessage -> IO ()
sendToClient ss username msg = do
  maybeConn <- atomically $ do
    clients <- readTVar (ssClients ss)
    return $ Map.lookup username clients
  case maybeConn of
    Nothing -> return ()
    Just cc -> do
      result <- try @SomeException $
        WS.sendTextData (ccConnection cc) (encode msg)
      case result of
        Left err -> putStrLn $ "[WS] Lỗi gửi tới " ++ show username
                             ++ ": " ++ show err
        Right _  -> return ()
