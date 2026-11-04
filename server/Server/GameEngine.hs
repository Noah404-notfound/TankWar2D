-- | Server.GameEngine
-- Vòng lặp game chính (Authoritative Game Loop) chạy 60 Hz trên Server.
-- Xử lý: di chuyển xe tăng, đạn bay thẳng, cooldown (thường 0.5s, box 1.0s), mystery box 15s,
-- Gatling burst 3 viên, va chạm, xác định thắng thua.
module Server.GameEngine
  ( startRoomGameLoop
  , tickRoom
  ) where

import Control.Concurrent       (threadDelay, forkIO)
import Control.Concurrent.STM
import Control.Monad            (forM_, when, unless, void, forever, replicateM_, foldM)
import Data.Map.Strict          (Map)
import qualified Data.Map.Strict as Map
import Data.Text                (Text, pack)
import Data.Time.Clock          (getCurrentTime)
import Data.Time.Format         (formatTime, defaultTimeLocale)
import System.Random            (randomRIO)
import GHC.Clock                (getMonotonicTime)
import Data.List                (find)
import Data.Maybe               (mapMaybe, isJust, fromMaybe)

import Common.Types
import Common.Config
import Common.Protocol
import Server.State
import Server.RoomManager         (generateTrainingMaze, shuffleList)
import Server.Database.Connection (MongoPool)
import Server.Database.PlayerRepo (addKill, addDeath, addWin, updatePlayerStats)
import Server.Database.MatchRepo  (saveMatchResult)
import Server.Persistence         (MatchStore, appendMatchRecord)
import Common.GameRules           ( grantWeapon, retainActiveEntities, tickTankTimers, applyKill
                                      , respawnTank, resetTankForRound, teamBase, teamSpawnPositions
                                      , updateZone, rankingWinner, teamWinnerName, matchWinnerByWins, bumpWin )

--------------------------------------------------------------------------------
-- Khởi chạy Game Loop cho một phòng
--------------------------------------------------------------------------------

-- | Fork thread game loop cho phòng đã bắt đầu trận.
-- Thread chạy liên tục 60Hz cho đến khi trận kết thúc.
startRoomGameLoop :: ServerState -> MongoPool -> MatchStore -> Text -> IO ()
startRoomGameLoop ss db store roomId = void $ forkIO $ do
  putStrLn $ "[GameLoop] Bắt đầu game loop cho phòng " ++ show roomId
  startT <- getMonotonicTime
  gameLoopForever ss db store roomId startT 0
  putStrLn $ "[GameLoop] Kết thúc game loop phòng " ++ show roomId

-- | Vòng lặp chính với bước thời gian cố định (fixed timestep).
-- Mỗi vòng đo thời gian thực đã trôi qua, chạy đủ số tick vật lý (tickRate Hz)
-- rồi gửi một snapshot. Cách này giữ tốc độ game đúng và mượt ngay cả khi
-- 'threadDelay' kém chính xác (Windows thường làm tròn lên khoảng 15 ms).
gameLoopForever :: ServerState -> MongoPool -> MatchStore -> Text -> Double -> Double -> IO ()
gameLoopForever ss db store roomId lastT acc = do
  maybeRoom <- atomically $ getRoom ss roomId
  case maybeRoom of
    Nothing -> return ()  -- Phòng đã bị xoá
    Just room
      -- Chỉ còn <= 1 người: không thể tiếp tục trận, đưa phòng về Lobby.
      | length (rsPlayerIds room) < 2
      , not (isLobbyOrOver (rsPhase room)) -> do
          atomically $ modifyRoom ss roomId $ \r -> r { rsPhase = LobbyPhase }
          putStrLn $ "[GameLoop] Phòng " ++ show roomId ++ " không đủ người, dừng trận"
      | otherwise ->
          case rsPhase room of
            MatchOverPhase _ -> return ()  -- Trận kết thúc, dừng loop
            LobbyPhase       -> return ()
            _ -> do
              now <- getMonotonicTime
              let stepSec = realToFrac dt :: Double
                  total   = min 0.25 (acc + max 0 (now - lastT))
                  ticks   = floor (total / stepSec) :: Int
                  rest    = total - fromIntegral ticks * stepSec
              replicateM_ ticks (tickRoom ss db store roomId)
              when (ticks > 0) $ broadcastSnapshot ss roomId
              threadDelay 2000
              gameLoopForever ss db store roomId now rest
  where
    isLobbyOrOver LobbyPhase = True
    isLobbyOrOver (MatchOverPhase _) = True
    isLobbyOrOver _ = False

--------------------------------------------------------------------------------
-- Một Tick (≈ 16.67ms)
--------------------------------------------------------------------------------

-- | Xử lý một tick hoàn chỉnh cho phòng.
tickRoom :: ServerState -> MongoPool -> MatchStore -> Text -> IO ()
tickRoom ss db store roomId = do
  maybeRoom <- atomically $ getRoom ss roomId
  case maybeRoom of
    Nothing   -> return ()
    Just room -> case rsPhase room of

      -- 1) COUNTDOWN: Đếm ngược 3 giây
      CountdownPhase t -> do
        let t' = t - dt
        if t' <= 0
          then do
            -- Chuyển sang InGame, spawn mystery box timer
            boxDelay <- randomRIO (boxSpawnIntervalMin, boxSpawnIntervalMax)
            atomically $ modifyRoom ss roomId $ \r -> r
              { rsPhase    = InGamePhase
              , rsBoxTimer = boxDelay
              , rsMatchClock = 0
              }
            broadcastToRoom ss roomId (SCountdown 0)
          else do
            atomically $ modifyRoom ss roomId $ \r -> r
              { rsPhase = CountdownPhase t' }
            -- Gửi countdown cho client mỗi giây
            when (floor t' /= (floor (t' + dt) :: Int)) $
              broadcastToRoom ss roomId (SCountdown t')

      -- 2) IN GAME: Vòng lặp chính
      InGamePhase -> do
        tickInGame ss db store roomId room

      -- 3) ROUND END: Chờ trước khi bắt đầu round mới
      RoundEndPhase t winner -> do
        let t' = t - dt
        if t' <= 0
          then advanceAfterRound ss db store roomId
          else atomically $ modifyRoom ss roomId $ \r -> r
                 { rsPhase = RoundEndPhase t' winner }

      -- Các phase khác: không tick
      _ -> return ()

--------------------------------------------------------------------------------
-- Tick In-Game (Phase chính)
--------------------------------------------------------------------------------

-- | Một tick trong giao tranh. Luật phụ thuộc chế độ phòng:
--   * "deathmatch": hồi sinh sau 5 giây, trận kéo dài 'deathmatchSeconds', thắng theo điểm.
--   * "team": không hồi sinh trong round, round kết thúc khi một đội bị loại hoặc hết giờ.
--   * "zone": hồi sinh sau 5 giây, đội chiếm đủ vùng giữa bản đồ thì thắng.
tickInGame :: ServerState -> MongoPool -> MatchStore -> Text -> RoomState -> IO ()
tickInGame ss db store roomId room = do
  let mode        = rsGameMode room
      teamMode    = mode /= "deathmatch"
      tanks       = rsTanks room
      bullets     = rsBullets room
      maze        = rsMaze room
      inputs      = rsInputs room
      clock'      = rsMatchClock room + dt
      respawnSecs = if mode == "team" then 0 else respawnSeconds

  -- Bước 1: bộ đếm xe (điểm sống sót, bất tử, chờ hồi sinh) và vũ khí
  let tanks1 = Map.mapWithKey (\pid t -> updateWeaponCooldown dt pid (tickTankTimers dt t)) tanks

  -- Bước 2: Xử lý bắn (spawn đạn mới)
  (tanks2, newBullets) <- processFireInputs inputs tanks1 maze

  -- Bước 3: Di chuyển xe tăng + va chạm tường
  let tanks3 = Map.mapWithKey (\pid t ->
        case Map.lookup pid inputs of
          Just inp -> moveTank dt inp maze t
          Nothing  -> t
        ) tanks2

  -- Bước 4: Di chuyển đạn (bay thẳng; loại khi hết tầm bay hoặc chạm tường)
  let bullets2 = filter bulletAlive (map (moveBullet dt maze) (bullets ++ newBullets))

  -- Bước 5: Va chạm đạn - xe tăng (điểm, chuỗi hạ, hồi sinh, không bắn nhầm đồng đội)
  (tanks4, bullets3, killEvents) <- processBulletTankCollisions teamMode respawnSecs tanks3 bullets2

  -- Bước 6: Va chạm đạn - Mystery Box
  (boxes1, bullets4, boxEvents) <-
    processBulletBoxCollisions (rsMysteryBoxes room) bullets3 tanks4

  -- Bước 7: Cập nhật Mystery Box timer & spawn
  (boxes2, boxTimer') <- updateMysteryBoxTimer dt (rsBoxTimer room) boxes1 maze

  -- Bước 8: Ghi nhận kill events vào DB & broadcast
  forM_ killEvents $ \(killer, victim) -> do
    broadcastToRoom ss roomId (SKillEvent killer victim)
    addKill db killer
    addDeath db victim

  -- Bước 9: Ghi nhận box pickup events và trao vũ khí cho người nhặt
  forM_ boxEvents $ \(picker, btype) ->
    broadcastToRoom ss roomId (SMysteryBoxPickup picker btype)
  let tanks4g = foldl (\m (picker, btype) ->
                  Map.adjust (\t -> t { tankWeapon = grantWeapon btype (tankWeapon t) }) picker m)
                tanks4 boxEvents

  -- Bước 10: Hồi sinh (Tử chiến, Cấm Địa) và cập nhật vùng chiếm
  tanks5 <- respawnTanks mode maze tanks4g
  let finalTanks = Map.elems tanks5
      (zone', zoneWinner) = case (mode, rsZone room) of
        ("zone", Just z) -> let (z2, w) = updateZone dt z finalTanks in (Just z2, w)
        _                -> (rsZone room, Nothing)

  -- retainActiveEntities: tick tính từ snapshot cũ, nếu người chơi vừa rời phòng
  -- thì không được "hồi sinh" xe tăng/đạn của họ khi ghi lại state.
  atomically $ modifyRoom ss roomId $ \r ->
    let (tanksKept, bulletsKept) = retainActiveEntities (rsPlayerIds r) tanks5 bullets4
    in r
    { rsTanks        = tanksKept
    , rsBullets      = bulletsKept
    , rsLasers       = []
    , rsMysteryBoxes = boxes2
    , rsBoxTimer     = boxTimer'
    , rsMatchClock   = clock'
    , rsZone         = zone'
    }

  -- Bước 11: Điều kiện kết thúc theo chế độ
  case mode of
    "deathmatch" ->
      when (clock' >= deathmatchSeconds) $
        finishMatch ss db store roomId (rankingWinner finalTanks)
    "zone" ->
      forM_ zoneWinner $ \team ->
        finishMatch ss db store roomId (teamWinnerName team finalTanks)
    _ -> do
      let aliveOf team = length [ t | t <- finalTanks, tankTeam t == team, tankAlive t ]
          a0 = aliveOf 0
          a1 = aliveOf 1
          verdict :: Maybe Int
          verdict
            | a0 == 0 && a1 == 0 = Just (-1)
            | a1 == 0 = Just 0
            | a0 == 0 = Just 1
            | clock' >= teamRoundSeconds = Just (if a0 == a1 then -1 else if a0 > a1 then 0 else 1)
            | otherwise = Nothing
      forM_ verdict (endTeamRound ss roomId finalTanks)

-- | Kết thúc một round Đấu đội: ghi round thắng, báo kết quả, chờ rồi sang round mới.
endTeamRound :: ServerState -> Text -> [Tank] -> Int -> IO ()
endTeamRound ss roomId tanks team = do
  let winner = if team < 0 then "Draw" else teamWinnerName team tanks
  atomically $ modifyRoom ss roomId $ \r -> r
    { rsTeamWins = bumpWin team (rsTeamWins r)
    , rsPhase    = RoundEndPhase teamRoundEndDelay winner
    }
  maybeRoom <- atomically $ getRoom ss roomId
  forM_ maybeRoom $ \r ->
    broadcastToRoom ss roomId
      (SRoundEnd winner [ (tankId t, tankPoints t) | t <- Map.elems (rsTanks r) ])

-- | Sau thời gian hiển thị kết quả round: hoặc kết thúc trận (một đội thắng quá nửa
-- số round, hoặc đã hết số round), hoặc bắt đầu round mới.
advanceAfterRound :: ServerState -> MongoPool -> MatchStore -> Text -> IO ()
advanceAfterRound ss db store roomId = do
  maybeRoom <- atomically $ getRoom ss roomId
  forM_ maybeRoom $ \r -> do
    let wins = rsTeamWins r
        need = teamRounds `div` 2 + 1
        over = any (>= need) wins || rsRoundNumber r >= teamRounds
    if over
      then finishMatch ss db store roomId (matchWinnerByWins wins (Map.elems (rsTanks r)))
      else startNewRound ss roomId

-- | Kết thúc trận với người (hoặc đại diện đội) thắng cho trước.
finishMatch :: ServerState -> MongoPool -> MatchStore -> Text -> Text -> IO ()
finishMatch ss db store roomId winner = do
  maybeRoom <- atomically $ getRoom ss roomId
  forM_ maybeRoom $ \r ->
    handleMatchOver ss db store roomId winner
      [ (tankId t, tankPoints t) | t <- Map.elems (rsTanks r) ] r

-- | Hồi sinh các xe đã hết thời gian chờ (không áp dụng cho Đấu đội).
respawnTanks :: Text -> Maze -> Map Text Tank -> IO (Map Text Tank)
respawnTanks mode maze tanks
  | mode == "team" = return tanks
  | otherwise = foldM step tanks (Map.keys tanks)
  where
    step acc pid = case Map.lookup pid acc of
      Just t | not (tankAlive t) && tankRespawnTimer t <= 0 -> do
        pos <- pickRespawnPos mode maze acc t
        return (Map.insert pid (respawnTank pos t) acc)
      _ -> return acc

-- | Chọn điểm hồi sinh: Cấm Địa về căn cứ của đội; Tử chiến chọn ngẫu nhiên
-- điểm không có xe địch ở gần (nếu không có thì chọn bất kỳ).
pickRespawnPos :: Text -> Maze -> Map Text Tank -> Tank -> IO Vec2
pickRespawnPos mode maze tanks t = do
  let spawns = mazeSpawnPts maze
      farFrom p o = tankId o == tankId t || not (tankAlive o)
                    || vec2Dist p (tankPos o) > tankHitRadius * 5
      preferred
        | mode == "zone" = teamBase maze (tankTeam t)
        | otherwise = [ p | p <- spawns, all (farFrom p) (Map.elems tanks) ]
      pool = if null preferred then spawns else preferred
  if null pool
    then return (Vec2 100 100)
    else do
      i <- randomRIO (0, length pool - 1)
      return (pool !! i)

--------------------------------------------------------------------------------
-- Di chuyển Xe tăng + Va chạm tường (Sliding Collision)
--------------------------------------------------------------------------------

moveTank :: Float -> PlayerInput -> Maze -> Tank -> Tank
moveTank deltaT input maze tank
  | not (tankAlive tank) = tank
  | otherwise =
    let -- Tính vận tốc từ input WASD
        moveX = (if piMoveRight input then 1 else 0)
              - (if piMoveLeft  input then 1 else 0)
        -- The quick-match map uses top-left screen coordinates (positive Y is
        -- down), so W must subtract Y and S must add it.
        moveY = (if piMoveDown input then 1 else 0)
              - (if piMoveUp   input then 1 else 0)
        moveDir = vec2Normalize (Vec2 moveX moveY)
        vel     = vec2Scale tankSpeed moveDir

        -- Vị trí mới dự kiến
        newPos  = vec2Add (tankPos tank) (vec2Scale deltaT vel)

        -- Sliding collision với tường mê cung
        clampedPos = clampToMaze maze (tankPos tank) newPos

        -- Cập nhật góc thân xe (chỉ khi đang di chuyển)
        bodyAngle = if vec2Len vel > 0.1
                    then vec2Angle moveDir
                    else tankBodyAngle tank

        -- Góc nòng pháo = góc chuột từ client
        turretAng = piMouseAngle input

    in tank
      { tankPos         = clampedPos
      , tankVel         = vel
      , tankBodyAngle   = bodyAngle
      , tankTurretAngle = turretAng
      }

-- | Khoảng cách từ điểm p tới đoạn thẳng nối v1 và v2
pointSegmentDist :: Vec2 -> Vec2 -> Vec2 -> Float
pointSegmentDist p v1 v2 =
  let d = vec2Dist v1 v2
      l2 = d * d
  in if l2 < 0.0001
     then vec2Dist p v1
     else let t = max 0 (min 1 (vec2Dot (vec2Sub p v1) (vec2Sub v2 v1) / l2))
              proj = vec2Add v1 (vec2Scale t (vec2Sub v2 v1))
          in vec2Dist p proj

-- | Giữ xe tăng trong giới hạn mê cung và trượt theo tường nội bộ
clampToMaze :: Maze -> Vec2 -> Vec2 -> Vec2
clampToMaze maze oldPos newPos =
  let w = mazeWidth maze
      h = mazeHeight maze
      r = tankRadius + 1
      cx = max r (min (w - r) (vx newPos))
      cy = max r (min (h - r) (vy newPos))
      boundedPos = Vec2 cx cy
      innerWalls = drop 4 (mazeWalls maze)

      collidesWithAny pos = any (\(Wall p1 p2) -> pointSegmentDist pos p1 p2 < r) innerWalls

  in if not (collidesWithAny boundedPos)
       then boundedPos
       else let posX = Vec2 cx (vy oldPos)
            in if not (collidesWithAny posX)
                 then posX
                 else let posY = Vec2 (vx oldPos) cy
                      in if not (collidesWithAny posY)
                           then posY
                           else oldPos

--------------------------------------------------------------------------------
-- Di chuyển Đạn theo đường thẳng; đạn dừng khi va chạm hoặc hết thời gian sống.
--------------------------------------------------------------------------------

moveBullet :: Float -> Maze -> Bullet -> Bullet
moveBullet deltaT maze bul =
  let oldPos = bulPos bul
      newPos = vec2Add oldPos (vec2Scale deltaT (bulVel bul))
      hitWall = bulType bul /= WallPiercingBullet
             && any (crossesWall oldPos newPos) (mazeWalls maze)
  in bul
    { bulPos      = newPos
    , bulLifetime = if hitWall then 0 else bulLifetime bul - deltaT
    , bulBounces  = 0
    }

-- | Detect a swept bullet crossing an axis-aligned maze wall. A hit ends the
-- bullet instead of reflecting it, so fast bullets cannot tunnel through walls.
crossesWall :: Vec2 -> Vec2 -> Wall -> Bool
crossesWall (Vec2 ox oy) (Vec2 nx ny) (Wall (Vec2 x1 y1) (Vec2 x2 y2))
  | abs (y1 - y2) < 0.1 =
      let loX = min x1 x2 - bulletRadius
          hiX = max x1 x2 + bulletRadius
          crossed = (oy <= y1 && ny >= y1) || (oy >= y1 && ny <= y1)
      in crossed && max ox nx >= loX && min ox nx <= hiX
  | abs (x1 - x2) < 0.1 =
      let loY = min y1 y2 - bulletRadius
          hiY = max y1 y2 + bulletRadius
          crossed = (ox <= x1 && nx >= x1) || (ox >= x1 && nx <= x1)
      in crossed && max oy ny >= loY && min oy ny <= hiY
  | otherwise = False

-- | Kiểm tra đạn còn sống.
bulletAlive :: Bullet -> Bool
bulletAlive bul = bulLifetime bul > 0

--------------------------------------------------------------------------------
-- Xử lý bắn đạn (Fire Input → Spawn Bullets)
--------------------------------------------------------------------------------

processFireInputs :: Map Text PlayerInput -> Map Text Tank -> Maze
                  -> IO (Map Text Tank, [Bullet])
processFireInputs inputs tanks _maze = do
  results <- mapM processOne (Map.toList tanks)
  let tanks'  = Map.fromList [(tankId t, t) | (t, _) <- results]
      newBuls = concatMap snd results
  return (tanks', newBuls)
  where
    processOne (pid, tank)
      | not (tankAlive tank) = return (tank, [])
      | otherwise =
        case Map.lookup pid inputs of
          Nothing  -> return (tank, [])
          Just inp -> handleFire inp tank

-- | Xử lý input bắn cho một xe tăng.
handleFire :: PlayerInput -> Tank -> IO (Tank, [Bullet])
handleFire input tank
  | piReload input = return (startMagazineReload tank, [])
  | tankReloadTimer tank > 0 = return (tank, [])
  | tankAmmo tank <= 0 = return (startMagazineReload tank, [])
  | not (piFire input) = return (tank, [])
  | otherwise = case wsCooldownState (tankWeapon tank) of
      Ready -> do
        let weapon = tankWeapon tank
            btype  = wsCurrentWeapon weapon
        buls <- spawnBullets tank btype
        let weapon' = case btype of
              GatlingBullet -> weapon
                { wsCooldownState = GatlingBurst (gatlingBurstCount - 1) gatlingBurstDelay }
              _ -> weapon
                { wsCooldownState = Reloading (weaponCooldown btype) }
            afterShot = tank { tankWeapon = weapon', tankAmmo = tankAmmo tank - 1 }
        return (if tankAmmo afterShot <= 0 then startMagazineReload afterShot else afterShot, buls)

      -- Gatling burst: tự động bắn viên tiếp theo khi delay hết
      -- (xử lý trong updateWeaponCooldown)
      _ -> return (tank, [])

-- | Begin a manual or automatic magazine reload. The same timer is exposed
-- in snapshots for the browser HUD.
startMagazineReload :: Tank -> Tank
startMagazineReload tank
  | tankReloadTimer tank > 0 || tankAmmo tank >= tankMaxAmmo tank = tank
  | otherwise = tank
      { tankReloadTimer = magazineReloadSeconds
      , tankWeapon = (tankWeapon tank) { wsCooldownState = Reloading magazineReloadSeconds }
      }

-- | Spawn đạn theo loại vũ khí.
spawnBullets :: Tank -> BulletType -> IO [Bullet]
spawnBullets tank btype = do
  let pos   = tankPos tank
      angle = tankTurretAngle tank
      dir   = Vec2 (cos angle) (sin angle)
      -- Offset an toàn trong bán kính thân xe (tankRadius = 15) để đạn không bao giờ xuyên qua tường khi đứng sát
      spawnOffset = 12.0 :: Float
      spawnPos = vec2Add pos (vec2Scale spawnOffset dir)
  case btype of
    NormalBullet -> return [mkBullet spawnPos dir bulletSpeed NormalBullet (tankId tank)]

    ShotgunBullet -> do
      -- 3 viên: thẳng + 2 bên mở rẻ quạt
      let dir1 = vec2Rotate (-shotgunSpreadAngle) dir
          dir2 = dir
          dir3 = vec2Rotate shotgunSpreadAngle dir
          sp1  = vec2Add pos (vec2Scale spawnOffset dir1)
          sp3  = vec2Add pos (vec2Scale spawnOffset dir3)
      return [ mkBullet sp1 dir1 1036 NormalBullet (tankId tank)
             , mkBullet spawnPos dir2 1112 NormalBullet (tankId tank)
             , mkBullet sp3 dir3 1036 NormalBullet (tankId tank)
             ]

    LaserBullet ->
      -- Laser xử lý đặc biệt: instant hit (trace ray), không spawn bullet bay
      -- TODO: Implement laser ray tracing
      return [mkBullet spawnPos dir 1737 LaserBullet (tankId tank)]

    WallPiercingBullet ->
      return [mkBullet spawnPos dir wallPiercingSpeed WallPiercingBullet (tankId tank)]

    GatlingBullet ->
      return [mkBullet spawnPos dir 1250 NormalBullet (tankId tank)]

mkBullet :: Vec2 -> Vec2 -> Float -> BulletType -> Text -> Bullet
mkBullet pos dir speed btype ownerId = Bullet
  { bulPos      = pos
  , bulVel      = vec2Scale speed (vec2Normalize dir)
  , bulType     = btype
  , bulOwnerId  = ownerId
  , bulBounces  = 0
  , bulLifetime = bulletRange / max 1 speed
  }

--------------------------------------------------------------------------------
-- Cập nhật Weapon & Cooldown State Machine
--------------------------------------------------------------------------------

updateWeaponCooldown :: Float -> Text -> Tank -> Tank
updateWeaponCooldown deltaT _pid tank
  | not (tankAlive tank) = tank
  | otherwise =
    let weapon = tankWeapon tank
        weapon' = case wsCooldownState weapon of
          Ready -> weapon
          Reloading t ->
            let t' = t - deltaT
            in if t' <= 0
               then weapon { wsCooldownState = Ready }
               else weapon { wsCooldownState = Reloading t' }
          GatlingBurst remaining delay ->
            let delay' = delay - deltaT
            in if delay' <= 0
               then if remaining <= 0
                    -- Hết loạt burst → vào cooldown đạn sự kiện (2.0s)
                    then weapon { wsCooldownState = Reloading specialBulletCooldown }
                    -- Bắn viên tiếp theo (tự động)
                    else weapon { wsCooldownState = GatlingBurst (remaining - 1) gatlingBurstDelay }
               else weapon { wsCooldownState = GatlingBurst remaining delay' }

        -- Cập nhật buff timer (15 giây Mystery Box)
        weapon'' = if wsBuffTimeLeft weapon' > 0
                   then let t' = max 0 (wsBuffTimeLeft weapon' - deltaT)
                        in if t' <= 0
                           -- Hết buff → về đạn thường
                           then weapon' { wsCurrentWeapon = NormalBullet
                                        , wsBuffTimeLeft  = 0 }
                           else weapon' { wsBuffTimeLeft = t' }
                   else weapon'

        reloadTimer' = max 0 (tankReloadTimer tank - deltaT)
        reloaded = tankReloadTimer tank > 0 && reloadTimer' <= 0

    in tank
      { tankWeapon = weapon''
      , tankReloadTimer = reloadTimer'
      , tankAmmo = if reloaded then tankMaxAmmo tank else tankAmmo tank
      }

--------------------------------------------------------------------------------
-- Va chạm Đạn - Xe tăng
--------------------------------------------------------------------------------

processBulletTankCollisions :: Bool -> Float -> Map Text Tank -> [Bullet]
                           -> IO (Map Text Tank, [Bullet], [(Text, Text)])
processBulletTankCollisions teamMode respawnSecs tanks bullets = do
  let (survivingBullets, hitTanks, killEvents) = foldl checkBullet ([], tanks, []) bullets
  return (hitTanks, survivingBullets, killEvents)
  where
    checkBullet (buls, tks, events) bul =
      case findHitTank bul tks of
        Nothing -> (bul : buls, tks, events)
        Just (pid, victim) ->
          -- Xe tăng bị trúng → bị hạ, người bắn nhận điểm; đạn bị tiêu huỷ
          let owner = bulOwnerId bul
              tks' = case Map.lookup owner tks of
                Just killer ->
                  let (killer', victim') = applyKill respawnSecs killer victim
                  in Map.insert pid victim' (Map.insert owner killer' tks)
                Nothing ->
                  Map.insert pid (snd (applyKill respawnSecs victim victim)) tks
          in (buls, tks', events ++ [(owner, pid)])

    -- Không tự bắn mình, không trúng xe đang bất tử, không bắn nhầm đồng đội.
    findHitTank bul tks =
      find (\(pid, t) ->
        tankAlive t
        && tankInvulnerabilityLeft t <= 0
        && pid /= bulOwnerId bul
        && not (sameTeam bul t tks)
        && vec2Dist (bulPos bul) (tankPos t) < (bulletHitRadius + tankHitRadius)
      ) (Map.toList tks)

    sameTeam bul t tks =
      teamMode && tankTeam t >= 0
        && maybe False (\o -> tankTeam o == tankTeam t) (Map.lookup (bulOwnerId bul) tks)

--------------------------------------------------------------------------------
-- Va chạm Đạn - Mystery Box
--------------------------------------------------------------------------------

processBulletBoxCollisions :: [MysteryBox] -> [Bullet] -> Map Text Tank
                          -> IO ([MysteryBox], [Bullet], [(Text, BulletType)])
processBulletBoxCollisions boxes bullets tanks = do
  let (boxes', bullets', events) = foldl checkBulletBox (boxes, [], []) bullets
  return (boxes', bullets', events)
  where
    checkBulletBox (bxs, buls, evts) bul =
      case findHitBox bul bxs of
        Nothing -> (bxs, bul : buls, evts)
        Just idx -> do
          let -- Xoá box bị phá
              bxs' = removeAt idx bxs
              -- Chọn loại đạn ngẫu nhiên cho người bắn
              -- (Trong phiên bản đồng bộ, dùng deterministic random)
              btype = randomBulletType (floor $ vx (bulPos bul))
              evts' = evts ++ [(bulOwnerId bul, btype)]
          -- Lưu ý: Không thể dùng IO ở đây vì fold thuần
          -- Thay vào đó dùng pseudo-random từ vị trí đạn
          (bxs', buls, evts')

    findHitBox bul bxs =
      let hits = [ i | (i, box) <- zip [0..] bxs
                     , mbActive box
                     , vec2Dist (bulPos bul) (mbPos box) < (bulletRadius + boxRadius)
                 ]
      in case hits of
        (i:_) -> Just i
        []    -> Nothing

    removeAt idx xs = take idx xs ++ drop (idx + 1) xs

    -- Pseudo-random dựa trên hash vị trí (deterministic cho replay)
    randomBulletType seed =
      let btypes = [ShotgunBullet, LaserBullet, WallPiercingBullet, GatlingBullet]
      in btypes !! (abs seed `mod` length btypes)

--------------------------------------------------------------------------------
-- Mystery Box Timer & Spawn
--------------------------------------------------------------------------------

updateMysteryBoxTimer :: Float -> Float -> [MysteryBox] -> Maze
                      -> IO ([MysteryBox], Float)
updateMysteryBoxTimer deltaT timer boxes maze = do
  let timer' = timer - deltaT
  if timer' <= 0 && not (hasActiveBox boxes)
    then do
      -- Spawn hộp mới tại vị trí ngẫu nhiên
      let spawnPts = mazeBoxSpawnPts maze
      idx <- randomRIO (0, length spawnPts - 1)
      let pos = spawnPts !! idx
          newBox = MysteryBox
            { mbPos       = pos
            , mbActive    = True
            , mbRespawnIn = 0
            }
      newTimer <- randomRIO (boxSpawnIntervalMin, boxSpawnIntervalMax)
      return (newBox : boxes, newTimer)
    else
      return (boxes, timer')
  where
    hasActiveBox = any mbActive

--------------------------------------------------------------------------------
-- Bắt đầu Round mới
--------------------------------------------------------------------------------

startNewRound :: ServerState -> Text -> IO ()
startNewRound ss roomId = do
  maybeRoom <- atomically $ getRoom ss roomId
  case maybeRoom of
    Nothing -> return ()
    Just room -> do
      -- Giữ nguyên map đã được chọn cho toàn bộ trận đấu.
      newMaze <- generateTrainingMaze (rsMapId room)
      let pids    = rsPlayerIds room
          teamed  = rsGameMode room /= "deathmatch"
          teamOf  = Map.map tankTeam (rsTanks room)
          basePos = teamSpawnPositions newMaze teamOf pids
      -- Xáo trộn điểm spawn ngẫu nhiên trên toàn bản đồ (Tử chiến)
      shuffledSpawns <- shuffleList (mazeSpawnPts newMaze)
      let posFor :: Int -> Text -> Vec2
          posFor idx pid
            | teamed, Just p <- Map.lookup pid basePos = p
            | idx < length shuffledSpawns = shuffledSpawns !! idx
            | otherwise = Vec2 100 100
          tanks' = Map.fromList
            [ (pid, resetTankForRound (posFor idx pid) t)
            | (idx, pid) <- zip [0 ..] pids
            , Just t <- [Map.lookup pid (rsTanks room)]
            ]

      boxDelay <- randomRIO (boxSpawnIntervalMin, boxSpawnIntervalMax)

      atomically $ modifyRoom ss roomId $ \r -> r
        { rsMaze         = newMaze
        , rsTanks        = tanks'
        , rsBullets      = []
        , rsLasers       = []
        , rsMysteryBoxes = []
        , rsPhase        = CountdownPhase countdownDuration
        , rsRoundNumber  = rsRoundNumber r + 1
        , rsBoxTimer     = boxDelay
        , rsMatchClock   = 0
        }

      broadcastToRoom ss roomId (SCountdown countdownDuration)
      putStrLn $ "[Game] Round mới phòng " ++ show roomId ++ " trên map " ++ show (rsMapId room)

--------------------------------------------------------------------------------
-- Kết thúc trận đấu (Match Over)
--------------------------------------------------------------------------------

handleMatchOver :: ServerState -> MongoPool -> MatchStore -> Text -> Text
               -> [(Text, Int)] -> RoomState -> IO ()
handleMatchOver ss db store roomId winner scores room = do
  atomically $ modifyRoom ss roomId $ \r -> r
    { rsPhase = MatchOverPhase winner }

  broadcastToRoom ss roomId (SMatchOver winner scores)

  -- Ghi kết quả vào MongoDB
  let playerRecords =
        [ (tankId t, tankPoints t, tankKills t) | t <- Map.elems (rsTanks room) ]
  _ <- saveMatchResult db roomId (rsStartTime room) winner
         playerRecords (rsRoundNumber room)

  -- Lưu thêm bản ghi vào file JSON (dự phòng khi MongoDB lỗi + phục vụ leaderboard)
  endNow <- getCurrentTime
  appendMatchRecord store MatchRecord
    { mrRoomId       = roomId
    , mrStartTime    = rsStartTime room
    , mrEndTime      = pack (formatTime defaultTimeLocale "%Y-%m-%dT%H:%M:%SZ" endNow)
    , mrWinner       = winner
    , mrPlayers      = [ MatchPlayerRecord (tankId t) (tankPoints t) (tankKills t)
                       | t <- Map.elems (rsTanks room) ]
    , mrRoundsPlayed = rsRoundNumber room
    }

  -- Cập nhật stats từng người chơi
  forM_ (Map.elems (rsTanks room)) $ \tank -> do
    let winnerTeam = fmap tankTeam (Map.lookup winner (rsTanks room))
        isWinner = tankId tank == winner
                   || (tankTeam tank >= 0 && Just (tankTeam tank) == winnerTeam)
    when isWinner $ addWin db (tankId tank)
    updatePlayerStats db (tankId tank) 1
      (if isWinner then 1 else 0)
      (tankKills tank)
      0  -- deaths đã cập nhật realtime

  putStrLn $ "[Game] Trận đấu kết thúc phòng " ++ show roomId
          ++ " - Người thắng: " ++ show winner

  -- Sau 5 giây, chuyển phòng về Lobby
  void $ forkIO $ do
    threadDelay 5000000  -- 5 giây
    atomically $ modifyRoom ss roomId $ \r -> r
      { rsPhase = LobbyPhase }

--------------------------------------------------------------------------------
-- Broadcast World Snapshot
--------------------------------------------------------------------------------

broadcastSnapshot :: ServerState -> Text -> IO ()
broadcastSnapshot ss roomId = do
  maybeRoom <- atomically $ getRoom ss roomId
  case maybeRoom of
    Nothing   -> return ()
    Just room -> do
      -- Layout tĩnh đã được gửi cho cả phòng bằng SSelectedMap. Giữ kích thước
      -- và biên trong snapshot, tránh gửi lại hàng trăm đoạn tường mỗi tick.
      let mazeForSnapshot = (rsMaze room)
            { mazeWalls = take 4 (mazeWalls (rsMaze room))
            , mazeSpawnPts = []
            , mazeBoxSpawnPts = []
            }
          snapshot = WorldSnapshot
            { wsTanks        = Map.elems (rsTanks room)
            , wsBullets      = rsBullets room
            , wsLasers       = rsLasers room
            , wsMysteryBoxes = rsMysteryBoxes room
            , wsMaze         = mazeForSnapshot
            , wsPhase        = rsPhase room
            , wsScores       = [(tankId t, tankPoints t)
                               | t <- Map.elems (rsTanks room)]
            , wsMode         = rsGameMode room
            , wsClock        = rsMatchClock room
            , wsClockLimit   = case rsGameMode room of
                                 "deathmatch" -> deathmatchSeconds
                                 "team"       -> teamRoundSeconds
                                 _            -> 0
            , wsRound        = rsRoundNumber room
            , wsRounds       = if rsGameMode room == "team" then teamRounds else 1
            , wsTeamWins     = rsTeamWins room
            , wsZone         = rsZone room
            }
      broadcastToRoom ss roomId (SGameSnapshot snapshot)
