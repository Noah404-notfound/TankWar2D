-- | Server.Database.MatchRepo
-- Thao tác CRUD lịch sử trận trong collection "tankwar_server".
-- Lưu trữ lịch sử trận đấu và truy vấn kết quả.
module Server.Database.MatchRepo
  ( saveMatchResult
  , getRecentMatches
  , getPlayerMatches
  ) where

import Database.MongoDB
import Data.Text        (Text)
import Data.Time.Clock  (getCurrentTime)
import Data.Time.Format (formatTime, defaultTimeLocale)

import Server.Database.Connection

--------------------------------------------------------------------------------
-- Hằng số
--------------------------------------------------------------------------------

serverCol :: Collection
serverCol = "tankwar_server"

--------------------------------------------------------------------------------
-- Lưu kết quả trận đấu
--------------------------------------------------------------------------------

-- | Lưu kết quả trận đấu hoàn chỉnh vào MongoDB.
saveMatchResult
  :: MongoPool
  -> Text              -- ^ Room ID
  -> Text              -- ^ Thời gian bắt đầu (ISO 8601)
  -> Text              -- ^ Tên người thắng
  -> [(Text, Int, Int)] -- ^ [(username, score, kills)]
  -> Int               -- ^ Số round đã chơi
  -> IO Bool
saveMatchResult pool roomId startTime winner players roundsPlayed = do
  now <- getCurrentTime
  let endTime = formatTime defaultTimeLocale "%Y-%m-%dT%H:%M:%SZ" now
      playerDocs =
        [ [ "username" =: uname
          , "score"    =: score
          , "kills"    =: kills
          ] :: Document
        | (uname, score, kills) <- players
        ]
  result <- withMongo pool $
    insert serverCol
      [ "type"         =: ("match" :: Text)
      , "roomId"       =: roomId
      , "startTime"    =: startTime
      , "endTime"      =: (endTime :: String)
      , "winner"       =: winner
      , "players"      =: playerDocs
      , "roundsPlayed" =: roundsPlayed
      ]
  case result of
    Right _ -> do
      putStrLn $ "[DB] Lưu kết quả trận đấu phòng " ++ show roomId
              ++ " - Người thắng: " ++ show winner
      return True
    Left err -> do
      putStrLn $ "[DB] Lỗi lưu trận đấu: " ++ show err
      return False

--------------------------------------------------------------------------------
-- Truy vấn lịch sử
--------------------------------------------------------------------------------

-- | Lấy N trận đấu gần nhất.
getRecentMatches :: MongoPool -> Int -> IO [Document]
getRecentMatches pool n = do
  result <- withMongo pool $ do
    cursor <- find (select ["type" =: ("match" :: Text)] serverCol)
      { sort  = ["endTime" =: (-1 :: Int)]
      , limit = fromIntegral n
      }
    rest cursor
  case result of
    Right docs -> return docs
    Left  _    -> return []

-- | Lấy lịch sử trận đấu của một người chơi cụ thể.
getPlayerMatches :: MongoPool -> Text -> Int -> IO [Document]
getPlayerMatches pool username n = do
  result <- withMongo pool $ do
    cursor <- find (select ["type" =: ("match" :: Text), "players.username" =: username] serverCol)
      { sort  = ["endTime" =: (-1 :: Int)]
      , limit = fromIntegral n
      }
    rest cursor
  case result of
    Right docs -> return docs
    Left  _    -> return []
