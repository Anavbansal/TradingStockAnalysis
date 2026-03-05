# AnavAI Copilot Tools Gateway

MCP + Actions gateway for InstiLibreChat. It validates JWT, maps tool calls to existing Lambda APIs, and enforces confirmation-first GTT creation.

## Run

```bash
cd copilot-tools
npm install
npm run dev
```

## Endpoints

- `POST /mcp` - MCP streamable-http JSON-RPC entrypoint.
- `GET /openapi.json` - OpenAPI schema for Actions fallback.
- `POST /gtt/create` - Direct action endpoint.
- `GET /health` - Health check.

## Required env

- `ANGEL_URL` e.g. `https://.../AnavAngleone`
- `FYERS_URL` e.g. `https://.../analyze`
- JWT verification:
  - Either `JWT_JWKS_URL`, or
  - `JWT_HS256_SECRET`
- `JWT_ISSUER`
- `JWT_AUDIENCE`

## Implemented Tools

- `angel_get_holdings`
- `angel_get_option_greeks`
- `fyers_get_technical_snapshot`
- `angel_create_gtt_order` (requires `confirm=true`)
