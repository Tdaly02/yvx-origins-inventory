const ENDPOINT = process.env.STACKKNACK_GRAPHQL_URL || "https://originsnyc.stackknack.com/graphql";
const ORG_ID = process.env.STACKKNACK_ORG_ID || "9f41d723-7cfe-4530-8812-f1aa1c657fc5";
const TOKEN = process.env.STACKKNACK_BEARER_TOKEN;

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
        costPrice { amount currencyCode }
        soldPrice { amount currencyCode }
        sellPrice { amount currencyCode }
        discountAmount { amount currencyCode }
        profitAmount { amount currencyCode }
        variant { id title compareAtPrice { amount currencyCode } }
        product {
          id
          name
          description
          images
          category { name id }
          brand { id name }
          condition { displayValue value }
          subCondition { displayValue value }
        }
      }
    }
    pageInfo { hasPreviousPage hasNextPage startCursor endCursor }
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
  costPrice?: Money;
  soldPrice?: Money;
  sellPrice?: Money;
  discountAmount?: Money;
  profitAmount?: Money;
  variant?: { id?: string | null; title?: string | null; compareAtPrice?: Money } | null;
  product?: {
    id?: string | null;
    name?: string | null;
    description?: string | null;
    images?: string[] | null;
    category?: { id?: string | null; name?: string | null } | null;
    brand?: { id?: string | null; name?: string | null } | null;
  } | null;
};

async function page(after: string | null) {
  if (!TOKEN) throw new Error("STACKKNACK_BEARER_TOKEN is not configured");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
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

  if (!response.ok) throw new Error(`StackKnack returned ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0]?.message || "StackKnack GraphQL error");
  return body.data.inventories as {
    edges: Array<{ node: RawItem }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

function amount(money?: Money) {
  if (!money?.amount) return 0;
  const n = Number(money.amount);
  return Number.isFinite(n) ? n : 0;
}

export type InventoryRow = {
  id: string;
  sku: string;
  productId: string;
  product: string;
  size: string;
  status: string;
  warehouse: string;
  subLocation: string;
  sellPrice: number;
  soldPrice: number;
  costPrice: number;
  profit: number;
  soldAt: string | null;
  updatedAt: string | null;
  days: number | null;
};

export async function fetchYvxInventory(): Promise<InventoryRow[]> {
  const all: RawItem[] = [];
  let after: string | null = null;
  let pages = 0;
  do {
    const result = await page(after);
    all.push(...result.edges.map((edge) => edge.node));
    after = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
    pages += 1;
    if (pages >= 100) throw new Error("Pagination safety limit reached");
  } while (after);

  return all
    .filter((item) => (item.product?.brand?.name || "").trim().toLowerCase() === "yvx")
    .map((item) => ({
      id: item.id,
      sku: item.sku || "",
      productId: item.product?.id || "unknown",
      product: item.product?.name || "Unnamed YVX product",
      size: item.variant?.title || "One Size",
      status: item.status || "UNKNOWN",
      warehouse: item.warehouse?.name || item.subLocation?.warehouse?.name || "Unknown",
      subLocation: item.subLocation?.name || "",
      sellPrice: amount(item.sellPrice),
      soldPrice: amount(item.soldPrice),
      costPrice: amount(item.costPrice),
      profit: amount(item.profitAmount),
      soldAt: item.soldAt || null,
      updatedAt: item.updatedAt || null,
      days: item.days ?? null,
    }));
}
