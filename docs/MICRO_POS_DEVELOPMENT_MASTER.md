# Puravigal POS — Master Development Specification

## Product principle
**Scope = Micro. Quality = Professional.** Mobile-first React web/PWA foundation, API/domain architecture ready for future React Native Android/iOS clients. India-first, globally extensible.

## Reference captured before reset
The retired static site was analyzed only for brand/visual reference: Puravigal logo/icon variants, blue/pink visual direction, gradient language, typography/layout inspiration and existing OG/favicon assets. Provisional observed colors: Primary #235BDE, Accent #E60063. Final supplied brand assets override these. Old HTML/CSS/JS/Sass implementation is retired and must not be reused as application architecture.

## End-to-end flow
Sign up/Login → Business setup → Country/region → Currency/tax/locale → Organization → Owner/Admin → Users/Roles → Dashboard → Products/Inventory/Purchases/Customers/Suppliers → Billing → Payment → Invoice → Print/Share/WhatsApp/Email/SMS → Reports/Analytics.

## Core modules
Authentication; business onboarding; organization/stores; users/roles/permissions; products/categories; customers; suppliers; billing/cart/sales; payments; tax engine; invoices; invoice delivery; inventory/stock movements; purchases; purchase returns; sales returns/refunds; dashboard/reports; import/export; plans/entitlements; notifications; audit; settings; security and tenant isolation.

## Architecture
React + Vite mobile-first frontend → API → Auth/Authorization → Domain services → Tax/Localization/Entitlement engines → PostgreSQL. Frontend layering: UI → hooks/state → domain/services → API. Future React Native clients use the same API/domain contracts.

## UI/UX contract
Every screen must handle normal, loading, empty, validation error, server error, permission denied, network failure, success, confirmation, unsaved changes, duplicate/conflict, session expiry and large-data states. Touch-first controls, readable typography, minimal typing, fast search, safe destructive actions and one-hand-friendly layouts are mandatory. Phone is primary; tablet supported; desktop secondary.

## Business/data rules
Strict tenant isolation; foreign keys/indexes; transactional consistency; precise money arithmetic; currency code with monetary context; historical invoice/tax/pricing context preserved; inventory changes represented by traceable stock movements; important mutations audited; unique invoice/reference numbers; idempotency for retryable financial operations; no silent data loss.

## Tax/localization
Tax is an effective-date and jurisdiction-aware engine, never hard-coded into billing. India is first implementation target. Country adapters keep core globally extensible. Compliance is not claimed until implemented and tested.

## Roles
Initial roles: Owner/Admin, Manager, Cashier, Inventory Staff. Permissions cover billing, products, inventory, purchases, customers, suppliers, reports, settings and users.

## Billing
Product → cart → discount → tax → total → payment → invoice → inventory update → customer history → reporting. Full/partial payment, payment status, configured payment methods, refunds and transaction history.

## Inventory
Opening stock → purchases/adjustments → current stock → sale → reduction. Every movement stores item, quantity, time, reason, user and reference. Low-stock/out-of-stock and stock history.

## Returns
Sale → full/partial return → refund/credit outcome → inventory adjustment → customer history → reporting. Preserve original sale reference and reason.

## Import/export
CSV/Excel: Upload → detect columns → map → validate → preview → confirm → import → result/errors. Export products, customers, suppliers, sales, purchases, inventory and applicable reports.

## Invoice delivery
Invoice → print / WhatsApp / email / SMS / secure share link. Delivery failures are visible and retryable without duplicating the financial transaction.

## Security
HTTPS; password hashing; secure sessions/tokens; authorization on protected API paths; tenant isolation; validation; rate limiting; safe file uploads; secret management; recovery protection; audit logs; XSS/SQLi/CSRF protections as applicable.

## Testing/QA
Every feature: unit/domain, API, authorization, database/integrity, UI/component, end-to-end, responsive/mobile and regression tests. Financial/inventory flows additionally require idempotency, concurrency and retry tests. Test Chrome/Safari/Edge/Firefox where supported; phones/tablets and secondary desktop; slow network, offline/reconnect when enabled, expired sessions, duplicate taps/requests, invalid data, large datasets, permission bypass, payment failure, invoice delivery failure and import failure.

## Development order
1. Repository reset + docs
2. React/Vite foundation
3. Design system + app shell
4. Auth/session
5. Business onboarding
6. Organization/users/permissions
7. Catalog
8. Customers/suppliers
9. Inventory
10. Purchases
11. Billing/payments
12. Invoices/delivery
13. Returns/refunds
14. Dashboard/reports
15. Import/export
16. Plans/entitlements
17. Audit/security hardening
18. Offline/native readiness
19. Full QA/regression
20. Production release

## Definition of done
A feature is complete only when happy path, UI states, validation, API contract, authorization, persistence, error handling, audit/data integrity and relevant automated/manual tests are covered.

## Non-goal
Do not turn Micro POS into an enterprise ERP. Complexity must be justified by a real micro-business use case.

## Living specification
Update this document whenever product or architecture decisions change, before dependent implementation.