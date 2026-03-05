# Watchlist Lambda Deployment

## Files

- `lambda/watchlist/index.mjs`

## Runtime

- Node.js 20.x

## Environment variables

- `WATCHLIST_TABLE=anavai_recent_searches`

## Required IAM actions on the table

- `dynamodb:PutItem`
- `dynamodb:Query`
- `dynamodb:DeleteItem`

## DynamoDB schema

- Table: `anavai_recent_searches`
- Partition key: `userId` (String)
- Sort key: `searchedAt` (Number)

## API Gateway routes

- `GET /watchlist` -> Lambda `handler`
- `POST /watchlist` -> Lambda `handler`
- `OPTIONS /watchlist` (or enable CORS in API Gateway)

## Request examples

### POST

```json
{
  "userId": "default-user",
  "symbol": "RELIANCE"
}
```

### GET

`/watchlist?userId=default-user`

Response:

```json
{
  "symbols": ["RELIANCE", "TCS", "INFY"]
}
```
