{-# LANGUAGE OverloadedStrings #-}
-- | Parser combinator cho cấu hình khởi động server.
--   Hỗ trợ cả URI MongoDB đầy đủ và dạng host:port/database ngắn gọn.
module Common.CommandParser
  ( MongoEndpoint(..)
  , ServerOptions(..)
  , parseServerOptions
  ) where

import Data.Bifunctor (first)
import Control.Applicative (empty)
import Data.List (foldl')
import Data.Text (Text, pack)
import Data.Void (Void)
import Text.Megaparsec (Parsec, eof, errorBundlePretty, many, optional, runParser, some, try, (<|>))
import Text.Megaparsec.Char (alphaNumChar, char, space1, string)
import qualified Text.Megaparsec.Char.Lexer as L

data MongoEndpoint = MongoEndpoint
  { meHost :: !String
  , mePort :: !Int
  , meDatabase :: !Text
  } deriving (Show, Eq)

data ServerOptions = ServerOptions
  { soPort :: !(Maybe Int)
  , soMongo :: !(Maybe MongoEndpoint)
  } deriving (Show, Eq)

data RawOption
  = RawPort !Int
  | RawMongo !MongoEndpoint

type Parser = Parsec Void String

-- | Parse command-line options and preserve source locations in error messages.
parseServerOptions :: [String] -> Either String ServerOptions
parseServerOptions args = do
  raw <- first errorBundlePretty $
    runParser (spaceConsumer *> many (optionParser <* spaceConsumer) <* eof)
      "tham số khởi động" (unwords args)
  foldl' addOption (Right (ServerOptions Nothing Nothing)) raw
  where
    addOption :: Either String ServerOptions -> RawOption -> Either String ServerOptions
    addOption previous option = do
      options <- previous
      case option of
        RawPort port
          | soPort options /= Nothing -> Left "--port chỉ được khai báo một lần."
          | otherwise -> Right options { soPort = Just port }
        RawMongo endpoint
          | soMongo options /= Nothing -> Left "--mongo-uri chỉ được khai báo một lần."
          | otherwise -> Right options { soMongo = Just endpoint }

spaceConsumer :: Parser ()
spaceConsumer = L.space space1 empty empty

lexeme :: Parser a -> Parser a
lexeme = L.lexeme spaceConsumer

symbol :: String -> Parser String
symbol = L.symbol spaceConsumer

optionParser :: Parser RawOption
optionParser = try portOption <|> mongoOption

portOption :: Parser RawOption
portOption = do
  _ <- symbol "--port"
  port <- lexeme L.decimal
  if port >= (1 :: Int) && port <= 65535
    then pure (RawPort port)
    else fail "cổng phải nằm trong khoảng 1 đến 65535"

mongoOption :: Parser RawOption
mongoOption = RawMongo <$> (symbol "--mongo-uri" *> mongoEndpointParser)

mongoEndpointParser :: Parser MongoEndpoint
mongoEndpointParser = do
  _ <- optional (try (string "mongodb://"))
  host <- some (alphaNumChar <|> char '.' <|> char '-')
  port <- optional (char ':' *> L.decimal)
  database <- optional (char '/' *> some (alphaNumChar <|> char '_' <|> char '-'))
  pure MongoEndpoint
    { meHost = host
    , mePort = maybe 27017 id port
    , meDatabase = pack (maybe "TankWar" id database)
    }
