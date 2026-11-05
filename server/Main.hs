-- | Main (tankwar-server)
-- Điểm khởi chạy Dedicated Server cho TankWar.
-- Thiết lập WebSocket server, kết nối MongoDB, và xử lý kết nối client.
module Main where

import Control.Concurrent.STM
import Control.Concurrent        (forkIO, threadDelay)
import Control.Exception        (SomeException, catch, finally)
import Control.Monad            (void, forever, forM_, when, unless)
import Data.Aeson               (decode, encode, object, (.=))
import Data.Char                (isDigit)
import Data.List                (nub, sortOn)
import Data.Ord                 (Down(..))
import qualified Data.Text as T
import Data.Time.Clock.POSIX    (getPOSIXTime)
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

  void $ forkIO (matchmakingLoop ss db store)
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
      startClientSender ss username
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

  CChat rawText teamOnly -> do
    let txt = T.take 120 (T.strip (T.filter (\c -> c >= ' ') rawText))
    unless (T.null txt) $ do
      -- Lấy phòng + danh sách người nhận trong một transaction để dữ liệu nhất quán.
      recipients <- atomically $ do
        mRid <- getClientRoom ss username
        case mRid of
          Nothing  -> pure []
          Just rid -> do
            rooms <- readTVar (ssRooms ss)
            ccs   <- getRoomClients ss rid
            let names = map ccUsername ccs
            pure $ case Map.lookup rid rooms of
              Nothing   -> []
              Just room
                | not teamOnly -> names
                | otherwise ->
                    let teamOf n = fmap tankTeam (Map.lookup n (rsTanks room))
                        myTeam   = teamOf username
                    in case myTeam of
                         Just t | t >= 0 -> [ n | n <- names, teamOf n == Just t ]
                         _               -> [username]
      forM_ recipients $ \n -> sendToClient ss n (SChat username txt teamOnly)

  CStartMatchmaking mode size hull gun ->
    handleStartMatchmaking ss username mode size hull gun

  CCancelMatchmaking ->
    atomically $ modifyTVar' (ssQueue ss) (filter ((/= username) . qeUser))

  CRequestHistory -> do
    history <- loadMatchHistory store
    let mine = [ r | r <- history, any ((== username) . mprUsername) (mrPlayers r) ]
    sendToClient ss username (SMatchHistory (take 50 (sortOn (Down . mrEndTime) mine)))

  -- Bỏ qua các tin nhắn không xử lý ở đây
  _ -> return ()

--------------------------------------------------------------------------------
-- Xử lý ngắt kết nối
--------------------------------------------------------------------------------

handleDisconnect :: ServerState -> Text -> IO ()
handleDisconnect ss username = do
  putStrLn $ "[Auth] " ++ show username ++ " ngắt kết nối."
  atomically $ modifyTVar' (ssQueue ss) (filter ((/= username) . qeUser))

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

--------------------------------------------------------------------------------
-- Ghép trận ngẫu nhiên (Matchmaking)
--------------------------------------------------------------------------------

handleStartMatchmaking :: ServerState -> Text -> Text -> Int -> Text -> Text -> IO ()
handleStartMatchmaking ss username mode size hull gun = do
  currentRoom <- atomically $ getClientRoom ss username
  case currentRoom of
    Just _  -> sendToClient ss username (SRoomError "Bạn đang ở trong phòng khác!")
    Nothing -> do
      now <- realToFrac <$> getPOSIXTime
      let m  = if mode `elem` ["deathmatch", "team", "zone"] then mode else "deathmatch"
          sz = if m == "deathmatch" then 0 else max 1 (min 5 size)
          validPart p = T.length p == 2 && T.all isDigit p
          entry = QueueEntry
            { qeUser = username, qeMode = m, qeSize = sz, qeSince = now
            , qeHull = if validPart hull then hull else ""
            , qeGun  = if validPart gun then gun else "" }
      atomically $ modifyTVar' (ssQueue ss) (\q -> filter ((/= username) . qeUser) q ++ [entry])
      sendToClient ss username (SMatchmakingStatus (object
        [ "status" .= ("searching" :: Text), "queueCount" .= (1 :: Int) ]))

-- | Nhóm hàng chờ theo (chế độ, cỡ đội) và chọn các nhóm đã đủ điều kiện bắt đầu.
-- Tử chiến: đủ 9 người bắt đầu ngay; từ 4 người thì chờ thêm vài giây rồi bắt đầu.
-- Đấu đội / Cấm Địa: bắt buộc đủ 2 x cỡ đội.
pickMatches :: Double -> [QueueEntry] -> ([(Text, Int, [QueueEntry])], [QueueEntry])
pickMatches now queue = foldl step ([], queue) keys
  where
    keyOf e = (qeMode e, qeSize e)
    keys = nub (map keyOf queue)
    step (acc, q) k@(mode, size) =
      let grp = [ e | e <- q, keyOf e == k ]
          need = 2 * size
          chosen
            | mode == "deathmatch" =
                if length grp >= deathmatchQueueMax then take deathmatchQueueMax grp
                else if length grp >= deathmatchQueueMin
                        && now - qeSince (grp !! (deathmatchQueueMin - 1)) >= deathmatchQueueGraceSeconds
                  then grp
                  else []
            | length grp >= need = take need grp
            | otherwise = []
      in if null chosen
           then (acc, q)
           else (acc ++ [(mode, size, chosen)], [ e | e <- q, qeUser e `notElem` map qeUser chosen ])

matchmakingLoop :: ServerState -> MongoPool -> MatchStore -> IO ()
matchmakingLoop ss db store = forever $ do
  threadDelay 1000000
  now <- realToFrac <$> getPOSIXTime
  (matches, waiting) <- atomically $ do
    q <- readTVar (ssQueue ss)
    let (ms, rest) = pickMatches now q
    writeTVar (ssQueue ss) rest
    pure (ms, rest)
  -- Báo tiến độ hàng chờ cho những người còn đợi
  forM_ waiting $ \e -> do
    let k = (qeMode e, qeSize e)
        count = length [ x | x <- waiting, (qeMode x, qeSize x) == k ]
        needed = if qeMode e == "deathmatch" then deathmatchQueueMin else 2 * qeSize e
    sendToClient ss (qeUser e) (SMatchmakingStatus (object
      [ "status" .= ("searching" :: Text), "queueCount" .= count, "needed" .= needed ]))
  forM_ matches $ \(mode, size, entries) ->
    startMatchedRoom ss db store mode size entries
      `catch` (\e -> putStrLn ("[Matchmaking] Lỗi tạo phòng: " ++ show (e :: SomeException)))

-- | Tạo phòng cho nhóm đã ghép, chia đội xen kẽ và vào trận ngay.
startMatchedRoom :: ServerState -> MongoPool -> MatchStore -> Text -> Int -> [QueueEntry] -> IO ()
startMatchedRoom ss db store mode size entries0 = do
  -- Bỏ những người đã mất kết nối hoặc đã vào phòng khác trong lúc chờ
  valid <- atomically $ do
    clients <- readTVar (ssClients ss)
    pure [ e | e <- entries0, Just cc <- [Map.lookup (qeUser e) clients], ccRoomId cc == Nothing ]
  let need = if mode == "deathmatch" then deathmatchQueueMin else 2 * size
  if length valid < need
    then atomically $ modifyTVar' (ssQueue ss) (valid ++)   -- chưa đủ người: trả về hàng chờ
    else do
      let users = map qeUser valid
          host  = head users
          n     = length users
      handleCreateRoom ss host ("Ghép trận " <> T.pack (show n) <> " người") n Nothing mode
      mrid <- atomically $ getClientRoom ss host
      case mrid of
        Nothing  -> pure ()
        Just rid -> do
          forM_ (drop 1 users) $ \u -> handleJoinRoom ss u rid Nothing
          atomically $ modifyRoom ss rid $ \r -> r
            { rsTeams = if mode == "deathmatch" then rsTeams r
                        else Map.fromList [ (u, if even i then "blue" else "red") | (i, u) <- zip [0 :: Int ..] users ]
            , rsTanks = foldl (\tm e -> if T.null (qeHull e) || T.null (qeGun e) then tm
                                         else Map.adjust (\t -> t { tankHull = qeHull e, tankGun = qeGun e }) (qeUser e) tm)
                              (rsTanks r) valid
            }
          forM_ users $ \u -> sendToClient ss u (SMatchFound (object
            [ "opponent" .= (if mode == "deathmatch" then T.pack (show (n - 1)) <> " đối thủ" else "Đội địch" :: Text)
            , "map"      .= ("random" :: Text)
            , "mode"     .= mode
            , "players"  .= users ]))
          started <- handleStartGame ss host
          when started $ startRoomGameLoop ss db store rid
