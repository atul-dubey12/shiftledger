# ShiftLedger — Implementation plan: COD cash, Quick order, CSV import, hosted backend

> **Status (5 Nov 2026):** Phase 1 is done and live. Phases 2–4 are replaced by `docs/PLAN-sync-phone-laptop.md`; follow that file instead.

Audience: an AI coding agent (Cursor) working in this repo. Read the whole plan before starting. Ship the phases **in order**. Each phase is deployable on its own, and the user needs Phase 1 first.

---

## 0. Context and repo map

ShiftLedger is a personal money tracker for one Zomato delivery rider. It is used mostly on a phone, often mid-shift with one hand and patchy network.

```
backend/   Spring Boot 3.5, Java 17, JPA, H2 file DB (backend/data — never commit)
  src/main/java/com/shiftledger/entry/
    Entry.java            entity (table "entries")
    EntryRequest.java     request record
    EntryController.java  REST + validation + CSV export
    EntryType.java        INCOME | EXPENSE
    ExpenseCategory.java  FUEL | FOOD | BIKE_SERVICE | PHONE_RECHARGE | BIKE_EMI | OTHER
    SchemaUpgrade.java    one-off H2 ENUM→VARCHAR fix (H2 only)
frontend/  Angular 19 standalone components, signals, lucide-angular icons, plain CSS (src/styles.css, CSS variables, light + [data-theme=dark])
  src/app/
    entry.model.ts          LedgerEntry / EntryDraft types
    entry.service.ts        chooses storage: HTTP API or DeviceStore
    device-store.ts         localStorage implementation that MIRRORS the backend's validation rules
    storage.config.ts       'api' (local dev) — swapped for storage.config.pages.ts ('device') in the GitHub Pages build
    ledger.ts               pure calculations (totals, ranges, chart series, suggestions)
    app.component.*         dashboard
    entry-form.component.*  add/edit modal (bottom sheet on mobile)
```

Live site: https://atul-dubey12.github.io/shiftledger/ (GitHub Pages, **device storage**). Deploy with `cd frontend && npm run deploy`.

### Rules for every phase
1. **Two storage modes must stay in sync.** Every rule added to `EntryController.validate` must also be added to `device-store.ts` `validate`, with the same messages. Every new field must work in both modes.
2. **Existing data must keep working.** New columns are nullable, and `null` means the old behaviour. Never require a migration step from the user.
3. **Mobile first.** Tap targets at least 44px, text at least 12px, primary actions reachable by the thumb (bottom bar / bottom sheet).
4. Money is in ₹ and shown with the `currency:'INR':'symbol':'1.0-0'` pipe. Keep pure maths in `ledger.ts`, not in components.
5. Before finishing a phase:
   - `cd frontend && npx ng build` and `npm run build:pages` both pass with no errors.
   - `cd backend && mvn -q -DskipTests package` passes.
   - Walk through the phase's acceptance tests by hand (or add unit tests).
6. Don't commit `backend/data/`, `target/`, `dist/`, `.angular/` or `node_modules/` (already in `.gitignore`).

---

## Phase 1 — COD cash tracking + Quick order (highest priority)

### 1.1 The problem, in the rider's words
On one trip the rider got 3 COD (cash-on-delivery) orders and paid all their work expenses out of that COD cash. COD cash is **not earnings**: it belongs to Zomato and has to be settled. Today the app has no way to say "this cash isn't mine" or "I paid this petrol with COD cash", so the numbers get mixed up.

### 1.2 Concepts (keep these three numbers separate)

| Concept | Meaning |
|---|---|
| **Earnings** | What Zomato pays the rider per order / incentive. Unchanged. |
| **COD collected** | Cash taken from customers. It is owed to Zomato and is **never** counted as earnings. |
| **Expense paid from COD** | A normal work expense (it still counts in expenses and take-home), but it was physically paid with Zomato's cash. The rider must top that cash up from their own money at settlement. |
| **COD settlement** | Cash given back to Zomato: deposited, or deducted from the payout. |

Derived numbers. All of them are all-time, not per period, because cash carries over between days.

```
owedToZomato   = Σ codCollected − Σ settlements
cashInHand     = owedToZomato − Σ expenses paid from COD
fromOwnPocket  = Σ expenses paid from COD that are not yet settled   (= owedToZomato − cashInHand)
```

Take-home stays `earnings − expenses`. COD never changes it. That is the whole point.

> Open question for the user (the design supports both): does Zomato settle COD by **deducting it from the weekly payout**, by the rider **depositing cash**, or both? The settlement form offers both methods, so implement both.

### 1.3 Data model changes

Backend `Entry` and `EntryRequest`, plus frontend `LedgerEntry` / `EntryDraft`. All new fields are nullable.

| Field | Type | Applies to | Meaning |
|---|---|---|---|
| `codAmount` | BigDecimal(10,2) / number | INCOME | Cash collected from the customer for this order. `null` or 0 means not COD. |
| `paidFrom` | enum `OWN` \| `COD_CASH` | EXPENSE | `null` is treated as `OWN` (keeps old rows valid). |
| `settlementMethod` | enum `DEPOSITED` \| `DEDUCTED_FROM_PAYOUT` | COD_SETTLEMENT | How the cash went back to Zomato. |

New `EntryType` value: **`COD_SETTLEMENT`**. `amount` is the cash settled, and `category` must be null.

- Store the new enums as VARCHAR (`@Enumerated(STRING)` + `columnDefinition = "varchar(30)"`), the same way `Entry` already does for `type`/`category`. Native DB enums break when values are added later.
- `EntryType` currently gets `varchar(20)`, and `COD_SETTLEMENT` is 14 characters, so it fits.

Validation, identical in the controller and `device-store.ts`:
- `codAmount` is only allowed on INCOME; it must be ≥ 0 and < 1,00,000.
- `paidFrom` is only allowed on EXPENSE.
- COD_SETTLEMENT needs `amount > 0` and a `settlementMethod`. It must have no category, orders, hours, km, codAmount or paidFrom.
- `settlementMethod` is only allowed on COD_SETTLEMENT.
- **INCOME amount may be 0** when `codAmount > 0` (e.g. a COD order whose payout isn't known yet) **or** `hoursWorked > 0` (e.g. logging shift hours alone). Every other amount must still be > 0.
- An expense paid from COD *may* exceed the current cash in hand. Don't block it, but show a warning in the form ("You only have ₹X of COD cash"). Data entry must never get stuck.

`ledger.ts` changes:
- `totals()`: COD_SETTLEMENT entries must **not** count as income or expenses. Add `codCollected`, `codSpent`, `codSettled` to `Totals`.
- **Fix ₹/hour for per-order logging.** Today `totals()` only counts income from entries that themselves have `hoursWorked` (`incomeWithHours`). With quick orders, hours arrive on a separate "End shift" entry, so ₹/hour would come out far too low.
  - New rule: for every **date** that has any `hoursWorked > 0`, count **all** INCOME on that date in `incomeWithHours`.
  - Dates with no hours logged stay out of the rate.
- New `codBalance(entries: LedgerEntry[])` returns `{ owedToZomato, cashInHand, spentFromCod, lastSettlement: LedgerEntry | null }`, computed over **all** entries.
- Everything else that filters on `type === 'INCOME'` / `'EXPENSE'` keeps working. Check the chart (`dailySeries`), `breakdown`, `bestWeekday` and the activity list so settlements don't leak into earnings.

CSV export, in the controller and DeviceStore: append the columns `COD,PaidFrom,SettlementMethod`, keeping the existing column order before them so old files stay readable.

### 1.4 Quick order (per-order logging in about 2 taps)

The goal: right after a delivery, the rider logs it in **≤ 3 taps**, with one hand.

UI:
- On mobile, the bottom bar becomes three buttons: **Expense** · **⚡ Order** (primary, largest) · **Earning**. On desktop, add a "Quick order" button beside "Add shift earning".
- **⚡ Order** opens a compact bottom sheet:
  - **Payout** chips: the rider's most-used per-order payouts, via `suggestedAmounts` restricted to entries with `orderCount === 1`, falling back to ₹30 / ₹40 / ₹50 / ₹60. Also an "Other" number input.
  - **Km** chips: 2 / 4 / 6 / 8, plus "Other". Optional.
  - **COD?** toggle. Off by default. When on, it shows a large `₹` input for the cash collected, with the numeric keypad (`inputmode="decimal"`), autofocused.
  - **Save** button. Remember the last payout and km chosen (localStorage) and preselect them next time.
  - Saving creates an INCOME entry: `{ amount: payout, orderCount: 1, distanceKm, codAmount, date: today, note: null }`.
  - Show a toast: "Order saved · ₹40 · 4 km" and, if COD, "· ₹350 cash". Include **Undo**, reusing the existing toast + undo pattern from `AppComponent.removeEntry`.
- No hours on quick orders. Hours are logged once at the end of the shift (1.6).

Rolling orders up in the dashboard:
- `totals()` already sums `orderCount`, `distanceKm` and `amount`, so per-order entries feed the stats, chart and ₹/order automatically. Verify this.
- In the **Activity** list, collapse a day's quick orders (INCOME with `orderCount === 1` and no note) into one expandable row: "12 orders · ₹520 · 48 km · 3 COD". Tapping it expands to the individual orders, each of which can be edited or deleted. Other entries display as they do now.

### 1.5 Paying an expense with COD cash
- Expense form: add a **"Paid with"** segmented control, **My money** | **COD cash**.
  - Show it only when `cashInHand > 0` or the entry being edited already has `paidFrom = COD_CASH`.
  - Default to **COD cash** when cash in hand is ≥ the amount typed. That matches the rider's real behaviour.
- In Activity, expenses paid from COD get a small "COD cash" pill.

### 1.6 Settling COD and logging shift hours
- **COD card** on the dashboard, shown when `owedToZomato > 0` or any COD exists:
  - Headline: **"₹1,050 owed to Zomato"**
  - Lines:
    - "Cash in hand ₹750"
    - "₹300 used for expenses — keep this aside from your own money"
  - Optional **COD limit** (new Settings field, `codLimit`, stored in localStorage settings): show a progress bar and turn it amber at ≥ 80%.
  - Button **"Settle cash"** opens a form with: amount (prefilled with `owedToZomato`), method (**Deposited** / **Deducted from payout**) and date. Saving creates a COD_SETTLEMENT entry.
- **End shift** (small text button near Quick order, or in the day group header): asks for hours worked and an optional incentive/bonus ₹. It creates an INCOME entry with `amount = incentive (may be 0)` and `hoursWorked`. Per-hour metrics then work for per-order logging.

### 1.7 Acceptance tests (the rider's real day)
Start with no data:
1. Quick order × 5: payouts ₹40, 45, 40, 50, 40 at 4 km each. Three of them are COD with ₹350, ₹220 and ₹480.
2. Expense: Fuel ₹200, paid with COD cash. Expense: Food ₹100, paid with COD cash.
3. End shift: 6 hours, incentive ₹150.

Expected results:
- Earned = ₹365 (215 + 150). Expenses = ₹300. Take-home = ₹65. **COD must not appear in any of these.**
- Orders = 5, km = 20, ₹/order = ₹43 (215/5), ₹/hour = ₹61 (365/6).
- COD card shows: owed ₹1,050 · cash in hand ₹750 · ₹300 used for expenses.

Then settle ₹1,050, "Deducted from payout":
- Owed ₹0, cash in hand ₹0.
- Earned, expenses and take-home are unchanged.

Also check:
- Undo on a quick order removes it, and the COD card updates.
- Old entries (no new fields) still display and edit correctly.
- All of the above works on the GitHub Pages build (device mode) **and** against the Spring Boot API.

Deploy Phase 1 to GitHub Pages as soon as it passes. The user needs it before the hosting work.

---

## Phase 2 — CSV import (backup restore + moving data to the server)

Why: the phone's data lives in browser storage. Import lets the rider:
- restore a backup,
- move their data onto the hosted server in Phase 3,
- hand a CSV to a developer to load.

- Format: exactly the export format (header row required). Columns: `Date,Type,Category,Amount,Orders,Hours,Km,Note,COD,PaidFrom,SettlementMethod`. The last three are optional so files exported before Phase 1 still import.
- Parsing:
  - Proper CSV quoting, i.e. quoted fields with `""` escapes; notes can contain commas.
  - Strip the leading `'` that the export adds to formula-like notes.
  - Accept both `\n` and `\r\n` line endings, and a UTF-8 BOM.
- Settings gets an **"Import CSV"** item with a file picker. Flow:
  1. Parse and validate every row with the same `validate` rules.
  2. Show a **preview** before writing anything: "142 rows: 138 new, 3 duplicates (skipped), 1 invalid (row 57: Hours must be between 0 and 24)".
  3. Duplicates are rows matching an existing entry on all of date, type, category, amount, orders, hours, km, note, cod and paidFrom.
  4. On confirm, write only the valid new rows.
- Backend: `POST /api/entries/import` takes `text/csv` and returns `{ imported, duplicates, errors: [{ row, message }] }`. Support a `?dryRun=true` flag for the preview step. Wrap the write in one transaction (`@Transactional`): either all valid rows go in or none do.
- DeviceStore: the same logic client-side. Put the parser in a shared pure file, `src/app/csv.ts`, with unit-testable functions.
- Test:
  - export → import into an empty store gives identical totals;
  - importing the same file twice adds 0 rows the second time;
  - a pre-Phase-1 export (8 columns) imports fine.

---

## Phase 3 — Hosted backend (same data on phone and laptop)

Target architecture:
```
GitHub Pages (Angular, api mode) ──HTTPS + X-Api-Key──▶ Render web service (Spring Boot, Docker)
                                                              │
                                                              ▼
                                                     Neon Postgres (free tier)
```
Recommended free-tier setup: **Render** (web service) + **Neon** (Postgres). The rider must create both accounts; an agent can't. Check current free-tier limits when setting up. Render's free web services sleep when idle, so the first request after a while can take tens of seconds; the frontend must handle that (3.4).

> Don't host the H2 file DB on Render: its free disk is wiped on every deploy and restart, so data would be lost. Use Postgres.

### 3.1 Backend changes
- Dependencies:
  - `org.postgresql:postgresql` (runtime)
  - `org.flywaydb:flyway-core` and `org.flywaydb:flyway-database-postgresql`
- Profiles:
  - Default (local dev) stays on H2 exactly as today.
  - New `application-prod.properties`:
    - datasource from env vars `DB_URL` (jdbc:postgresql://…?sslmode=require), `DB_USER`, `DB_PASSWORD`
    - `spring.jpa.hibernate.ddl-auto=validate`
    - Flyway enabled
    - `server.port=${PORT:8080}`
- Flyway `V1__init.sql`: create the `entries` table with every column from Phase 1, using VARCHAR for the enum columns.
  - Enable Flyway only in prod so local H2 dev is untouched.
  - Make `SchemaUpgrade` run only on H2: check the DB product name, or annotate it `@Profile("!prod")`.
- **Auth (single user):** a `OncePerRequestFilter` on `/api/**`.
  - Require header `X-Api-Key` to equal env var `API_KEY`; compare with `MessageDigest.isEqual` (constant time).
  - Missing or wrong key → 401 with JSON `{ "message": "Invalid or missing API key" }`.
  - Skip the check for `OPTIONS` (CORS preflight) and for `GET /api/health`.
  - If `API_KEY` is unset in prod, fail at startup rather than run open.
- **CORS:** replace `@CrossOrigin(origins = "http://localhost:4200")` with a global `WebMvcConfigurer`.
  - Origins come from env `ALLOWED_ORIGINS`, default `http://localhost:4200`; in prod set it to `https://atul-dubey12.github.io`.
  - Allow methods GET, POST, PUT, DELETE, OPTIONS and header `X-Api-Key, Content-Type`.
  - Expose `Content-Disposition` so CSV download filenames work.
- `GET /api/health` returns `{ "status": "ok" }`, for the Render health check and for waking the server.
- `backend/Dockerfile`, multi-stage:
  - build stage `maven:3.9-eclipse-temurin-17`: `mvn -q -DskipTests package`
  - run stage `eclipse-temurin:17-jre`
  - `ENTRYPOINT ["java","-jar","/app/app.jar","--spring.profiles.active=prod"]`
- Add a `render.yaml` blueprint (optional but handy):
  - web service, `rootDir: backend`, Docker runtime, health check `/api/health`
  - env vars `DB_URL`, `DB_USER`, `DB_PASSWORD`, `API_KEY`, `ALLOWED_ORIGINS`, all `sync: false` so secrets are entered in the Render dashboard and never committed.

### 3.2 Frontend changes
- `storage.config.ts` becomes `{ mode: 'api' | 'device', apiBaseUrl: string }`.
  - Local dev: `{ mode: 'api', apiBaseUrl: '' }`, which uses the dev proxy.
  - Add a new build config `pages-api`: `{ mode: 'api', apiBaseUrl: 'https://<render-service>.onrender.com' }`.
  - Keep the existing `pages` (device) config as a fallback.
- `EntryService` prefixes every URL with `apiBaseUrl`.
- HTTP interceptor: add `X-Api-Key` from localStorage (`shiftledger.apiKey`). On 401, open Settings with a "Server key" field and the message "Enter your server key".
- Settings: add a **Server key** field (password input, with show/hide). Store it in localStorage only.
- CSV export in api mode: `window.location.href` can't send headers. Fetch the CSV with `HttpClient` (`responseType: 'text'`), then download it via Blob, the same way DeviceStore does.

### 3.3 Security notes
- The API key is the only thing protecting the rider's financial data. Generate it with `openssl rand -hex 32`.
- Set it in the Render dashboard and type it into the app once per device. Never commit it or put it in the frontend build.
- HTTPS is provided by Render and GitHub Pages. Don't allow `http://` origins in prod.
- Note in the README that the repo is public: no secrets in code, `.env` or `render.yaml` values.

### 3.4 Cold start and bad network UX
- If a request is still pending after 3 s, show a non-blocking banner: "Waking up the server… (first load can take up to a minute)".
- Call `GET /api/health` on app start to begin waking the server early.
- If a save fails because of network or timeout (not a 4xx):
  - keep the form open with the values intact;
  - show "No connection — tap to retry".
  - Never lose what the rider typed.
- *(Later, optional)* An offline queue for quick orders, saved in localStorage and synced when back online. Out of scope for this phase.

### 3.5 Deploy steps (document these in README)
1. Neon: create a project and copy the connection details. The JDBC URL is `jdbc:postgresql://<host>/<db>?sslmode=require`.
2. Render: New → Blueprint (or Web Service) from `atul-dubey12/shiftledger`, root `backend`, Docker. Set the env vars and deploy, then check that `https://<service>.onrender.com/api/health` returns ok.
3. Put the Render URL into the `pages-api` storage config. Switch `npm run deploy` to build `pages-api`, then deploy.
4. Open the site, enter the server key in Settings, and confirm it loads with an empty list.

---

## Phase 4 — Move the phone's data to the server
1. On the phone, in the **current** device-mode site: **Download CSV**, with the period set to cover everything. Add an "All time" export option in Phase 2 if one doesn't exist yet.
2. Deploy Phase 3.
3. In the hosted app: Settings → Import CSV → check the preview → confirm.
4. Check that totals for the last few weeks match what the phone showed.
5. The phone's old localStorage data stays untouched as a backup, because the device and api modes use different storage.

---

## Out of scope (don't build now)
- Multi-user accounts, sign-up, password reset.
- Reading data automatically from the Zomato app.
- Offline sync queue (noted in 3.4 as a later option).
