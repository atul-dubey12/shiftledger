# Payout sync, bike maintenance and monthly reports

## Release order

Deploy the backend before the frontend. The production Flyway migration `V3__payouts_maintenance.sql` adds three tables without changing ledger entries. H2 development uses the same schema through `PlanningSchema`.

The existing account model is single-rider: all devices using the same server key share the same database. This change does not introduce multi-user accounts.

## Payouts

`GET /api/payouts` and versioned `PUT /api/payouts/{monday}` store the weekly amount and received date. A payout is not another income entry. Existing browser-only payouts upload create-only after the first successful load. A server record always wins over an older browser copy, which is retained as a backup. Do not clear browser data until upload is confirmed.

Opening or refreshing on another device fetches saved payouts. Browser caches are scoped to the server and credential; cached reports are labelled provisional if the server is unavailable. Writes need a connection and are confirmed only after a server response. A conflict requires refreshing and reviewing the latest data.

## Maintenance

`GET/PUT /api/bike` stores the current odometer. `/api/maintenance` supports listing and versioned updates/deletes by UUID. Due date and due odometer are independent: either can make a reminder overdue. Due soon means 30 days or 500 km. Unknown odometer is not treated as zero. Completed items remain as history; create a new reminder for the next service.

Maintenance estimates and actual costs are planning records. Payments must also be recorded as ordinary work expenses to affect ledger totals; the UI states this explicitly. There are no push notifications or automatic kilometre estimates.

## Monthly report

Calendar-month earnings and work expenses are grouped into Monday–Sunday weeks, clipped at the month boundaries. Bank credits are grouped separately by actual received date, including payouts for a prior month's work. Whole-week payouts are displayed beside weekly figures without being added to earnings. Work surplus is earnings minus expenses, not a bank balance or confirmed personal savings. The PDF contains the weekly breakdown, bank credits and all recorded entries for the month.
