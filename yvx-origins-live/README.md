# YVX Origins Inventory

Vercel-ready Next.js app for the YVX × Origins live inventory tracker.

## Authentication

The app does **not** depend on a short-lived browser access token.

It uses StackKnack's `/api/auth/refresh` flow:

1. `STACKKNACK_REFRESH_TOKEN` is used only as the bootstrap credential.
2. The server receives a new StackKnack access token and a rotated refresh token.
3. The latest tokens are stored server-side in Upstash Redis.
4. GraphQL requests use the current access token.
5. If StackKnack reports an authentication error, the server refreshes once and retries.

No StackKnack token is sent to the browser.

## Vercel environment variables

Set these in Project Settings → Environment Variables:

- `STACKKNACK_GRAPHQL_URL` = `https://originsnyc.stackknack.com/graphql`
- `STACKKNACK_ORG_ID` = `9f41d723-7cfe-4530-8812-f1aa1c657fc5`
- `STACKKNACK_REFRESH_TOKEN` = a current StackKnack refresh token (secret; never commit it)

Provision **Upstash Redis** from the Vercel Marketplace and connect it to this project. Vercel should inject:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Because StackKnack returns a new refresh token during refresh, persistent storage is required. A Vercel environment variable alone is not enough for ongoing rotation.

## Inventory behavior

- Fetches 100 inventory records per GraphQL page and follows cursor pagination.
- Filters to product brand `YVX` server-side after retrieval.
- Keeps the raw StackKnack status and adds a conservative state classification (`on_hand`, `reserved`, `sold`, `inactive`).
- Returns status and warehouse counts so we can verify the real StackKnack status vocabulary after the first live deployment.
- Uses product + variant/size + warehouse data for the dashboard and restock logic.

The integration is read-only. It does not include StackKnack mutations.
