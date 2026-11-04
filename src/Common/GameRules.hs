-- | Luật thuần có thể kiểm thử độc lập với WebSocket, STM và MongoDB.
module Common.GameRules
  ( WeaponTick(..)
  , stepWeapon
  , grantWeapon
  , traceLaser
  , retainActiveEntities
    -- * Luật chế độ chơi (Tử chiến / Đấu đội / Cấm Địa)
  , tickTankTimers
  , applyKill
  , respawnTank
  , resetTankForRound
  , teamBase
  , teamSpawnPositions
  , assignTeams
  , initialZone
  , updateZone
  , rankingWinner
  , teamWinnerName
  , matchWinnerByWins
  , bumpWin
  ) where

import Data.List (minimumBy, maximumBy, sortBy)
import qualified Data.Map.Strict as Map
import Data.Maybe (mapMaybe)
import Data.Ord (comparing, Down(..))
import Data.Text (Text)

import Common.Config
import Common.Types

data WeaponTick = WeaponTick
  { wtWeapon :: !WeaponState
  , wtFireGatlingRound :: !Bool
  } deriving (Show, Eq)

-- | Tiến một trạng thái vũ khí. Cờ trả về cho biết Gatling cần sinh thêm một viên.
stepWeapon :: Float -> WeaponState -> WeaponTick
stepWeapon deltaT weapon =
  let (cooldown', fireRound) = case wsCooldownState weapon of
        Ready -> (Ready, False)
        Reloading remaining ->
          let remaining' = remaining - deltaT
          in (if remaining' <= 0 then Ready else Reloading remaining', False)
        GatlingBurst remaining delay ->
          let delay' = delay - deltaT
          in if delay' > 0
               then (GatlingBurst remaining delay', False)
               else if remaining <= 0
                 then (Reloading specialBulletCooldown, False)
                 else (GatlingBurst (remaining - 1) gatlingBurstDelay, True)
      afterCooldown = weapon { wsCooldownState = cooldown' }
      buffLeft = wsBuffTimeLeft afterCooldown - deltaT
      afterBuff
        | wsBuffTimeLeft afterCooldown <= 0 = afterCooldown
        | buffLeft <= 0 = afterCooldown
            { wsCurrentWeapon = NormalBullet
            , wsBuffTimeLeft = 0
            }
        | otherwise = afterCooldown { wsBuffTimeLeft = buffLeft }
  in WeaponTick afterBuff fireRound

-- | Nhận vũ khí từ Mystery Box. Đạn thường luôn trở về trạng thái mặc định.
grantWeapon :: BulletType -> WeaponState -> WeaponState
grantWeapon NormalBullet _ = defaultWeaponState
grantWeapon bulletType _ = WeaponState
  { wsCurrentWeapon = bulletType
  , wsBuffTimeLeft = buffDuration
  , wsCooldownState = Ready
  }

-- | Keep only entities whose owner is still a member of the room. A game tick
-- is calculated from a snapshot, while a disconnect may commit before that
-- tick is written back. Applying this pure reconciliation at commit time
-- prevents an old snapshot from bringing a departed tank or its bullets back.
-- Rooms contain at most four players, so list membership is sufficient at 60 Hz.
retainActiveEntities :: [Text] -> Map.Map Text Tank -> [Bullet] -> (Map.Map Text Tank, [Bullet])
retainActiveEntities playerIds tanks bullets =
  ( Map.filterWithKey (\playerId _ -> isActive playerId) tanks
  , filter (isActive . bulOwnerId) bullets
  )
  where
    isActive playerId = playerId `elem` playerIds

-- | Dò tia laser theo các tường axis-aligned của mê cung. Mỗi segment kết
-- thúc tại tường gần nhất, sau đó hướng đi được phản xạ. Không có IO hay state
-- ẩn nên cùng maze và hướng bắn luôn tạo ra cùng một đường đi.
traceLaser :: Maze -> Vec2 -> Vec2 -> [LaserSegment]
traceLaser maze origin direction = go laserMaxReflections origin (vec2Normalize direction)
  where
    epsilon = 0.01 :: Float

    go :: Int -> Vec2 -> Vec2 -> [LaserSegment]
    go remaining start ray
      | remaining <= 0 || vec2Len ray < epsilon = []
      | otherwise =
          case nearestWallHit start ray of
            Nothing -> [LaserSegment start (vec2Add start (vec2Scale laserSegmentMaxLen ray))]
            Just (distance, hitPoint, normal) ->
              let segment = LaserSegment start hitPoint
                  reflected = vec2Normalize (vec2Reflect ray normal)
                  nextStart = vec2Add hitPoint (vec2Scale epsilon reflected)
              in segment : go (remaining - 1) nextStart reflected
      where
        nearestWallHit :: Vec2 -> Vec2 -> Maybe (Float, Vec2, Vec2)
        nearestWallHit startPoint rayDirection =
          case mapMaybe (rayWallHit startPoint rayDirection) (mazeWalls maze) of
            [] -> Nothing
            hits -> Just (minimumBy (comparing hitDistance) hits)

        hitDistance (distance, _, _) = distance

    rayWallHit :: Vec2 -> Vec2 -> Wall -> Maybe (Float, Vec2, Vec2)
    rayWallHit (Vec2 ox oy) (Vec2 dx dy) (Wall (Vec2 x1 y1) (Vec2 x2 y2))
      | abs (x1 - x2) < epsilon && abs dx >= epsilon =
          let distance = (x1 - ox) / dx
              hitY = oy + distance * dy
              lowY = min y1 y2 - epsilon
              highY = max y1 y2 + epsilon
              normal = Vec2 (negate (signum dx)) 0
          in if distance > epsilon && distance <= laserSegmentMaxLen
                && hitY >= lowY && hitY <= highY
               then Just (distance, Vec2 x1 hitY, normal)
               else Nothing
      | abs (y1 - y2) < epsilon && abs dy >= epsilon =
          let distance = (y1 - oy) / dy
              hitX = ox + distance * dx
              lowX = min x1 x2 - epsilon
              highX = max x1 x2 + epsilon
              normal = Vec2 0 (negate (signum dy))
          in if distance > epsilon && distance <= laserSegmentMaxLen
                && hitX >= lowX && hitX <= highX
               then Just (distance, Vec2 hitX y1, normal)
               else Nothing
      | otherwise = Nothing

--------------------------------------------------------------------------------
-- Điểm số, hạ gục, hồi sinh (dùng chung cho mọi chế độ)
--------------------------------------------------------------------------------

-- | Bộ đếm thời gian của một xe trong một tick: điểm sống sót (3 điểm/giây),
-- thời gian bất tử còn lại, và thời gian chờ hồi sinh khi đã bị hạ.
tickTankTimers :: Float -> Tank -> Tank
tickTankTimers deltaT tank
  | tankAlive tank =
      let carry = tankSurvivalCarry tank + deltaT
          whole = floor carry :: Int
      in tank
           { tankInvulnerabilityLeft = max 0 (tankInvulnerabilityLeft tank - deltaT)
           , tankSurvivalCarry = carry - fromIntegral whole
           , tankPoints = tankPoints tank + whole * survivalPointsPerSecond
           }
  | otherwise = tank { tankRespawnTimer = max 0 (tankRespawnTimer tank - deltaT) }

-- | Áp dụng một lần hạ gục: trả về (người bắn, nạn nhân) đã cập nhật.
-- Người bắn +10 điểm, +20 nếu nạn nhân đang có chuỗi từ 3 mạng trở lên.
applyKill :: Float -> Tank -> Tank -> (Tank, Tank)
applyKill respawnSecs killer victim =
  let shutdown = tankKillStreak victim >= streakStartKills
      pts = killPoints + (if shutdown then shutdownBonus else 0)
      killer' = killer
        { tankKills = tankKills killer + 1
        , tankKillStreak = tankKillStreak killer + 1
        , tankPoints = tankPoints killer + pts
        }
      victim' = victim
        { tankAlive = False
        , tankVel = vec2Zero
        , tankDeaths = tankDeaths victim + 1
        , tankKillStreak = 0
        , tankRespawnTimer = respawnSecs
        , tankInvulnerabilityLeft = 0
        , tankReloadTimer = 0
        , tankSurvivalCarry = 0
        }
  in (killer', victim')

-- | Hồi sinh xe tại vị trí cho trước: đạn đầy, bất tử một lúc.
respawnTank :: Vec2 -> Tank -> Tank
respawnTank pos tank = tank
  { tankPos = pos
  , tankVel = vec2Zero
  , tankAlive = True
  , tankRespawnTimer = 0
  , tankInvulnerabilityLeft = invulnerableSeconds
  , tankAmmo = tankMaxAmmo tank
  , tankReloadTimer = 0
  , tankSurvivalCarry = 0
  , tankWeapon = (tankWeapon tank) { wsCooldownState = Ready }
  }

-- | Đưa xe về trạng thái đầu round/trận (giữ nguyên điểm, kills, deaths).
resetTankForRound :: Vec2 -> Tank -> Tank
resetTankForRound pos tank = tank
  { tankPos = pos
  , tankVel = vec2Zero
  , tankWeapon = defaultWeaponState
  , tankAmmo = tankMaxAmmo tank
  , tankReloadTimer = 0
  , tankAlive = True
  , tankRespawnTimer = 0
  , tankInvulnerabilityLeft = 0
  , tankSurvivalCarry = 0
  }

--------------------------------------------------------------------------------
-- Đội và căn cứ
--------------------------------------------------------------------------------

-- | Các điểm xuất hiện của một đội: đội 0 gần góc trên-trái, đội 1 ở điểm xa nhất.
teamBase :: Maze -> Int -> [Vec2]
teamBase maze team
  | null spawns = [Vec2 100 100]
  | otherwise = take 5 (sortBy (comparing (vec2Dist anchor)) spawns)
  where
    spawns = mazeSpawnPts maze
    anchorA = minimumBy (comparing (\(Vec2 x y) -> x + y)) spawns
    anchorB = maximumBy (comparing (vec2Dist anchorA)) spawns
    anchor = if team == 0 then anchorA else anchorB

-- | Vị trí xuất hiện đầu round của từng người chơi theo đội.
teamSpawnPositions :: Maze -> Map.Map Text Int -> [Text] -> Map.Map Text Vec2
teamSpawnPositions maze teamOf pids = Map.fromList
  [ (pid, pts !! (i `mod` length pts))
  | team <- [0, 1]
  , let pts = teamBase maze team
  , (i, pid) <- zip [0 :: Int ..] [p | p <- pids, Map.lookup p teamOf == Just team]
  ]

-- | Gán đội cho mọi người chơi: ai đã chọn "blue"/"red" thì giữ nguyên,
-- người chưa chọn được xếp vào đội đang ít người hơn.
assignTeams :: [Text] -> Map.Map Text Text -> Map.Map Text Int
assignTeams pids chosen = foldl place fixed unassigned
  where
    fixed = Map.fromList [ (p, if t == "red" then 1 else 0) | p <- pids, Just t <- [Map.lookup p chosen] ]
    unassigned = [ p | p <- pids, Map.notMember p fixed ]
    place m p =
      let n0 = length (filter (== 0) (Map.elems m))
          n1 = length (filter (== 1) (Map.elems m))
      in Map.insert p (if n0 <= n1 then 0 else (1 :: Int)) m

--------------------------------------------------------------------------------
-- Cấm Địa (Control Zone)
--------------------------------------------------------------------------------

-- | Vùng chiếm đặt giữa bản đồ, bị khoá trong vài giây đầu.
initialZone :: Maze -> ZoneState
initialZone maze = ZoneState
  { zsCx = mazeWidth maze / 2
  , zsCy = mazeHeight maze / 2
  , zsRadius = zoneRadius
  , zsOpen = False
  , zsLockLeft = zoneLockSeconds
  , zsElapsed = 0
  , zsProgress = [0, 0]
  , zsInside = [0, 0]
  , zsOwner = -1
  , zsOvertime = False
  , zsHold = 0
  , zsHoldTeam = -1
  }

-- | Tiến vùng chiếm một tick. Trả về trạng thái mới và (nếu có) đội thắng.
-- Đội đông xe hơn trong vùng thì tăng tiến trình; hai đội cùng có xe thì tiến
-- trình dừng ở 99%; khi cả hai cùng 99% phải áp đảo liên tục để thắng.
updateZone :: Float -> ZoneState -> [Tank] -> (ZoneState, Maybe Int)
updateZone deltaT z tanks
  | not (zsOpen z) =
      let lock' = max 0 (zsLockLeft z - deltaT)
      in if lock' <= 0
           then (z1 { zsOpen = True, zsLockLeft = 0, zsElapsed = 0 }, Nothing)
           else (z1 { zsLockLeft = lock' }, Nothing)
  | prog 0 >= 99 && prog 1 >= 99 =
      let lead | a == b = -1
               | a > b = 0
               | otherwise = 1 :: Int
          (hold0, holdTeam') = if lead /= zsHoldTeam z then (0, lead) else (zsHold z, zsHoldTeam z)
          hold' = if lead >= 0 then hold0 + deltaT else hold0
          z2 = base { zsOvertime = True, zsHold = hold', zsHoldTeam = holdTeam' }
      in if lead >= 0 && hold' >= zoneContestSeconds
           then (z2 { zsProgress = setProg lead 100 }, Just lead)
           else (z2, Nothing)
  | a /= b =
      let t = if a > b then 0 else 1 :: Int
          cap = if a > 0 && b > 0 then 99 else 100
          p' = min cap (prog t + 100 / zoneCaptureSeconds * rate t * deltaT)
          z2 = base { zsProgress = setProg t p' }
      in (z2, if p' >= 100 then Just t else Nothing)
  | otherwise = (base, Nothing)
  where
    centre = Vec2 (zsCx z) (zsCy z)
    countIn team = length [ t | t <- tanks, tankAlive t, tankTeam t == team
                              , vec2Dist (tankPos t) centre <= zsRadius z ]
    a = countIn 0
    b = countIn 1
    z1 = z { zsInside = [a, b] }
    owner' = if a /= b then (if a > b then 0 else 1) else zsOwner z
    base = z1 { zsElapsed = zsElapsed z + deltaT, zsOwner = owner' }
    prog i = zsProgress z !! i
    setProg i v = [ if k == i then v else w | (k, w) <- zip [0 :: Int ..] (zsProgress z) ]
    rate t =
      let mine = prog t
          other = prog (1 - t)
      in if mine >= 70 then zoneSpeedAt70
         else if other >= 50 && mine < 50 then zoneSpeedBehindAt50
         else 1

--------------------------------------------------------------------------------
-- Xếp hạng và người thắng
--------------------------------------------------------------------------------

-- | Người thắng theo điểm (hoà: nhiều kills hơn, rồi ít lần chết hơn).
rankingWinner :: [Tank] -> Text
rankingWinner [] = "Draw"
rankingWinner tanks = tankId (head (sortBy order tanks))
  where order = comparing (\t -> (Down (tankPoints t), Down (tankKills t), tankDeaths t))

-- | Đại diện của một đội (người nhiều điểm nhất) để thông báo đội thắng.
teamWinnerName :: Int -> [Tank] -> Text
teamWinnerName team tanks = rankingWinner (filter ((== team) . tankTeam) tanks)

-- | Đội nhiều round thắng hơn; bằng nhau thì hoà.
matchWinnerByWins :: [Int] -> [Tank] -> Text
matchWinnerByWins [a, b] tanks
  | a > b = teamWinnerName 0 tanks
  | b > a = teamWinnerName 1 tanks
matchWinnerByWins _ _ = "Draw"

-- | Cộng một round thắng cho đội (đội âm = hoà, không cộng).
bumpWin :: Int -> [Int] -> [Int]
bumpWin team wins = [ if i == team then w + 1 else w | (i, w) <- zip [0 ..] wins ]
