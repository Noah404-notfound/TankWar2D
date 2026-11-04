-- | Lưu lịch sử trận cục bộ dưới dạng JSON.
--   File là lớp dự phòng khi MongoDB không sẵn sàng và cũng cho phép nạp lại dữ liệu khi khởi động.
module Server.Persistence
  ( MatchStore
  , defaultMatchHistoryPath
  , newMatchStore
  , appendMatchRecord
  , loadMatchHistory
  , leaderboardFromHistory
  ) where

import Control.Concurrent.MVar (MVar, newMVar, withMVar)
import Control.Exception (IOException, try)
import Data.Aeson (eitherDecodeFileStrict', encodeFile)
import Data.List (sortBy)
import qualified Data.Map.Strict as Map
import Data.Ord (comparing)
import Data.Text (Text)
import System.Directory (createDirectoryIfMissing, doesFileExist)
import System.FilePath (takeDirectory)

import Common.Types (MatchPlayerRecord(..), MatchRecord(..))

data MatchStore = MatchStore
  { msPath :: !FilePath
  , msLock :: !(MVar ())
  }

defaultMatchHistoryPath :: FilePath
defaultMatchHistoryPath = "data/match-history.json"

newMatchStore :: FilePath -> IO MatchStore
newMatchStore path = do
  lock <- newMVar ()
  pure MatchStore { msPath = path, msLock = lock }

loadMatchHistory :: MatchStore -> IO [MatchRecord]
loadMatchHistory store = withMVar (msLock store) $ \_ -> loadHistoryFile (msPath store)

appendMatchRecord :: MatchStore -> MatchRecord -> IO ()
appendMatchRecord store record = withMVar (msLock store) $ \_ -> do
  let path = msPath store
  createDirectoryIfMissing True (takeDirectory path)
  history <- loadHistoryFile path
  writeResult <- try @IOException $ encodeFile path (history ++ [record])
  case writeResult of
    Left err -> putStrLn $ "[FileStore] Không thể lưu lịch sử trận: " ++ show err
    Right _ -> pure ()

loadHistoryFile :: FilePath -> IO [MatchRecord]
loadHistoryFile path = do
  exists <- doesFileExist path
  if not exists
    then pure []
    else do
      decoded <- try @IOException (eitherDecodeFileStrict' path)
      case decoded of
        Left err -> do
          putStrLn $ "[FileStore] Không thể đọc lịch sử trận: " ++ show err
          pure []
        Right (Left message) -> do
          putStrLn $ "[FileStore] JSON lịch sử không hợp lệ: " ++ message
          pure []
        Right (Right history) -> pure history

-- | Tạo bảng xếp hạng thuần từ lịch sử đã nạp: username, số trận thắng, tổng kill.
leaderboardFromHistory :: [MatchRecord] -> [(Text, Int, Int)]
leaderboardFromHistory history =
  [ (username, wins, kills)
  | (username, (wins, kills)) <- take 10 (sortBy (flip (comparing snd)) (Map.toList totals))
  ]
  where
    totals = Map.fromListWith combine
      [ (mprUsername player, (if mrWinner match == mprUsername player then 1 else 0, mprKills player))
      | match <- history
      , player <- mrPlayers match
      ]
    combine (winsA, killsA) (winsB, killsB) = (winsA + winsB, killsA + killsB)
