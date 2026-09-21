# YVX Origins Inventory

Vercel-ready Next.js app for the YVX × Origins live inventory tracker.

## Vercel environment variables

Set these in Project Settings → Environment Variables:

- `STACKKNACK_GRAPHQL_URL` = `https://originsnyc.stackknack.com/graphql`
- `STACKKNACK_ORG_ID` = `9f41d723-7cfe-4530-8812-f1aa1c657fc5`
- `STACKKNACK_BEARER_TOKEN` = the StackKnack bearer token (secret; never commit it)

The app fetches up to 100 inventory records per GraphQL page, follows cursor pagination, filters to brand `YVX`, and builds product/size/location/restock summaries in the dashboard.
