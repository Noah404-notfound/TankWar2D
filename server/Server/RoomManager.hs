-- | Server.RoomManager
-- Quản lý vòng đời phòng đấu: tạo, tham gia, rời, tìm kiếm, bắt đầu trận.
-- Xử lý Room ID, mật khẩu, và khởi tạo trạng thái trận đấu.
module Server.RoomManager
  ( handleCreateRoom
  , handleJoinRoom
  , handleLeaveRoom
  , handleSelectMap
  , handleStartGame
  , handleOpenDraft
  , handleTankReady
  , handleChooseTeam
  , handleMapVote
  , handleSetLoadout
  , handleListRooms
  , generateRoomId
  , generateMaze
  , generateTrainingMaze
  , assignTankColor
  , shuffleList
  ) where

import Control.Concurrent.STM
import Data.Map.Strict         (Map)
import qualified Data.Map.Strict as Map
import Data.Text               (Text, pack, unpack)
import Data.Time.Clock         (getCurrentTime)
import Data.Time.Format        (formatTime, defaultTimeLocale)
import System.Random           (randomRIO)
import Control.Monad           (when, unless)
import Data.Char               (isDigit)
import Data.Aeson              (FromJSON(..), Value, eitherDecodeFileStrict', object, withObject, (.:), (.=))

import Common.Types
import Common.Config
import Common.Protocol
import Server.State
import Common.GameRules       (assignTeams, teamSpawnPositions, initialZone, resetTankForRound)

--------------------------------------------------------------------------------
-- Tạo phòng mới
--------------------------------------------------------------------------------

-- | Xử lý yêu cầu tạo phòng mới.
handleCreateRoom :: ServerState -> Text -> Text -> Int -> Maybe Text -> Text -> IO ()
handleCreateRoom ss username roomName maxP password requestedMode = do
  -- Kiểm tra client đã trong phòng chưa
  currentRoom <- atomically $ getClientRoom ss username
  case currentRoom of
    Just _  -> sendToClient ss username (SRoomError "Bạn đang ở trong phòng khác!")
    Nothing -> do
      -- Sinh Room ID duy nhất
      rid <- generateUniqueRoomId ss
      now <- getCurrentTime
      let startTime = pack $ formatTime defaultTimeLocale "%Y-%m-%dT%H:%M:%SZ" now
          gameMode = if requestedMode `elem` ["deathmatch", "team", "zone"]
                       then requestedMode else "deathmatch"
          baseMax = max minPlayersToStart (min maxPlayersPerRoom maxP)
          clampedMax = if gameMode == "deathmatch" || even baseMax
                         then baseMax else min maxPlayersPerRoom (baseMax + 1)

      -- Tạo mê cung
      maze <- generateMaze

      -- Tạo xe tăng cho người tạo phòng (vị trí ngẫu nhiên trên map)
      let spawnPts = mazeSpawnPts maze
      pickIdx <- randomRIO (0, max 0 (length spawnPts - 1))
      let spawnPt = if null spawnPts then Vec2 100 100 else spawnPts !! pickIdx
          tank = mkTank username spawnPt TankRed

      -- Tạo phòng mới
      let room = RoomState
            { rsRoomId       = rid
            , rsRoomName     = roomName
            , rsGameMode     = gameMode
            , rsDraftStage   = "lobby"
            , rsTeams        = Map.empty
            , rsVotes        = Map.empty
            , rsPassword     = password
            , rsMaxPlayers   = clampedMax
            , rsHostPlayer   = username
            , rsPlayerIds    = [username]
            , rsPhase        = LobbyPhase
            , rsTanks        = Map.singleton username tank
            , rsBullets      = []
            , rsLasers       = []
            , rsMysteryBoxes = []
            , rsMaze         = maze
            , rsMapId        = "forest"
            , rsInputs       = Map.singleton username emptyInput
            , rsRoundNumber  = 0
            , rsStartTime    = startTime
            , rsBoxTimer     = 0
            , rsMatchClock   = 0
            , rsTeamWins     = [0, 0]
            , rsZone         = Nothing
            }

      atomically $ do
        addRoom ss room
        setClientRoom ss username rid

      let info = roomToInfo room
      sendToClient ss username (SRoomCreated info)
      sendToClient ss username (SRoomRoster [(username, TankRed)])
      broadcastDraft ss rid
      putStrLn $ "[Room] Phòng " ++ show rid ++ " được tạo bởi " ++ show username

--------------------------------------------------------------------------------
-- Tham gia phòng
--------------------------------------------------------------------------------

-- | Xử lý yêu cầu tham gia phòng.
handleJoinRoom :: ServerState -> Text -> Text -> Maybe Text -> IO ()
handleJoinRoom ss username roomId password = do
  -- Kiểm tra client đã trong phòng chưa
  currentRoom <- atomically $ getClientRoom ss username
  case currentRoom of
    Just _  -> sendToClient ss username (SRoomError "Bạn đang ở trong phòng khác!")
    Nothing -> do
      maybeRoom <- atomically $ getRoom ss roomId
      case maybeRoom of
        Nothing -> sendToClient ss username (SRoomError "Phòng không tồn tại!")
        Just room -> do
          -- Kiểm tra mật khẩu
          case rsPassword room of
            Just pw | password /= Just pw ->
              sendToClient ss username (SRoomError "Sai mật khẩu!")
            _ -> do
              -- Kiểm tra phòng đầy
              if length (rsPlayerIds room) >= rsMaxPlayers room
                then sendToClient ss username (SRoomError "Phòng đã đầy!")
                else do
                  -- Kiểm tra đang trong trận
                  case rsPhase room of
                    LobbyPhase -> doJoin ss username room
                    _          -> sendToClient ss username
                                   (SRoomError "Trận đấu đã bắt đầu, không thể vào!")

-- | Thực hiện join: thêm người chơi vào phòng.
doJoin :: ServerState -> Text -> RoomState -> IO ()
doJoin ss username room = do
  let rid       = rsRoomId room
      playerIdx = length (rsPlayerIds room)
      color     = assignTankColor playerIdx
      spawnPts  = mazeSpawnPts (rsMaze room)
      existingPositions = map tankPos (Map.elems (rsTanks room))
      freeSpawns = filter (\pt -> all (\ep -> vec2Dist pt ep > 60) existingPositions) spawnPts
      availSpawns = if null freeSpawns then spawnPts else freeSpawns
  pickIdx <- randomRIO (0, max 0 (length availSpawns - 1))
  let spawnPt   = if null availSpawns then Vec2 100 100 else availSpawns !! pickIdx
      tank      = mkTank username spawnPt color

  atomically $ do
    modifyRoom ss rid $ \r -> r
      { rsPlayerIds = rsPlayerIds r ++ [username]
      , rsTanks     = Map.insert username tank (rsTanks r)
      , rsInputs    = Map.insert username emptyInput (rsInputs r)
      }
    setClientRoom ss username rid

  updatedRoom <- atomically $ getRoom ss rid
  case updatedRoom of
    Nothing -> return ()
    Just r  -> do
      let info = roomToInfo r
      sendToClient ss username (SRoomJoined info)
      let roster = [(pid, maybe TankBlue tankColor (Map.lookup pid (rsTanks r))) | pid <- rsPlayerIds r]
      sendToClient ss username (SRoomRoster roster)
      -- Thông báo cho người chơi khác
      broadcastToRoom ss rid (SPlayerJoined username color)
      broadcastDraft ss rid
      putStrLn $ "[Room] " ++ show username ++ " vào phòng " ++ show rid

--------------------------------------------------------------------------------
-- Rời phòng
--------------------------------------------------------------------------------

-- | Xử lý yêu cầu rời phòng.
handleLeaveRoom :: ServerState -> Text -> IO ()
handleLeaveRoom ss username = do
  maybeRoomId <- atomically $ getClientRoom ss username
  case maybeRoomId of
    Nothing  -> sendToClient ss username (SRoomError "Bạn không ở trong phòng nào!")
    Just rid -> do
      atomically $ do
        modifyRoom ss rid $ \r -> r
          { rsPlayerIds = filter (/= username) (rsPlayerIds r)
          , rsTanks     = Map.delete username (rsTanks r)
          , rsInputs    = Map.delete username (rsInputs r)
          , rsTeams     = Map.delete username (rsTeams r)
          , rsVotes     = Map.delete username (rsVotes r)
          }
        clearClientRoom ss username

      -- Kiểm tra phòng trống -> xoá phòng
      maybeRoom <- atomically $ getRoom ss rid
      case maybeRoom of
        Nothing -> return ()
        Just r  ->
          if null (rsPlayerIds r)
            then do
              atomically $ removeRoom ss rid
              putStrLn $ "[Room] Phòng " ++ show rid ++ " đã bị xoá (trống)"
            else do
              -- Nếu host rời, chuyển host
              when (rsHostPlayer r == username) $ do
                let newHost = head (rsPlayerIds r)
                atomically $ modifyRoom ss rid $ \r' ->
                  r' { rsHostPlayer = newHost }
                putStrLn $ "[Room] Chuyển host phòng " ++ show rid
                        ++ " sang " ++ show newHost
              broadcastDraft ss rid

              broadcastToRoom ss rid (SPlayerLeft username)

      sendToClient ss username SRoomLeft
      putStrLn $ "[Room] " ++ show username ++ " rời phòng " ++ show rid

--------------------------------------------------------------------------------
-- Bắt đầu trận đấu
--------------------------------------------------------------------------------

handleOpenDraft :: ServerState -> Text -> IO ()
handleOpenDraft ss username = withLobbyRoom ss username $ \rid room ->
  if rsHostPlayer room /= username
    then sendToClient ss username (SRoomError "Chỉ chủ phòng mới có thể mở phần chuẩn bị trận.")
    else do
      atomically $ modifyRoom ss rid $ \r -> r
        { rsDraftStage = "tank", rsVotes = Map.empty, rsTeams = Map.empty }
      broadcastDraft ss rid
      broadcastToRoom ss rid SDraftOpened

handleTankReady :: ServerState -> Text -> IO ()
handleTankReady ss username = withLobbyRoom ss username $ \rid _ -> do
  atomically $ modifyRoom ss rid $ \r -> r { rsDraftStage = "map" }
  broadcastDraft ss rid

handleChooseTeam :: ServerState -> Text -> Text -> IO ()
handleChooseTeam ss username team = withLobbyRoom ss username $ \rid room ->
  if rsGameMode room == "deathmatch"
    then sendToClient ss username (SRoomError "Phòng Tử chiến không có chọn phe.")
    else if team /= "blue" && team /= "red"
      then sendToClient ss username (SRoomError "Phe không hợp lệ.")
      else do
        let currentTeam = Map.lookup username (rsTeams room)
            teamCount = length (filter (== team) (Map.elems (rsTeams room)))
            teamCap = max 1 (rsMaxPlayers room `div` 2)
        if currentTeam /= Just team && teamCount >= teamCap
          then sendToClient ss username (SRoomError "Phe này đã đủ người.")
          else do
            atomically $ modifyRoom ss rid $ \r -> r
              { rsTeams = Map.insert username team (rsTeams r) }
            broadcastDraft ss rid

handleMapVote :: ServerState -> Text -> Text -> IO ()
handleMapVote ss username mapId = withLobbyRoom ss username $ \rid room ->
  if mapId `notElem` ["forest", "ruins", "depot", "random"]
    then sendToClient ss username (SRoomError "Bản đồ không hợp lệ.")
    else do
      atomically $ modifyRoom ss rid $ \r -> r
        { rsVotes = Map.insert username mapId (rsVotes r), rsDraftStage = "map" }
      broadcastDraft ss rid

-- | Lưu thân xe và nòng pháo người chơi đã chọn để mọi client vẽ đúng ngoại hình.
handleSetLoadout :: ServerState -> Text -> Text -> Text -> IO ()
handleSetLoadout ss username hull gun = withLobbyRoom ss username $ \rid _ ->
  if validPart hull && validPart gun
    then atomically $ modifyRoom ss rid $ \r -> r
      { rsTanks = Map.adjust (\t -> t { tankHull = hull, tankGun = gun }) username (rsTanks r) }
    else sendToClient ss username (SRoomError "Ngoại hình xe không hợp lệ.")
  where
    validPart p = let str = unpack p in length str == 2 && all isDigit str

-- | Một phòng đấu đội mà chỉ có một phe (sau khi tự cân bằng) thì không bắt đầu được.
teamsUnbalanced :: [Text] -> Map Text Text -> Bool
teamsUnbalanced pids chosen =
  let assigned = Map.elems (assignTeams pids chosen)
  in all (== 0) assigned || all (== 1) assigned

withLobbyRoom :: ServerState -> Text -> (Text -> RoomState -> IO ()) -> IO ()
withLobbyRoom ss username action = do
  maybeRid <- atomically $ getClientRoom ss username
  case maybeRid of
    Nothing -> sendToClient ss username (SRoomError "Bạn không ở trong phòng!")
    Just rid -> do
      maybeRoom <- atomically $ getRoom ss rid
      case maybeRoom of
        Just room | rsPhase room == LobbyPhase -> action rid room
        _ -> sendToClient ss username (SRoomError "Phòng không ở trạng thái chờ.")

broadcastDraft :: ServerState -> Text -> IO ()
broadcastDraft ss rid = do
  maybeRoom <- atomically $ getRoom ss rid
  case maybeRoom of
    Nothing -> return ()
    Just room -> broadcastToRoom ss rid (SRoomDraft $ roomDraftValue room)

roomDraftValue :: RoomState -> Value
roomDraftValue room = object
  [ "stage" .= rsDraftStage room
  , "mode" .= if rsGameMode room == "deathmatch" then ("freeforall" :: Text) else "teams"
  , "votes" .= rsVotes room
  , "teams" .= rsTeams room
  , "maxPlayers" .= rsMaxPlayers room
  , "players" .= rsPlayerIds room
  ]

-- | Chủ phòng nhấn Start. A True result means this call made the one valid
-- lobby-to-countdown transition, so Main may safely start exactly one loop.
handleStartGame :: ServerState -> Text -> IO Bool
handleStartGame ss username = do
  maybeRoomId <- atomically $ getClientRoom ss username
  case maybeRoomId of
    Nothing -> sendToClient ss username (SRoomError "Bạn không ở trong phòng!") >> pure False
    Just rid -> do
      maybeRoom <- atomically $ getRoom ss rid
      case maybeRoom of
        Nothing -> pure False
        Just room
          | rsHostPlayer room /= username ->
              sendToClient ss username (SRoomError "Chỉ chủ phòng mới được bắt đầu!") >> pure False
          | rsPhase room /= LobbyPhase ->
              sendToClient ss username (SRoomError "Trận đang diễn ra!") >> pure False
          | length (rsPlayerIds room) < minPlayersToStart ->
              sendToClient ss username
                (SRoomError $ "Cần ít nhất " <> pack (show minPlayersToStart) <> " người chơi!")
                >> pure False
          | rsGameMode room /= "deathmatch"
          , teamsUnbalanced (rsPlayerIds room) (rsTeams room) ->
              sendToClient ss username (SRoomError "Mỗi đội cần ít nhất 1 người chơi!") >> pure False
          | otherwise -> do
              let pids = rsPlayerIds room
                  mapPool = ["forest", "ruins", "depot"] :: [Text]
                  votes = Map.elems (rsVotes room)
              -- Mỗi người một phiếu: chọn NGẪU NHIÊN một phiếu trong số các phiếu
              -- đã bỏ (map được nhiều phiếu có xác suất cao hơn). Không có phiếu
              -- hoặc phiếu "random" thì chọn ngẫu nhiên trong toàn bộ danh sách map.
              pickedVote <- if null votes
                then pure "random"
                else do
                  voteIdx <- randomRIO (0, length votes - 1)
                  pure (votes !! voteIdx)
              selectedMap <- if pickedVote == "random"
                then do
                  idx <- randomRIO (0, length mapPool - 1)
                  pure (mapPool !! idx)
                else pure pickedVote
              newMaze <- generateTrainingMaze selectedMap
              shuffledSpawns <- shuffleList (mazeSpawnPts newMaze)
              let mode    = rsGameMode room
                  teamed  = mode /= "deathmatch"
                  teamMap = assignTeams pids (rsTeams room)
                  basePos = teamSpawnPositions newMaze teamMap pids
                  posFor :: Int -> Text -> Vec2
                  posFor idx pid
                    | teamed, Just p <- Map.lookup pid basePos = p
                    | idx < length shuffledSpawns = shuffledSpawns !! idx
                    | otherwise = Vec2 100 100
                  freshTank idx pid =
                    let base = resetTankForRound (posFor idx pid) (rsTanks room Map.! pid)
                        team = if teamed then Map.findWithDefault 0 pid teamMap else -1
                    in base
                         { -- Reset chỉ số khi bắt đầu trận mới (chơi lại cùng phòng)
                           tankScore = 0
                         , tankKills = 0
                         , tankDeaths = 0
                         , tankPoints = 0
                         , tankKillStreak = 0
                         , tankTeam = team
                         , tankColor = if not teamed then tankColor base
                                       else if team == 0 then TankBlue else TankRed
                         }
                  tanks' = Map.fromList [ (pid, freshTank idx pid) | (idx, pid) <- zip [0 ..] pids ]
              atomically $ modifyRoom ss rid $ \r -> r
                { rsMaze = newMaze
                , rsMapId = selectedMap
                , rsTanks = tanks'
                , rsPhase = CountdownPhase countdownDuration
                , rsRoundNumber = 1
                , rsMatchClock = 0
                , rsTeamWins = [0, 0]
                , rsZone = if mode == "zone" then Just (initialZone newMaze) else Nothing
                }
              broadcastToRoom ss rid (SCountdown countdownDuration)
              broadcastToRoom ss rid (SSelectedMap selectedMap)
              putStrLn $ "[Game] Phòng " ++ show rid ++ " bắt đầu countdown với mê cung mới!"
              pure True

-- | Only the room host can choose the map before a match. The current room
-- flow already uses votes, so the host's explicit choice is stored as its
-- vote and broadcast to every client immediately.
handleSelectMap :: ServerState -> Text -> Text -> IO ()
handleSelectMap ss username requestedMap = do
  selected <- atomically $ do
    maybeRoomId <- getClientRoom ss username
    case maybeRoomId of
      Nothing -> pure Nothing
      Just roomId -> do
        maybeRoom <- getRoom ss roomId
        case maybeRoom of
          Just room
            | rsHostPlayer room == username
            , rsPhase room == LobbyPhase -> do
                let mapId = if requestedMap `elem` ["forest", "ruins", "depot", "random"]
                              then requestedMap else "forest"
                modifyRoom ss roomId $ \r -> r
                  { rsVotes = Map.insert username mapId (rsVotes r) }
                pure (Just (roomId, mapId))
          _ -> pure Nothing
  case selected of
    Just (roomId, mapId) -> broadcastToRoom ss roomId (SSelectedMap mapId)
    Nothing -> sendToClient ss username
      (SRoomError "Chỉ chủ phòng có thể chọn bản đồ khi phòng đang chờ.")

--------------------------------------------------------------------------------
-- Liệt kê phòng
--------------------------------------------------------------------------------

-- | Gửi danh sách phòng cho client.
handleListRooms :: ServerState -> Text -> IO ()
handleListRooms ss username = do
  rooms <- atomically $ getAllRooms ss
  let infos = map roomToInfo rooms
  sendToClient ss username (SRoomList infos)

--------------------------------------------------------------------------------
-- Sinh Room ID duy nhất
--------------------------------------------------------------------------------

-- | Sinh Room ID 6 ký tự ngẫu nhiên, đảm bảo duy nhất.
generateUniqueRoomId :: ServerState -> IO Text
generateUniqueRoomId ss = do
  rid <- generateRoomId
  exists <- atomically $ do
    rooms <- readTVar (ssRooms ss)
    return $ Map.member rid rooms
  if exists
    then generateUniqueRoomId ss  -- thử lại
    else return rid

-- | Sinh Room ID 6 ký tự ngẫu nhiên.
generateRoomId :: IO Text
generateRoomId = do
  let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  cs <- mapM (\_ -> do
    idx <- randomRIO (0, length chars - 1)
    return $ chars !! idx
    ) [1..roomIdLength]
  return $ pack cs

--------------------------------------------------------------------------------
-- Gán màu xe tăng
--------------------------------------------------------------------------------

-- | Gán màu xe tăng theo thứ tự tham gia (index 0-3).
assignTankColor :: Int -> TankColor
assignTankColor idx = case idx `mod` 4 of
  0 -> TankRed
  1 -> TankBlue
  2 -> TankGreen
  _ -> TankYellow

--------------------------------------------------------------------------------
-- Chuyển đổi RoomState -> RoomInfo (thông tin hiển thị)
--------------------------------------------------------------------------------

roomToInfo :: RoomState -> RoomInfo
roomToInfo r = RoomInfo
  { riRoomId         = rsRoomId r
  , riRoomName       = rsRoomName r
  , riGameMode       = rsGameMode r
  , riMaxPlayers     = rsMaxPlayers r
  , riCurrentPlayers = length (rsPlayerIds r)
  , riHasPassword    = case rsPassword r of
                         Just _  -> True
                         Nothing -> False
  , riPhase          = rsPhase r
  }

--------------------------------------------------------------------------------
-- Tạo xe tăng mới
--------------------------------------------------------------------------------

mkTank :: Text -> Vec2 -> TankColor -> Tank
mkTank pid spawnPos color = Tank
  { tankId          = pid
  , tankPos         = spawnPos
  , tankVel         = vec2Zero
  , tankBodyAngle   = 0
  , tankTurretAngle = 0
  , tankColor       = color
  , tankWeapon      = defaultWeaponState
  , tankAlive       = True
  , tankScore       = 0
  , tankKills       = 0
  , tankDeaths      = 0
  , tankAssists     = 0
  , tankPoints      = 0
  , tankKillStreak  = 0
  , tankMultiKillCount  = 0
  , tankMultiKillTimer  = 0
  , tankRespawnTimer    = 0
  , tankInvulnerabilityLeft = 0
  , tankAmmo        = magazineSize
  , tankMaxAmmo     = magazineSize
  , tankReloadTimer = 0
  , tankSurvivalCarry = 0
  , tankHull        = "05"
  , tankGun         = "05"
  , tankTeam        = -1
  }

--------------------------------------------------------------------------------
-- Sinh mê cung (Maze Generation)
--------------------------------------------------------------------------------

-- | Xáo trộn ngẫu nhiên một danh sách
shuffleList :: [a] -> IO [a]
shuffleList [] = return []
shuffleList xs = do
  idx <- randomRIO (0, length xs - 1)
  let (before, x:after) = splitAt idx xs
  rest <- shuffleList (before ++ after)
  return (x : rest)

-- | Tạo mê cung ngẫu nhiên với tường dày đặc phong phú (Labyrinth)
-- và các điểm spawn ngẫu nhiên trên toàn bộ bản đồ.
data LayoutRect = LayoutRect !Float !Float !Float !Float

instance FromJSON LayoutRect where
  parseJSON = withObject "LayoutRect" $ \o ->
    LayoutRect <$> o .: "x" <*> o .: "y" <*> o .: "width" <*> o .: "height"

data TrainingLayout = TrainingLayout
  { tlWidth :: !Float
  , tlHeight :: !Float
  , tlCellSize :: !Float
  , tlGridOffset :: !Float
  , tlWallRects :: ![LayoutRect]
  , tlBlockedCells :: ![[Float]]
  , tlSpawnCentres :: ![[Float]]
  }

instance FromJSON TrainingLayout where
  parseJSON = withObject "TrainingLayout" $ \o -> TrainingLayout
    <$> o .: "width"
    <*> o .: "height"
    <*> o .: "cell_size"
    <*> o .: "grid_offset"
    <*> o .: "wall_rectangles"
    <*> o .: "blocked_cells"
    <*> o .: "spawn_centres"

-- | Load the same 4096x4096 collision layout used by quick match. This keeps
-- the online snapshot, the rendered terrain, walls, and spawn points aligned.
generateTrainingMaze :: Text -> IO Maze
generateTrainingMaze mapId = do
  let path = "web/assets/maps/" ++ unpack mapId ++ "_layout.json"
  result <- eitherDecodeFileStrict' path
  case result of
    Left err -> do
      putStrLn $ "[Map] Không đọc được " ++ path ++ ": " ++ err ++ "; dùng mê cung dự phòng."
      generateMaze
    Right layout -> do
      let w = tlWidth layout
          h = tlHeight layout
          rects = tlWallRects layout ++
            [ LayoutRect (tlGridOffset layout + col * tlCellSize layout)
                         (tlGridOffset layout + row * tlCellSize layout)
                         (tlCellSize layout) (tlCellSize layout)
            | cell <- tlBlockedCells layout
            , let col = atOrZero 0 cell
            , let row = atOrZero 1 cell
            ]
          borderWalls =
            [ Wall (Vec2 0 0) (Vec2 w 0)
            , Wall (Vec2 w 0) (Vec2 w h)
            , Wall (Vec2 w h) (Vec2 0 h)
            , Wall (Vec2 0 h) (Vec2 0 0)
            ]
          walls = borderWalls ++ concatMap rectangleWalls rects
          explicitSpawns = map pairToVec (tlSpawnCentres layout)
          cellCentres =
            [ Vec2 (tlGridOffset layout + (fromIntegral col + 0.5) * tlCellSize layout)
                   (tlGridOffset layout + (fromIntegral row + 0.5) * tlCellSize layout)
            | col <- [0 .. floor (w / tlCellSize layout) - 1]
            , row <- [0 .. floor (h / tlCellSize layout) - 1]
            ]
          openSpawns = filter (spawnIsClear walls) (explicitSpawns ++ cellCentres)
          spawns = uniqueSpawns openSpawns
      shuffledSpawns <- shuffleList spawns
      return Maze
        { mazeWalls = walls
        , mazeWidth = w
        , mazeHeight = h
        , mazeSpawnPts = shuffledSpawns
        , mazeBoxSpawnPts = take 12 shuffledSpawns
        }
  where
    atOrZero i xs = if i < length xs then xs !! i else 0
    pairToVec xs = Vec2 (atOrZero 0 xs) (atOrZero 1 xs)
    rectangleWalls (LayoutRect x y rw rh) =
      [ Wall (Vec2 x y) (Vec2 (x + rw) y)
      , Wall (Vec2 (x + rw) y) (Vec2 (x + rw) (y + rh))
      , Wall (Vec2 (x + rw) (y + rh)) (Vec2 x (y + rh))
      , Wall (Vec2 x (y + rh)) (Vec2 x y)
      ]
    spawnIsClear walls point = all (farEnough point) (drop 4 walls)
    farEnough (Vec2 px py) (Wall (Vec2 x1 y1) (Vec2 x2 y2)) =
      let dx = x2 - x1
          dy = y2 - y1
          len2 = dx * dx + dy * dy
          t = if len2 < 0.0001 then 0 else max 0 (min 1 (((px - x1) * dx + (py - y1) * dy) / len2))
          qx = x1 + t * dx
          qy = y1 + t * dy
      in sqrt ((px - qx) * (px - qx) + (py - qy) * (py - qy)) > 190
    uniqueSpawns = foldl addIfDistant []
    addIfDistant accepted point
      | any (near point) accepted = accepted
      | otherwise = accepted ++ [point]
    near (Vec2 x y) (Vec2 u v) = sqrt ((x - u) * (x - u) + (y - v) * (y - v)) < 300

-- | Legacy procedural layout used only if the selected quick-match map asset
-- cannot be read (for example when the server starts outside the project root).
generateMaze :: IO Maze
generateMaze = do
  let w  = defaultMazeWidth
      h  = defaultMazeHeight
      cs = cellSize

      -- Tường bao quanh (4 cạnh)
      borderWalls =
        [ Wall (Vec2 0 0) (Vec2 w 0)     -- Đáy
        , Wall (Vec2 w 0) (Vec2 w h)     -- Phải
        , Wall (Vec2 w h) (Vec2 0 h)     -- Đỉnh
        , Wall (Vec2 0 h) (Vec2 0 0)     -- Trái
        ]

      wH x1 x2 y = Wall (Vec2 (x1*cs) (y*cs)) (Vec2 (x2*cs) (y*cs))
      wV x y1 y2 = Wall (Vec2 (x*cs) (y1*cs)) (Vec2 (x*cs) (y2*cs))

      -- 4 Mẫu Mê Cung Rối Chiến Thuật: Tường cả dọc lẫn ngang, không song song, luôn có khe hở thoát hiểm
      -- Mẫu 1: The Tangled Labyrinth
      layout1 =
        [ wH 3 11 1, wH 13 20 1, wH 1 3 2, wH 11 17 2, wH 17 20 3
        , wH 7 12 4, wH 13 17 4, wH 3 6 5, wH 17 19 5, wH 5 12 6
        , wH 15 17 6, wH 1 6 7, wH 9 13 8, wH 1 11 10, wH 15 20 10
        , wV 1 3 9, wV 2 1 3, wV 3 3 9, wV 4 1 4, wV 6 1 5
        , wV 6 7 10, wV 7 5 9, wV 8 1 3, wV 8 7 10, wV 9 5 9
        , wV 10 1 4, wV 11 7 9, wV 12 1 7, wV 13 3 10, wV 14 5 10
        , wV 15 3 10, wV 17 5 9, wV 18 1 3, wV 18 7 10, wV 19 3 9
        , wV 20 5 9
        ]

      -- Mẫu 2: The Complex Grid Matrix
      layout2 =
        [ wH 1 9 1, wH 11 13 1, wH 15 20 1, wH 7 13 2, wH 5 8 3
        , wH 11 20 3, wH 7 12 4, wH 13 15 5, wH 5 10 6, wH 11 20 6
        , wH 1 3 8, wH 5 8 8, wH 9 18 8, wH 5 9 9, wH 17 20 9
        , wH 5 15 10, wV 1 1 5, wV 1 7 10, wV 2 3 5, wV 3 1 10
        , wV 4 3 10, wV 5 1 4, wV 6 5 8, wV 9 3 9, wV 10 1 3
        , wV 12 5 9, wV 14 1 5, wV 15 7 10, wV 16 5 7, wV 17 1 3
        , wV 19 3 10
        ]

      -- Mẫu 3: The Intertwined Stronghold
      layout3 =
        [ wH 7 9 1, wH 15 20 1, wH 1 5 2, wH 13 20 2, wH 5 11 3
        , wH 15 20 3, wH 9 14 4, wH 17 19 4, wH 9 11 5, wH 17 20 6
        , wH 9 12 7, wH 13 15 8, wH 17 19 8, wH 5 7 9, wH 17 20 9
        , wH 1 6 10, wH 7 20 10, wV 1 1 10, wV 2 3 9, wV 3 1 9
        , wV 4 3 10, wV 5 1 9, wV 6 5 7, wV 7 5 10, wV 8 1 9
        , wV 10 1 3, wV 10 5 9, wV 12 1 10, wV 13 1 3, wV 13 5 9
        , wV 14 3 5, wV 15 5 9, wV 16 3 10, wV 17 5 8, wV 20 3 9
        ]

      -- Mẫu 4: Crossfire Maze
      layout4 =
        [ wH 3 9 1, wH 13 15 1, wH 1 5 2, wH 11 13 2, wH 1 7 4
        , wH 17 20 4, wH 11 18 5, wH 1 3 6, wH 5 9 6, wH 9 13 7
        , wH 15 20 7, wH 1 3 8, wH 9 11 8, wH 13 16 8, wH 9 12 9
        , wH 13 18 9, wH 1 20 10, wV 1 1 5, wV 1 7 9, wV 3 3 10
        , wV 4 5 9, wV 5 5 10, wV 7 1 5, wV 7 7 10, wV 8 3 9
        , wV 9 1 5, wV 10 1 7, wV 11 1 5, wV 12 5 9, wV 13 1 4
        , wV 14 3 8, wV 15 1 3, wV 16 1 6, wV 17 1 4, wV 17 7 9
        , wV 18 1 3, wV 18 5 7, wV 19 1 3, wV 20 1 10
        ]

  layoutIdx <- randomRIO (1 :: Int, 4)
  let allInnerWalls = case layoutIdx of
        1 -> layout1
        2 -> layout2
        3 -> layout3
        _ -> layout4

  -- Các điểm spawn thoáng rộng tại chính giữa các hành lang (y = (r + 0.5) * cs)
  let allSpawns =
        [ Vec2 (1.5 * cs) (0.5 * cs)
        , Vec2 (19.5 * cs) (0.5 * cs)
        , Vec2 (1.5 * cs) (10.5 * cs)
        , Vec2 (19.5 * cs) (10.5 * cs)
        , Vec2 (10.5 * cs) (0.5 * cs)
        , Vec2 (10.5 * cs) (10.5 * cs)
        , Vec2 (4.5 * cs) (2.5 * cs)
        , Vec2 (16.5 * cs) (2.5 * cs)
        , Vec2 (4.5 * cs) (8.5 * cs)
        , Vec2 (16.5 * cs) (8.5 * cs)
        , Vec2 (10.5 * cs) (4.5 * cs)
        , Vec2 (10.5 * cs) (6.5 * cs)
        ]

  -- Vị trí spawn hộp bí ẩn ở các giao lộ
  let boxSpawns =
        [ Vec2 (10.5 * cs) (5.5 * cs)
        , Vec2 (6.5 * cs) (3.5 * cs)
        , Vec2 (14.5 * cs) (3.5 * cs)
        , Vec2 (6.5 * cs) (7.5 * cs)
        , Vec2 (14.5 * cs) (7.5 * cs)
        ]

  -- Xáo trộn điểm spawn để mỗi lần sinh là hoàn toàn ngẫu nhiên
  randomSpawns <- shuffleList allSpawns

  return Maze
    { mazeWalls       = borderWalls ++ allInnerWalls
    , mazeWidth       = w
    , mazeHeight      = h
    , mazeSpawnPts    = randomSpawns
    , mazeBoxSpawnPts = boxSpawns
    }
