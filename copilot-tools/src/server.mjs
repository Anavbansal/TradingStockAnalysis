import crypto from "node:crypto";
import express from "express";
import pino from "pino";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8787);
const ANGEL_URL = process.env.ANGEL_URL || "";
const FYERS_URL = process.env.FYERS_URL || "";
const JWT_ISSUER = process.env.JWT_ISSUER || "anavai-copilot";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "instilibrechat";
const JWT_JWKS_URL = process.env.JWT_JWKS_URL || "";
const JWT_HS256_SECRET = process.env.JWT_HS256_SECRET || "";
const MAX_TOOL_CALLS_PER_MIN = Math.max(10, Number(process.env.MAX_TOOL_CALLS_PER_MIN || 120));

if (!ANGEL_URL || !FYERS_URL) {
  logger.warn("ANGEL_URL or FYERS_URL missing; tool calls will fail until configured.");
}

const jwks = JWT_JWKS_URL ? createRemoteJWKSet(new URL(JWT_JWKS_URL)) : null;
const callsByUser = new Map();

const symbolRegex = /^[A-Z0-9:.-]{2,40}$/;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const expiryRegex = /^\d{2}[A-Z]{3}\d{4}$/;

const technicalSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(symbolRegex),
  resolution: z.string().trim().default("5"),
  range_from: z.string().trim().optional(),
  range_to: z.string().trim().optional()
});

const greeksSchema = z.object({
  name: z.string().trim().toUpperCase().regex(symbolRegex),
  expirydate: z.string().trim().toUpperCase().regex(expiryRegex)
});

const gttSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(symbolRegex),
  side: z.enum(["BUY", "SELL"]),
  triggerPrice: z.number().positive(),
  quantity: z.number().int().positive().max(5000).default(1),
  targetPrice: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  notes: z.string().max(200).optional(),
  confirm: z.boolean().default(false)
});

function mcpText(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload)
      }
    ]
  };
}

function mcpError(message, code = -32000) {
  return {
    error: { code, message }
  };
}

function getAuthToken(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.toLowerCase().startsWith("bearer ")) {
    throw new Error("Missing Bearer token");
  }
  return auth.slice(7).trim();
}

async function verifyToken(req) {
  const token = getAuthToken(req);
  if (jwks) {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
    return payload;
  }
  if (!JWT_HS256_SECRET) {
    throw new Error("No JWT verification method configured");
  }
  const { payload } = await jwtVerify(token, new TextEncoder().encode(JWT_HS256_SECRET), {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });
  return payload;
}

function enforceRateLimit(userId) {
  const now = Date.now();
  const current = callsByUser.get(userId) || { count: 0, windowStart: now };
  if (now - current.windowStart > 60_000) {
    current.count = 0;
    current.windowStart = now;
  }
  current.count += 1;
  callsByUser.set(userId, current);
  if (current.count > MAX_TOOL_CALLS_PER_MIN) {
    throw new Error("Rate limit exceeded for tool calls");
  }
}

function sanitizeArgsHash(args) {
  return crypto.createHash("sha256").update(JSON.stringify(args || {})).digest("hex");
}

function assertDateRange(args) {
  if (args.range_from && !isoDateRegex.test(args.range_from)) {
    throw new Error("range_from must be YYYY-MM-DD");
  }
  if (args.range_to && !isoDateRegex.test(args.range_to)) {
    throw new Error("range_to must be YYYY-MM-DD");
  }
}

async function callJson(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || payload?.message || `Upstream request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

const tools = {
  angel_get_holdings: {
    description: "Fetch holdings for the authenticated user from Angel endpoint.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    run: async (_args, auth) => {
      const userId = String(auth.sub || "");
      const url = `${ANGEL_URL}?action=holdings&userId=${encodeURIComponent(userId)}`;
      const payload = await callJson(url);
      return mcpText({ ok: Boolean(payload.ok), holdings: payload.holdings || [] });
    }
  },
  angel_get_option_greeks: {
    description: "Fetch Angel option greeks by underlying name and expiry.",
    inputSchema: {
      type: "object",
      required: ["name", "expirydate"],
      properties: {
        name: { type: "string" },
        expirydate: { type: "string", pattern: "^\\d{2}[A-Z]{3}\\d{4}$" }
      },
      additionalProperties: false
    },
    run: async (args, auth) => {
      const input = greeksSchema.parse(args || {});
      const payload = await callJson(ANGEL_URL, {
        method: "POST",
        body: {
          action: "optionGreek",
          userId: String(auth.sub || ""),
          name: input.name,
          expirydate: input.expirydate
        }
      });
      return mcpText(payload);
    }
  },
  fyers_get_technical_snapshot: {
    description: "Fetch Fyers technical payload via analyze mode=tech.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string" },
        resolution: { type: "string", default: "5" },
        range_from: { type: "string" },
        range_to: { type: "string" }
      },
      additionalProperties: false
    },
    run: async (args) => {
      const input = technicalSchema.parse(args || {});
      assertDateRange(input);
      const payload = await callJson(FYERS_URL, {
        method: "POST",
        body: {
          mode: "tech",
          symbol: input.symbol,
          symbolName: input.symbol,
          resolution: input.resolution,
          ...(input.range_from ? { range_from: input.range_from } : {}),
          ...(input.range_to ? { range_to: input.range_to } : {})
        }
      });
      return mcpText(payload);
    }
  },
  angel_create_gtt_order: {
    description: "Create a GTT order. Requires confirm=true to execute.",
    inputSchema: {
      type: "object",
      required: ["symbol", "side", "triggerPrice"],
      properties: {
        symbol: { type: "string" },
        side: { type: "string", enum: ["BUY", "SELL"] },
        triggerPrice: { type: "number" },
        quantity: { type: "integer", minimum: 1, maximum: 5000, default: 1 },
        targetPrice: { type: "number" },
        stopLoss: { type: "number" },
        notes: { type: "string", maxLength: 200 },
        confirm: { type: "boolean", default: false }
      },
      additionalProperties: false
    },
    run: async (args, auth) => {
      const input = gttSchema.parse(args || {});
      if (!input.confirm) {
        return mcpText({
          requiresConfirmation: true,
          preview: {
            symbol: input.symbol,
            side: input.side,
            triggerPrice: input.triggerPrice,
            quantity: input.quantity
          },
          message: "Re-run with confirm=true to place this GTT order."
        });
      }
      const payload = await callJson(ANGEL_URL, {
        method: "POST",
        body: {
          action: "gtt_create",
          userId: String(auth.sub || ""),
          symbol: input.symbol,
          side: input.side,
          triggerPrice: input.triggerPrice,
          quantity: input.quantity,
          targetPrice: input.targetPrice,
          stopLoss: input.stopLoss,
          notes: input.notes
        }
      });
      return mcpText(payload);
    }
  }
};

function listToolsPayload() {
  return Object.entries(tools).map(([name, meta]) => ({
    name,
    description: meta.description,
    inputSchema: meta.inputSchema
  }));
}

async function dispatchMcpCall(message, req) {
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = hasId ? message.id : null;
  const method = String(message?.method || "");
  const params = message?.params || {};

  if (!hasId) {
    return null;
  }

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "anavai-copilot-tools", version: "1.0.0" }
        }
      };
    }

    if (method === "notifications/initialized") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: listToolsPayload() } };
    }

    if (method === "tools/call") {
      const auth = await verifyToken(req);
      const userId = String(auth.sub || "").trim();
      if (!userId) {
        throw new Error("JWT sub claim is required");
      }
      enforceRateLimit(userId);

      const toolName = String(params?.name || "").trim();
      const args = params?.arguments || {};
      const tool = tools[toolName];
      if (!tool) {
        return { jsonrpc: "2.0", id, ...mcpError(`Unknown tool: ${toolName}`, -32602) };
      }

      logger.info({
        event: "tool_call",
        userId,
        toolName,
        argsHash: sanitizeArgsHash(args),
        ts: Date.now()
      });

      const result = await tool.run(args, auth);
      return { jsonrpc: "2.0", id, result };
    }

    return { jsonrpc: "2.0", id, ...mcpError(`Unsupported method: ${method}`, -32601) };
  } catch (error) {
    return { jsonrpc: "2.0", id, ...mcpError(error.message || "Unhandled MCP error") };
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "anavai-copilot-tools", now: Date.now() });
});

app.get("/openapi.json", (_req, res) => {
  res.json({
    openapi: "3.0.3",
    info: { title: "Trading Copilot API", version: "1.0.0" },
    servers: [{ url: "/copilot-tools" }],
    paths: {
      "/gtt/create": {
        post: {
          operationId: "createGtt",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: tools.angel_create_gtt_order.inputSchema
              }
            }
          },
          responses: {
            200: { description: "GTT response" }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
      }
    }
  });
});

app.post("/gtt/create", async (req, res) => {
  try {
    const auth = await verifyToken(req);
    const userId = String(auth.sub || "").trim();
    if (!userId) {
      res.status(401).json({ error: "JWT sub claim is required" });
      return;
    }
    const input = gttSchema.parse(req.body || {});
    if (!input.confirm) {
      res.json({
        requiresConfirmation: true,
        preview: {
          symbol: input.symbol,
          side: input.side,
          triggerPrice: input.triggerPrice,
          quantity: input.quantity
        }
      });
      return;
    }
    const payload = await callJson(ANGEL_URL, {
      method: "POST",
      body: {
        action: "gtt_create",
        userId,
        symbol: input.symbol,
        side: input.side,
        triggerPrice: input.triggerPrice,
        quantity: input.quantity,
        targetPrice: input.targetPrice,
        stopLoss: input.stopLoss,
        notes: input.notes
      }
    });
    res.json(payload);
  } catch (error) {
    res.status(400).json({ error: error.message || "Invalid request" });
  }
});

app.post("/mcp", async (req, res) => {
  const incoming = req.body;
  if (Array.isArray(incoming)) {
    const responses = [];
    for (const item of incoming) {
      const out = await dispatchMcpCall(item, req);
      if (out) {
        responses.push(out);
      }
    }
    res.json(responses);
    return;
  }

  const out = await dispatchMcpCall(incoming || {}, req);
  if (!out) {
    res.status(204).send();
    return;
  }
  res.json(out);
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, "Copilot tools server started");
});
