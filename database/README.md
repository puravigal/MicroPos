# Database

schema.sql is the current PostgreSQL domain schema.

## Production migration rule
Never edit a live database by hand. Every schema change must become a versioned migration before release.

## Financial integrity
- Use PostgreSQL transactions for sale/payment/stock operations.
- Use NUMERIC, never floating point, for monetary values.
- Use idempotency keys for retryable financial commands.
- Keep historical tax/pricing/buyer/seller snapshots on issued invoices.
- Do not hard-delete financial records.

## Tenant isolation
Every organization-owned table carries organization_id. API queries must scope every read/write to the authenticated organization. Cross-tenant IDs must not leak existence.
