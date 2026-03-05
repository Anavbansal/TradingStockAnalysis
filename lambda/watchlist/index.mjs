import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.WATCHLIST_TABLE;
const REGION = process.env.AWS_REGION || 'ap-south-1';
const MAX_SYMBOLS = 20;
const QUERY_SCAN_LIMIT = 200;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function response(statusCode, body = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'OPTIONS,GET,POST'
    },
    body: JSON.stringify(body)
  };
}

function methodOf(event) {
  return event?.requestContext?.http?.method || event?.httpMethod || 'GET';
}

function normalizeSymbol(input) {
  return String(input || '')
    .trim()
    .toUpperCase();
}

function normalizeUserId(input) {
  const cleaned = String(input || '').trim();
  return cleaned || 'default-user';
}

async function loadRecentItems(userId) {
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: {
        ':uid': userId
      },
      ScanIndexForward: false,
      Limit: QUERY_SCAN_LIMIT
    })
  );

  return out.Items || [];
}

function latestUniqueSymbols(items) {
  const seen = new Set();
  const symbols = [];

  for (const item of items) {
    const symbol = normalizeSymbol(item.symbol);
    if (!symbol || seen.has(symbol)) {
      continue;
    }

    seen.add(symbol);
    symbols.push(symbol);
    if (symbols.length >= MAX_SYMBOLS) {
      break;
    }
  }

  return symbols;
}

async function pruneOverflow(items) {
  const seen = new Set();
  const toDelete = [];

  for (const item of items) {
    const symbol = normalizeSymbol(item.symbol);
    const alreadySeen = seen.has(symbol);
    const overLimit = seen.size >= MAX_SYMBOLS;

    if (!symbol || alreadySeen || overLimit) {
      toDelete.push(item);
      continue;
    }

    seen.add(symbol);
  }

  for (const item of toDelete) {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          userId: item.userId,
          searchedAt: item.searchedAt
        }
      })
    );
  }
}

async function handleGet(event) {
  const userId = normalizeUserId(event?.queryStringParameters?.userId);
  const items = await loadRecentItems(userId);
  const symbols = latestUniqueSymbols(items);
  return response(200, { symbols });
}

async function handlePost(event) {
  let parsedBody = {};
  try {
    parsedBody = event?.body ? JSON.parse(event.body) : {};
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }

  const userId = normalizeUserId(parsedBody.userId);
  const symbol = normalizeSymbol(parsedBody.symbol);

  if (!symbol) {
    return response(400, { error: 'symbol is required' });
  }

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        userId,
        searchedAt: Date.now(),
        symbol
      }
    })
  );

  const items = await loadRecentItems(userId);
  await pruneOverflow(items);

  return response(200, { ok: true });
}

export const handler = async (event) => {
  if (!TABLE_NAME) {
    return response(500, { error: 'WATCHLIST_TABLE env var is missing' });
  }

  const method = methodOf(event);

  try {
    if (method === 'OPTIONS') {
      return response(204, {});
    }
    if (method === 'GET') {
      return await handleGet(event);
    }
    if (method === 'POST') {
      return await handlePost(event);
    }

    return response(405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('Watchlist lambda error', error);
    return response(500, { error: 'Internal server error' });
  }
};
