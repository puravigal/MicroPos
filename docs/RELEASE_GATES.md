# Friday Internal Launch — Release Gates

The internal launch target does not lower the quality bar.

## Must work before internal launch
1. App loads reliably on the deployed URL.
2. Mobile, tablet and desktop layouts render.
3. Product creation/edit/delete/search works.
4. Customer and supplier creation/search works.
5. Billing handles cart, quantity, discount, tax, total, payment and sale creation.
6. Stock reduces exactly once after a sale.
7. Returns/refunds create traceable reversal records and never rewrite the original invoice.
8. Invoice numbering is unique within organization/store.
9. Role/permission checks exist on protected API operations.
10. Tenant isolation is tested.
11. Database constraints and transactions protect financial operations.
12. API validation returns structured safe errors.
13. Auth sessions expire/revoke correctly.
14. Sensitive mutations create audit records.
15. Import validation cannot partially corrupt data.
16. Delivery failures are retryable without duplicating the sale.
17. Backup/restore is tested in staging.
18. Browser/mobile regression suite passes.

## External dependencies requiring real credentials/accounts
- Google/LinkedIn OAuth
- WhatsApp Business/Cloud API
- SMS provider
- Email provider
- Payment gateway/acquirer
- India GST/e-invoice/GSP credentials where applicable
- UAE Accredited Service Provider / Peppol access
- Production PostgreSQL/cloud infrastructure
- Production secrets, domains, monitoring and backup storage

Provider adapters and safe test doubles should make the core POS testable without these credentials.

## Never acceptable
- fake paid status for a real payment
- compliance claims without validation
- tax logic hard-coded inside UI
- deleting issued invoices
- cross-tenant access
- trusting client-side totals
- treating PDF as UAE eInvoice
