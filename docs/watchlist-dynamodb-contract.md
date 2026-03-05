# Recent Watchlist DynamoDB Contract

Frontend now calls:

- `GET /prod/watchlist?userId=<user-id>`
- `POST /prod/watchlist`

## Request/Response

### GET `/prod/watchlist?userId=default-user`

Response:

```json
{
  "symbols": ["RELIANCE", "TCS", "INFY"]
}
```

### POST `/prod/watchlist`

Request:

```json
{
  "userId": "default-user",
  "symbol": "RELIANCE"
}
```

Response:

```json
{
  "ok": true
}
```

## DynamoDB table suggestion

- Table name: `anavai_recent_searches`
- Partition key: `userId` (String)
- Sort key: `searchedAt` (Number, epoch millis)
- Attribute: `symbol` (String)

## Write logic

1. Insert new item with current `searchedAt`.
2. Query latest 20 items by `userId` descending.
3. De-duplicate symbol by keeping newest.
4. Delete overflow/older duplicates so only latest 20 unique symbols remain.

## Read logic

1. Query latest items for `userId`.
2. Return newest 20 unique symbols as `symbols[]`.
