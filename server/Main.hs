-- | Main (tankwar-server)
-- Điểm khởi chạy Dedicated Server cho TankWar.
-- Thiết lập WebSocket server, kết nối MongoDB, và xử lý kết nối client.
module Main where

import Control.Concurrent.STM
import Control.Exception        (SomeException, catch, finally)
import Control.Monad            (void)
import Data.Aeson               (decode, encode)
import qualified Data.Map.Strict as Map
import Data.Text                (Text)
import qualified Data.ByteString.Lazy as BL
import System.Environment       (getArgs)
import System.Exit              (exitFailure)
import System.IO                (hPutStrLn, hSetBuffering, hSetEncoding, stdout, stderr, utf8, BufferMode(..))

import qualified Network.WebSockets as WS

import Common.Types
import Common.Config
import Common.CommandParser
import Common.Protocol
import Server.State
import Server.RoomManager
import Server.GameEngine
import Server.Database.Connection
import Server.Database.PlayerRepo (findPlayer, createPlayer)
import Server.Database.MatchRepo  ()
import Server.Persistence

--------------------------------------------------------------------------------
-- Entry Point
--------------------------------------------------------------------------------

main :: IO ()
main = do
  -- Flush stdout/stderr line-by-line và đảm bảo encoding UTF-8 cho Unicode logs
  hSetBuffering stdout LineBuffering
  hSetBuffering stderr LineBuffering
  hSetEncoding stdout utf8
  hSetEncoding stderr utf8

  -- Parse tham số dòng lệnh
  args <- getArgs
  options <- case parseServerOptions args of
    Left message -> do
      hPutStrLn stderr $ "Lỗi tham số khởi động:\n" ++ message
      exitFailure
    Right value -> pure value
  let port = maybe defaultPort id (soPort options)
      mongoCfg = maybe defaultMongoConfig toMongoConfig (soMongo options)

  -- Banner
  putStrLn "╔══════════════════════════════════════════════════════════════╗"
  putStrLn "║          🎮  TankWar Dedicated Server v0.1.0  🎮           ║"
  putStrLn "║  Haskell • WebSocket • STM • MongoDB                       ║"
  putStrLn "╚══════════════════════════════════════════════════════════════╝"
  putStrLn ""

  -- Kết nối MongoDB
  putStrLn $ "[Server] Đang kết nối MongoDB tại "
          ++ mcHost mongoCfg ++ ":" ++ show (mcPort mongoCfg) ++ "..."
  db <- connectMongo mongoCfg

  -- Khởi tạo trạng thái server
  ss <- newServerState
  store <- newMatchStore defaultMatchHistoryPath
  savedMatches <- loadMatchHistory store
  putStrLn $ "[FileStore] Đã nạp " ++ show (length savedMatches) ++ " trận từ " ++ defaultMatchHistoryPath

  -- Khởi chạy WebSocket server
  putStrLn $ "[Server] WebSocket server lắng nghe cổng " ++ show port
  putStrLn $ "[Server] Tick rate: " ++ show tickRate ++ " Hz"
  putStrLn $ "[Server] Cooldown: thường " ++ show normalBulletCooldown ++ "s, box "
          ++ show specialBulletCooldown ++ "s | Buff: "
          ++ show buffDuration ++ "s"
  putStrLn "[Server] Sẵn sàng nhận kết nối!"
  putStrLn ""

  WS.runServer "0.0.0.0" port (serverApp ss db store)
    `finally` closeMongo db

--------------------------------------------------------------------------------
-- WebSocket Application
--------------------------------------------------------------------------------

-- | Xử lý mỗi kết nối WebSocket mới.
serverApp :: ServerState -> MongoPool -> MatchStore -> WS.ServerApp
serverApp ss db store pending = do
  conn <- WS.acceptRequest pending
  -- Bật ping/pong thread để giữ kết nối sống
  WS.withPingThread conn wsPingInterval (return ()) $ do
    -- Đợi tin nhắn đăng nhập đầu tiên
    msg <- WS.receiveData conn :: IO BL.ByteString
    case decode msg :: Maybe ClientMessage of
      Just (CLogin username displayName) ->
        handleLogin ss db store conn username displayName
      _ -> do
        WS.sendTextData conn $ encode (SLoginError "Tin nhắn đầu tiên phải là CLogin!")
        return ()

--------------------------------------------------------------------------------
-- Xử lý đăng nhập
--------------------------------------------------------------------------------

handleLogin :: ServerState -> MongoPool -> MatchStore -> WS.Connection -> Text -> Text -> IO ()
handleLogin ss db store conn username displayName = do
  registered <- atomically $ registerClient ss username conn
  if not registered
    then WS.sendTextData conn $ encode
           (SLoginError $ "Username '" <> username <> "' đã đang online!")
    else do
      -- Tạo hồ sơ trong MongoDB nếu chưa có
      maybePlayer <- findPlayer db username
      case maybePlayer of
        Nothing -> void $ createPlayer db username displayName
        Just _  -> return ()

      -- Gửi thông báo đăng nhập thành công
      let profile = PlayerProfile
            { ppUsername    = username
            , ppDisplayName = displayName
            , ppCreatedAt  = ""
            , ppStats      = PlayerStats 0 0 0 0 0
            }
      WS.sendTextData conn $ encode (SLoginSuccess username profile)
      putStrLn $ "[Auth] " ++ show username ++ " đã đăng nhập."

      -- Bắt đầu vòng lặp nhận message từ client
      clientLoop ss db store username
        `catch` (\e -> putStrLn $ "[WS] " ++ show username
                    ++ " ngắt kết nối: " ++ show (e :: SomeException))
        `finally` handleDisconnect ss username

--------------------------------------------------------------------------------
-- Vòng lặp nhận message từ Client
--------------------------------------------------------------------------------

clientLoop :: ServerState -> MongoPool -> MatchStore -> Text -> IO ()
clientLoop ss db store username = do
  maybeConn <- atomically $ do
    clients <- readTVar (ssClients ss)
    return $ Map.lookup username clients
  case maybeConn of
    Nothing -> pure ()  -- Đã bị xoá
    Just cc -> do
      raw <- WS.receiveData (ccConnection cc) :: IO BL.ByteString
      case decode raw :: Maybe ClientMessage of
        Nothing  -> pure ()  -- Bỏ qua tin nhắn sai format
        Just msg -> handleClientMessage ss db store username msg
      clientLoop ss db store username

--------------------------------------------------------------------------------
-- Xử lý tin nhắn từ Client (Message Router)
--------------------------------------------------------------------------------

handleClientMessage :: ServerState -> MongoPool -> MatchStore -> Text -> ClientMessage -> IO ()
handleClientMessage ss db store username = \case

  CCreateRoom roomName maxP password gameMode ->
    handleCreateRoom ss username roomName maxP password gameMode

  CJoinRoom roomId password ->
    handleJoinRoom ss username roomId password

  COpenDraft ->
    handleOpenDraft ss username

  CTankReady ->
    handleTankReady ss username

  CChooseTeam team ->
    handleChooseTeam ss username team

  CMapVote mapId ->
    handleMapVote ss username mapId

  CSetLoadout hull gun ->
    handleSetLoadout ss username hull gun

  CLeaveRoom ->
    handleLeaveRoom ss username

  CSelectMap mapId ->
    handleSelectMap ss username mapId

  CStartGame -> do
    started <- handleStartGame ss username
    -- Chỉ fork một loop khi transaction vừa chuyển Lobby -> Countdown thành công.
    if not started
      then pure ()
      else do
        maybeRoomId <- atomically $ getClientRoom ss username
        case maybeRoomId of
          Nothing  -> pure ()
          Just roomId -> startRoomGameLoop ss db store roomId

  CPlayerInput input -> do
    -- Cập nhật input vào state của phòng
    maybeRoomId <- atomically $ getClientRoom ss username
    case maybeRoomId of
      Nothing  -> return ()
      Just rid -> atomically $ modifyRoom ss rid $ \r ->
        r { rsInputs = Map.insert username input (rsInputs r) }

  CListRooms ->
    handleListRooms ss username

  CRequestLeaderboard -> do
    history <- loadMatchHistory store
    sendToClient ss username (SLeaderboard (leaderboardFromHistory history))

  CPing ->
    sendToClient ss username SPong

  -- Bỏ qua các tin nhắn không xử lý ở đây
  _ -> return ()

--------------------------------------------------------------------------------
-- Xử lý ngắt kết nối
--------------------------------------------------------------------------------

handleDisconnect :: ServerState -> Text -> IO ()
handleDisconnect ss username = do
  putStrLn $ "[Auth] " ++ show username ++ " ngắt kết nối."

  -- Rời phòng nếu đang ở trong phòng
  maybeRoomId <- atomically $ getClientRoom ss username
  case maybeRoomId of
    Nothing  -> return ()
    Just _   -> handleLeaveRoom ss username

  -- Xoá client khỏi danh sách
  atomically $ removeClient ss username

--------------------------------------------------------------------------------
toMongoConfig :: MongoEndpoint -> MongoConfig
toMongoConfig endpoint = MongoConfig
  { mcHost = meHost endpoint
  , mcPort = mePort endpoint
  , mcDatabase = meDatabase endpoint
  }
