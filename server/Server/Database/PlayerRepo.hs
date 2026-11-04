-- | Server.Database.PlayerRepo
-- Thao tác CRUD hồ sơ trong collection "tankwar_server".
-- Quản lý hồ sơ người chơi, thống kê kills/wins, bảng xếp hạng.
module Server.Database.PlayerRepo
  ( findPlayer
  , createPlayer
  , updatePlayerStats
  , addKill
  , addDeath
  , addWin
  , addBoxCollected
  , getLeaderboard
  , getTopKillers
  ) where

import Database.MongoDB
import Data.Text        (Text)
import Data.Time.Clock  (getCurrentTime)
import Data.Time.Format (formatTime, defaultTimeLocale)
import Control.Monad.IO.Class (liftIO)

import Server.Database.Connection

--------------------------------------------------------------------------------
-- Hằng số
--------------------------------------------------------------------------------

serverCol :: Collection
serverCol = "tankwar_server"

--------------------------------------------------------------------------------
-- Tìm người chơi theo username
--------------------------------------------------------------------------------

-- | Tìm người chơi. Trả về Document nếu tìm thấy.
findPlayer :: MongoPool -> Text -> IO (Maybe Document)
findPlayer pool username = do
  result <- withMongo pool $
    findOne (select ["type" =: ("player" :: Text), "username" =: username] serverCol)
  case result of
    Right doc -> return doc
    Left  _   -> return Nothing

--------------------------------------------------------------------------------
-- Tạo hồ sơ người chơi mới
--------------------------------------------------------------------------------

-- | Tạo người chơi mới với stats ban đầu = 0.
createPlayer :: MongoPool -> Text -> Text -> IO Bool
createPlayer pool username displayName = do
  now <- getCurrentTime
  let timeStr = formatTime defaultTimeLocale "%Y-%m-%dT%H:%M:%SZ" now
  result <- withMongo pool $
    insert serverCol
      [ "type"        =: ("player" :: Text)
      , "username"    =: username
      , "displayName" =: displayName
      , "createdAt"   =: (timeStr :: String)
      , "stats"       =: statsDoc 0 0 0 0 0
      ]
  case result of
    Right _ -> do
      putStrLn $ "[DB] Tạo người chơi mới: " ++ show username
      return True
    Left err -> do
      putStrLn $ "[DB] Lỗi tạo người chơi: " ++ show err
      return False

--------------------------------------------------------------------------------
-- Cập nhật thống kê
--------------------------------------------------------------------------------

-- | Cập nhật toàn bộ stats sau một trận đấu.
updatePlayerStats :: MongoPool -> Text -> Int -> Int -> Int -> Int -> IO ()
updatePlayerStats pool username addMatches addWins addKills addDeaths = do
  _ <- withMongo pool $
    modify (select ["type" =: ("player" :: Text), "username" =: username] serverCol)
      [ "$inc" =:
        [ "stats.totalMatches"   =: addMatches
        , "stats.wins"           =: addWins
        , "stats.kills"          =: addKills
        , "stats.deaths"         =: addDeaths
        ]
      ]
  return ()

-- | Cộng 1 kill cho người chơi.
addKill :: MongoPool -> Text -> IO ()
addKill pool username = do
  _ <- withMongo pool $
    modify (select ["type" =: ("player" :: Text), "username" =: username] serverCol)
      ["$inc" =: ["stats.kills" =: (1 :: Int)]]
  return ()

-- | Cộng 1 death cho người chơi.
addDeath :: MongoPool -> Text -> IO ()
addDeath pool username = do
  _ <- withMongo pool $
    modify (select ["type" =: ("player" :: Text), "username" =: username] serverCol)
      ["$inc" =: ["stats.deaths" =: (1 :: Int)]]
  return ()

-- | Cộng 1 win cho người chơi.
addWin :: MongoPool -> Text -> IO ()
addWin pool username = do
  _ <- withMongo pool $
    modify (select ["type" =: ("player" :: Text), "username" =: username] serverCol)
      ["$inc" =: ["stats.wins" =: (1 :: Int), "stats.totalMatches" =: (1 :: Int)]]
  return ()

-- | Cộng 1 box collected.
addBoxCollected :: MongoPool -> Text -> IO ()
addBoxCollected pool username = do
  _ <- withMongo pool $
    modify (select ["type" =: ("player" :: Text), "username" =: username] serverCol)
      ["$inc" =: ["stats.boxesCollected" =: (1 :: Int)]]
  return ()

--------------------------------------------------------------------------------
-- Bảng xếp hạng
--------------------------------------------------------------------------------

-- | Lấy top N người chơi theo tỷ lệ thắng (wins).
getLeaderboard :: MongoPool -> Int -> IO [Document]
getLeaderboard pool topN = do
  result <- withMongo pool $ do
    cursor <- find (select ["type" =: ("player" :: Text)] serverCol)
      { sort  = ["stats.wins" =: (-1 :: Int)]
      , limit = fromIntegral topN
      }
    rest cursor
  case result of
    Right docs -> return docs
    Left  _    -> return []

-- | Lấy top N người chơi theo số kills.
getTopKillers :: MongoPool -> Int -> IO [Document]
getTopKillers pool topN = do
  result <- withMongo pool $ do
    cursor <- find (select ["type" =: ("player" :: Text)] serverCol)
      { sort  = ["stats.kills" =: (-1 :: Int)]
      , limit = fromIntegral topN
      }
    rest cursor
  case result of
    Right docs -> return docs
    Left  _    -> return []

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

statsDoc :: Int -> Int -> Int -> Int -> Int -> Document
statsDoc matches wins kills deaths boxes =
  [ "totalMatches"   =: matches
  , "wins"           =: wins
  , "kills"          =: kills
  , "deaths"         =: deaths
  , "boxesCollected" =: boxes
  ]
