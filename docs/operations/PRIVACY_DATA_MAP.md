# Nawasrah privacy data map

This document records the technical behavior verified in the repository. It is
not a legal opinion and does not claim complete legal compliance.

## Personal data inventory

| Data | Collection and purpose | Canonical storage | Authorized use and transfers |
| --- | --- | --- | --- |
| Customer name and phone | Checkout, POS, CRM; order identity and contact | `customers`, order/customer snapshots | Active ERP staff through protected Admin screens/RPCs; not included in Developer monitoring; excluded from new Business automation payloads after migration 102 |
| Delivery address | Checkout/CRM; delivery fulfillment | `customer_addresses` and order references | Active ERP staff; optional customer-initiated WhatsApp contact; excluded from new Business automation payloads |
| Coordinates or Maps link | Optional delivery location | `customer_addresses` | Authorized order/CRM views; not public tracking and not external alert payloads |
| Order contents and totals | Order fulfillment, inventory, accounting and audit | `orders`, `order_items`, payment and history tables | ERP roles and sanitized Business summaries; public tracking returns only the minimum order status summary |
| Customer/supplier balances | Receivables and payables | canonical order/payment/supplier records | ERP accounting views; only aggregate values appear in owner Business summaries; Developer monitoring receives counts/status only |
| Staff identity and authentication | Admin access and accountability | Supabase Auth, `profiles`, `user_roles`, MFA factors | authenticated active ERP staff; owner-only account administration; secrets are not stored in application logs |
| Push subscription endpoint and keys | Opt-in staff notifications | `push_subscriptions` | service-only delivery function and the subscribing staff user; notification text is minimized and does not include customer identity or order total |
| Audit identity and request metadata | traceability and security | `audit_logs`, gateway request table, monitoring tables | protected operational/security views; gateway rate-limit identifiers are HMAC hashes rather than raw phone/session/IP values |

## Browser storage

- Cart and favorites contain product identifiers and quantities, not customer
  identity.
- The pending request key and guest session are opaque identifiers.
- The last-order helper contains the order number and product identifiers.
- The optional saved-customer record has a 30-day TTL. Version 3 stores contact,
  address, and optional delivery location only; it deliberately excludes
  order-specific customer notes. Older version 2 records are migrated locally
  on read and have those notes removed.
- The Customer Supabase client does not persist an authentication session.

## External services and actual flow

- **Supabase:** database, authentication, protected RPCs, Edge Functions and
  canonical order processing.
- **Cloudflare Pages / Turnstile:** static hosting and abuse verification. The
  browser sends a short-lived Turnstile token; the Edge gateway verifies it.
- **Sentry:** optional production runtime error reporting. `sendDefaultPii` is
  disabled and URLs, console breadcrumbs, sensitive keys, Jordanian phone
  numbers, and email-like values are sanitized before delivery.
- **n8n / Telegram / WhatsApp Business automation:** owner-only operational
  events and summaries. New-order events are minimized before leaving the
  database and contain no customer name, phone, address, notes, or location.
- **Web Push:** staff opt-in endpoint; order alerts contain the order number and
  a generic action only.
- **Customer-initiated WhatsApp:** only when the customer chooses the WhatsApp
  link. The generated confirmation identifies the saved order and commercial
  summary, without repeating customer contact, address, notes, or map location.

No advertising analytics or marketing-cookie integration is present in the
Customer Store. A cookie banner is therefore not added merely for appearance.

## Existing technical retention

- Saved customer details on the browser: 30 days, then removed on read.
- Pending idempotency request in browser storage: 24 hours.
- n8n execution data: pruning enabled, maximum age 720 hours (30 days), maximum
  retained count 5,000.
- n8n backup logs: files older than 30 days are removed; encrypted archives use
  the configured archive-count retention (normally 30).
- ERP encrypted backup: configured archive-count retention (setup default 30),
  with encrypted integrity verification and isolated restore drills.
- Business data, audit records, Telegram messages, Sentry events, Cloudflare
  logs, push-subscription history, and exports do not have one approved unified
  deletion schedule in this repository.

No automatic Production deletion of Business data is introduced by this pass.

## Data-subject request capability

- **Access/correction:** staff can locate an order/customer through existing
  protected Admin CRM/order views and correct the supported customer/address
  fields.
- **Consent withdrawal:** the saved-data option can be disabled and erased on
  the customer's device. Staff push notifications can be unsubscribed.
- **Export/restriction/deletion:** these require an authenticated operating
  procedure that verifies the requester and preserves mandatory accounting,
  inventory, reversal, audit, and backup evidence. No destructive one-click
  deletion is added.

## Requires Business or legal input

1. Confirm the legal controller's registered name and postal address.
2. Approve a dedicated privacy contact (email or phone) and response owner.
3. Approve the lawful basis/consent wording for each processing purpose.
4. Approve retention periods for customers, addresses, completed/cancelled
   orders, audit/security logs, exports, Telegram messages, Sentry, and backups.
5. Define identity-verification and approval steps for access, export,
   restriction, correction, and deletion requests.
6. Decide which ERP roles genuinely need full customer contact/address access;
   current policy grants read access to every active ERP staff role, while UI
   navigation and mutation RPCs apply narrower operational permissions.

These decisions should be reviewed against Jordan's Personal Data Protection
Law No. 24 of 2023 and its current implementing regulations by qualified local
counsel before a legal-compliance claim is made.
