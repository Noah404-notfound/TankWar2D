-- | test/Spec.hs
-- Bộ kiểm thử tự động cho TankWar (Vector math, Cooldown, Protocol serialization).
module Main where

import System.Exit (exitFailure, exitSuccess)
import System.IO (BufferMode(LineBuffering), hSetBuffering, stdout)
import Data.Aeson (encode, decode)
import Data.Either (isLeft)
import Data.Text (Text)
import qualified Data.Map.Strict as Map

import Common.Types
import Common.Config
import Common.CommandParser
import Common.GameRules
import Common.Protocol

--------------------------------------------------------------------------------
-- Helper assert
--------------------------------------------------------------------------------

assertEq :: (Eq a, Show a) => String -> a -> a -> IO ()
assertEq label actual expected =
  if actual == expected
    then putStrLn $ "  [PASS] " ++ label
    else do
      putStrLn $ "  [FAIL] " ++ label ++ "\n    Expected: " ++ show expected ++ "\n    Actual:   " ++ show actual
      exitFailure

assertTrue :: String -> Bool -> IO ()
assertTrue label cond =
  if cond
    then putStrLn $ "  [PASS] " ++ label
    else do
      putStrLn $ "  [FAIL] " ++ label
      exitFailure

assertNear :: String -> Float -> Float -> Float -> IO ()
assertNear label actual expected epsilon =
  if abs (actual - expected) <= epsilon
    then putStrLn $ "  [PASS] " ++ label
    else do
      putStrLn $ "  [FAIL] " ++ label ++ "\n    Expected: " ++ show expected ++ "\n    Actual:   " ++ show actual
      exitFailure

assertLeft :: Show a => String -> Either a b -> IO ()
assertLeft label result =
  assertTrue label (isLeft result)

testTank :: Text -> TankColor -> Tank
testTank playerId color = Tank
  { tankId = playerId
  , tankPos = vec2Zero
  , tankVel = vec2Zero
  , tankBodyAngle = 0
  , tankTurretAngle = 0
  , tankColor = color
  , tankWeapon = defaultWeaponState
  , tankAlive = True
  , tankScore = 0
  , tankKills = 0
  , tankDeaths = 0
  , tankAssists = 0
  , tankPoints = 0
  , tankKillStreak = 0
  , tankMultiKillCount = 0
  , tankMultiKillTimer = 0
  , tankRespawnTimer = 0
  , tankInvulnerabilityLeft = 0
  , tankAmmo = 0
  , tankMaxAmmo = 0
  , tankReloadTimer = 0
  , tankSurvivalCarry = 0
  , tankHull = "05"
  , tankGun = "05"
  , tankTeam = -1
  }

--------------------------------------------------------------------------------
-- Test Suites
--------------------------------------------------------------------------------

testVectorMath :: IO ()
testVectorMath = do
  putStrLn "\n--- [1] Vector Math Tests ---"
  
  -- Vector addition
  let v1 = Vec2 3 4
      v2 = Vec2 1 2
  assertEq "vec2Add (3,4) (1,2) == (4,6)" (vec2Add v1 v2) (Vec2 4 6)
  assertEq "vec2Sub (3,4) (1,2) == (2,2)" (vec2Sub v1 v2) (Vec2 2 2)
  assertEq "vec2Dot (3,4) (1,2) == 11" (vec2Dot v1 v2) 11.0
  assertNear "vec2Len (3,4) == 5" (vec2Len v1) 5.0 1e-5

  -- Normalization
  let norm = vec2Normalize v1
  assertNear "vec2Len of normalized vector == 1.0" (vec2Len norm) 1.0 1e-5
  assertNear "vec2Normalize X == 0.6" (vx norm) 0.6 1e-5
  assertNear "vec2Normalize Y == 0.8" (vy norm) 0.8 1e-5

  -- Reflection: bouncing against vertical wall (normal pointing Left (-1, 0))
  let vel = Vec2 10 5
      wallNormal = Vec2 (-1) 0
      reflected = vec2Reflect vel wallNormal
  assertNear "Reflect horizontal vel: vx -> -10" (vx reflected) (-10.0) 1e-4
  assertNear "Reflect horizontal vel: vy remains 5" (vy reflected) 5.0 1e-4

testWeaponCooldowns :: IO ()
testWeaponCooldowns = do
  putStrLn "\n--- [2] Weapon Cooldown Configuration Tests ---"
  assertEq "Normal bullet cooldown is 0.5s" (weaponCooldown NormalBullet) 0.5
  assertEq "Shotgun bullet cooldown is 1.0s" (weaponCooldown ShotgunBullet) 1.0
  assertEq "Laser bullet cooldown is 1.0s" (weaponCooldown LaserBullet) 1.0
  assertEq "Wall-piercing bullet cooldown is 1.0s" (weaponCooldown WallPiercingBullet) 1.0
  assertEq "Gatling bullet cooldown is 1.0s" (weaponCooldown GatlingBullet) 1.0
  assertEq "Buff duration is 15.0s" buffDuration 15.0
  assertEq "Gatling burst count is 3" gatlingBurstCount 3
  assertEq "Bullet bouncing is disabled" maxBulletBounces 0

testProtocolSerialization :: IO ()
testProtocolSerialization = do
  putStrLn "\n--- [3] Protocol JSON Round-trip Serialization Tests ---"
  
  -- ClientMessage roundtrip
  let loginMsg = CLogin "pilot1" "Ace Pilot"
      encodedLogin = encode loginMsg
      decodedLogin = decode encodedLogin :: Maybe ClientMessage
  assertEq "CLogin JSON roundtrip" decodedLogin (Just loginMsg)

  let inputMsg = CPlayerInput (PlayerInput True False False True 1.57 True True)
      encodedInput = encode inputMsg
      decodedInput = decode encodedInput :: Maybe ClientMessage
  assertEq "CPlayerInput JSON roundtrip" decodedInput (Just inputMsg)

  -- ServerMessage roundtrip
  let rosterMsg = SRoomRoster [("player1", TankRed), ("player2", TankBlue)]
      encodedRoster = encode rosterMsg
      decodedRoster = decode encodedRoster :: Maybe ServerMessage
  assertEq "SRoomRoster JSON roundtrip" decodedRoster (Just rosterMsg)

  let roomInfo = RoomInfo
        { riRoomId = "ABC123"
        , riRoomName = "Test room"
        , riGameMode = "deathmatch"
        , riMaxPlayers = 4
        , riCurrentPlayers = 2
        , riHasPassword = False
        , riPhase = LobbyPhase
        }
      encodedRoomInfo = encode roomInfo
      decodedRoomInfo = decode encodedRoomInfo :: Maybe RoomInfo
  assertEq "RoomInfo keeps the current host in JSON" decodedRoomInfo (Just roomInfo)

  let countdownMsg = SCountdown 2.5
      encodedCountdown = encode countdownMsg
      decodedCountdown = decode encodedCountdown :: Maybe ServerMessage
  assertEq "SCountdown JSON roundtrip" decodedCountdown (Just countdownMsg)

testCommandParser :: IO ()
testCommandParser = do
  putStrLn "\n--- [4] Megaparsec Startup Configuration Tests ---"
  assertEq "Full Mongo URI and port parse"
    (parseServerOptions ["--port", "8081", "--mongo-uri", "mongodb://db.example:27018/Arena"])
    (Right (ServerOptions (Just 8081) (Just (MongoEndpoint "db.example" 27018 "Arena"))))
  assertEq "Short Mongo endpoint parse"
    (parseServerOptions ["--mongo-uri", "localhost:27019/TankWarTest"])
    (Right (ServerOptions Nothing (Just (MongoEndpoint "localhost" 27019 "TankWarTest"))))
  assertEq "No startup options are valid"
    (parseServerOptions [])
    (Right (ServerOptions Nothing Nothing))
  assertLeft "Reject invalid port with a parser error"
    (parseServerOptions ["--port", "70000"])
  assertLeft "Reject unknown startup option"
    (parseServerOptions ["--unknown"])

testWeaponRules :: IO ()
testWeaponRules = do
  putStrLn "\n--- [5] Pure Weapon State Machine Tests ---"
  let granted = grantWeapon ShotgunBullet defaultWeaponState
  assertEq "Mystery Box grants the requested weapon" (wsCurrentWeapon granted) ShotgunBullet
  assertEq "Mystery Box grants a 15-second buff" (wsBuffTimeLeft granted) buffDuration
  assertEq "Reload finishes at zero" (wsCooldownState $ wtWeapon $ stepWeapon 0.5 (WeaponState NormalBullet 0 (Reloading 0.5))) Ready

  let expired = stepWeapon 15.0 (WeaponState LaserBullet 15.0 Ready)
  assertEq "Expired buff restores normal bullets" (wsCurrentWeapon $ wtWeapon expired) NormalBullet
  assertEq "Expired buff clears its timer" (wsBuffTimeLeft $ wtWeapon expired) 0

  let burst = stepWeapon gatlingBurstDelay (WeaponState GatlingBullet 10 (GatlingBurst 2 gatlingBurstDelay))
  assertTrue "Gatling requests its next bullet after the burst delay" (wtFireGatlingRound burst)
  assertEq "Gatling decrements remaining burst bullets" (wsCooldownState $ wtWeapon burst) (GatlingBurst 1 gatlingBurstDelay)
  assertEq "Gatling enters special cooldown after its final queued bullet"
    (wsCooldownState $ wtWeapon $ stepWeapon gatlingBurstDelay (WeaponState GatlingBullet 10 (GatlingBurst 0 gatlingBurstDelay)))
    (Reloading specialBulletCooldown)

  let laserMaze = Maze [Wall (Vec2 10 0) (Vec2 10 20)] 20 20 [] [] []
      laserSegments = traceLaser laserMaze (Vec2 5 5) (Vec2 1 0)
  assertEq "Laser traces an initial segment and a reflected segment" (length laserSegments) 2
  case laserSegments of
    [LaserSegment _ firstEnd, LaserSegment secondStart secondEnd] -> do
      assertNear "Laser reaches the nearest wall before reflecting" (vx firstEnd) 10 1e-4
      assertTrue "Reflected laser travels in the opposite direction" (vx secondEnd < vx secondStart)
    _ -> do
      putStrLn "  [FAIL] Laser segments have unexpected structure"
      exitFailure

  let activeBullet = Bullet (Vec2 0 0) vec2Zero NormalBullet "active" 0 1
      departedBullet = Bullet (Vec2 10 0) vec2Zero NormalBullet "departed" 0 1
      tanks :: Map.Map Text Tank
      tanks = Map.fromList
        [("active", testTank "active" TankRed), ("departed", testTank "departed" TankBlue)]
      (remainingTanks, remainingBullets) = retainActiveEntities ["active"]
        tanks
        [activeBullet, departedBullet]
  assertEq "Tick commit does not restore a departed tank" (Map.keys remainingTanks) ["active"]
  assertEq "Tick commit removes bullets owned by departed players" remainingBullets [activeBullet]

--------------------------------------------------------------------------------
-- Main Runner
--------------------------------------------------------------------------------

main :: IO ()
main = do
  hSetBuffering stdout LineBuffering
  putStrLn "=========================================="
  putStrLn "    TankWar Test Suite - Quality Check    "
  putStrLn "=========================================="
  testVectorMath
  testWeaponCooldowns
  testProtocolSerialization
  testCommandParser
  testWeaponRules
  putStrLn "\n=========================================="
  putStrLn "   ALL TESTS PASSED SUCCESSFULLY! (40/40)  "
  putStrLn "=========================================="
  exitSuccess
