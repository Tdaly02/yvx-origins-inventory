const GRAPHQL_URL = process.env.STACKKNACK_GRAPHQL_URL || "https://originsnyc.stackknack.com/graphql";
const STACKKNACK_ORIGIN = new URL(GRAPHQL_URL).origin;
const REFRESH_URL = process.env.STACKKNACK_REFRESH_URL || `${STACKKNACK_ORIGIN}/api/auth/refresh`;
const ORG_ID = process.env.STACKKNACK_ORG_ID || "9f41d723-7cfe-4530-8812-f1aa1c657fc5";

const INITIAL_REFRESH_TOKEN = process.env.STACKKNACK_REFRESH_TOKEN;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const REFRESH_TOKEN_KEY = "yvx:stackknack:refresh-token";
const ACCESS_TOKEN_KEY = "yvx:stackknack:access-token";
const REFRESH_LOCK_KEY = "yvx:stackknack:refresh-lock";

const QUERY = `
query GetAllInventories($orgId: UUID!, $page: PageInput!, $filter: InventoryFilter, $sort: InventorySort) {
  inventories(orgId: $orgId, page: $page, filter: $filter, sort: $sort) {
    edges {
      node {
        id
        sku
        status
        days
        soldAt
        createdAt
        updatedAt
        warehouse { id name }
        subLocation { id name warehouse { id name } }
        previousLocation { name }
        soldPrice { amount currencyCode }
        sellPrice { amount currencyCode }
        variant { id title }
        product {
          id
          name
          images
          category { name id }
          brand { id name }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type Money = { amount?: string | number | null; currencyCode?: string | null } | null;
type RawItem = {
  id: string;
  sku?: string | null;
  status?: string | null;
  days?: number | null;
  soldAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  warehouse?: { id?: string | null; name?: string | null } | null;
  subLocation?: { id?: string | null; name?: string | null; warehouse?: { id?: string | null; name?: string | null } | null } | null;
  previousLocation?: { name?: string | null } | null;
  soldPrice?: Money;
  sellPrice?: Money;
  variant?: { id?: string | null; title?: string | null } | null;
  product?: {
    id?: string | null;
    name?: string | null;
    images?: string[] | null;
    category?: { id?: string | null; name?: string | null } | null;
    brand?: { id?: string | null; name?: string | null } | null;
  } | null;
};

type RefreshResponse = {
  accessToken?: string;
  refreshToken?: string;
};

type RedisResponse<T> = {
  result?: T;
  error?: string;
};

async function redisCommand<T = unknown>(...command: string[]): Promise<T | null> {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Upstash Redis is not configured. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.");
  }

  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as RedisResponse<T> | null;
  if (!response.ok || body?.error) {
    throw new Error(body?.error || `Token store returned ${response.status}`);
  }
  return body?.result ?? null;
}

function accessTokenExpiresSoon(token: string, bufferSeconds = 60) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    if (!decoded.exp) return true;
    return decoded.exp <= Math.floor(Date.now() / 1000) + bufferSeconds;
  } catch {
    return true;
  }
}

function tokenTtlSeconds(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 300;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    if (!decoded.exp) return 300;
    return Math.max(30, decoded.exp - Math.floor(Date.now() / 1000) - 30);
  } catch {
    return 300;
  }
}

async function getStoredRefreshToken() {
  const stored = await redisCommand<string>("GET", REFRESH_TOKEN_KEY);
  if (stored) return stored;
  if (!INITIAL_REFRESH_TOKEN) {
    throw new Error("STACKKNACK_REFRESH_TOKEN is not configured");
  }
  return INITIAL_REFRESH_TOKEN;
}

async function releaseRefreshLock(lockId: string) {
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await redisCommand("EVAL", script, "1", REFRESH_LOCK_KEY, lockId).catch(() => null);
}

async function refreshAccessToken() {
  const refreshToken = await getStoredRefreshToken();
  const response = await fetch(REFRESH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "refresh-token": refreshToken,
    },
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as RefreshResponse | null;
  if (!response.ok || !body?.accessToken || !body?.refreshToken) {
    throw new Error(`StackKnack refresh failed (${response.status})`);
  }

  await redisCommand("SET", REFRESH_TOKEN_KEY, body.refreshToken);
  await redisCommand("SET", ACCESS_TOKEN_KEY, body.accessToken, "EX", String(tokenTtlSeconds(body.accessToken)));
  return body.accessToken;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const cached = await redisCommand<string>("GET", ACCESS_TOKEN_KEY);
    if (cached && !accessTokenExpiresSoon(cached)) return cached;
  }

  const lockId = crypto.randomUUID();
  const lock = await redisCommand<string>("SET", REFRESH_LOCK_KEY, lockId, "EX", "15", "NX");

  if (lock === "OK") {
    try {
      if (!forceRefresh) {
        const cached = await redisCommand<string>("GET", ACCESS_TOKEN_KEY);
        if (cached && !accessTokenExpiresSoon(cached)) return cached;
      }
      return await refreshAccessToken();
    } finally {
      await releaseRefreshLock(lockId);
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cached = await redisCommand<string>("GET", ACCESS_TOKEN_KEY);
    if (cached && !accessTokenExpiresSoon(cached)) return cached;
  }

  throw new Error("Timed out waiting for StackKnack token refresh");
}

function isAuthError(body: unknown) {
  if (!body || typeof body !== "object") return false;
  const maybe = body as { errors?: Array<{ message?: string }> };
  return maybe.errors?.some((error) => /access is denied|unauthoriz|invalid token|expired/i.test(error.message || "")) ?? false;
}

async function graphqlPage(after: string | null, retry = true) {
  const accessToken = await getAccessToken();
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      operationName: "GetAllInventories",
      query: QUERY,
      variables: {
        orgId: ORG_ID,
        page: { limit: 100, before: null, after },
        filter: {},
        sort: { sortOn: "UPDATED_AT", sortDirection: "DESC" },
      },
    }),
    cache: "no-store",
  });

  const body = await response.json().catch(() => null);
  if (retry && (response.status === 401 || response.status === 403 || isAuthError(body))) {
    await getAccessToken(true);
    return graphqlPage(after, false);
  }

  if (!response.ok) throw new Error(`StackKnack returned ${response.status}`);
  if (body?.errors?.length) throw new Error(body.errors[0]?.message || "StackKnack GraphQL error");
  return body.data.inventories as {
    edges: Array<{ node: RawItem }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

function amount(money?: Money) {
  if (money?.amount === null || money?.amount === undefined || money?.amount === "") return 0;
  const n = Number(money.amount);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(status?: string | null) {
  return (status || "UNKNOWN").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export type InventoryState = "sold" | "reserved" | "inactive" | "on_hand";

function classifyInventory(status?: string | null, soldAt?: string | null): InventoryState {
  const normalized = normalizeStatus(status);
  if (soldAt || normalized.includes("SOLD")) return "sold";
  if (normalized.includes("RESERV") || normalized.includes("HOLD")) return "reserved";
  if (["RETURN", "REMOV", "DELETE", "CANCEL", "VOID", "LOST"].some((part) => normalized.includes(part))) return "inactive";
  return "on_hand";
}

export type InventoryRow = {
  id: string;
  sku: string;
  productId: string;
  product: string;
  size: string;
  status: string;
  state: InventoryState;
  warehouse: string;
  subLocation: string;
  sellPrice: number;
  soldPrice: number;
  soldAt: string | null;
  updatedAt: string | null;
  days: number | null;
};

export type InventoryResult = {
  rows: InventoryRow[];
  statusCounts: Record<string, number>;
  warehouseCounts: Record<string, number>;
};

export async function fetchYvxInventory(): Promise<InventoryResult> {
  const all: RawItem[] = [];
  let after: string | null = null;
  let pages = 0;

  do {
    const result = await graphqlPage(after);
    all.push(...result.edges.map((edge) => edge.node));
    after = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
    pages += 1;
    if (pages >= 100) throw new Error("Pagination safety limit reached");
  } while (after);

  const rows = all
    .filter((item) => (item.product?.brand?.name || "").trim().toLowerCase() === "yvx")
    .map((item) => {
      const status = normalizeStatus(item.status);
      return {
        id: item.id,
        sku: item.sku || "",
        productId: item.product?.id || "unknown",
        product: item.product?.name || "Unnamed YVX product",
        size: item.variant?.title || "One Size",
        status,
        state: classifyInventory(status, item.soldAt),
        warehouse: item.warehouse?.name || item.subLocation?.warehouse?.name || "Unknown",
        subLocation: item.subLocation?.name || "",
        sellPrice: amount(item.sellPrice),
        soldPrice: amount(item.soldPrice),
        soldAt: item.soldAt || null,
        updatedAt: item.updatedAt || null,
        days: item.days ?? null,
      } satisfies InventoryRow;
    });

  const statusCounts: Record<string, number> = {};
  const warehouseCounts: Record<string, number> = {};
  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    warehouseCounts[row.warehouse] = (warehouseCounts[row.warehouse] || 0) + 1;
  }

  return { rows, statusCounts, warehouseCounts };
}
