# ShiftLedger — Plan: same data on phone and laptop

Audience: an AI coding agent (Cursor) working in this repo. Do the steps **in order**, one per session. Stop at the end of each step so the user can check it.

This replaces Phases 2–4 of `docs/PLAN-cod-quick-order-hosting.md`. Phase 1 there (Quick order + COD) is **done and live**.

---

## Why the data isn't shared today

The live site (https://atul-dubey12.github.io/shiftledger/) is built with `--configuration pages`. That build swaps `src/app/storage.config.ts` for `storage.config.pages.ts` (`STORAGE_MODE = 'device'`), so every entry is saved in **that browser's localStorage**, under the key `shiftledger.entries`. The phone and the laptop each have their own separate copy.

The fix: host the existing Spring Boot API with a real database, point the site at it, and move the phone's entries up to it once.

```
Phone / laptop browser ──HTTPS + X-Api-Key──▶ Render (Spring Boot, Docker) ──▶ Neon (Postgres)
   GitHub Pages site
```

---

## Ground rules (read before every step)

1. **Never lose the rider's data.** The phone's localStorage entries are the only copy of real delivery records.
   - Nothing in this plan may delete or overwrite `shiftledger.entries`.
   - Migration copies data; it never moves it.
2. **Two storage modes must stay in sync.**
   - `EntryController.validate` (backend) and `validate` in `frontend/src/app/device-store.ts` must apply the same rules with the same messages.
   - Any new field or endpoint must work in both modes.
3. **Entry order matters.** `codBalance()` in `ledger.ts` replays entries sorted by `date`, then `id`, ascending. When inserting many entries (import or migration), insert them **oldest first**, and within one date keep their original id order. Otherwise COD cash-in-hand comes out wrong.
4. **Secrets never go in the repo.** The repo is public, so the API key and database password belong only in the Render dashboard and in the user's browser.
5. **Mobile first.** Tap targets at least 44px, text at least 12px. Rider-facing text should be short and plain.
6. **Before ending any step, all of these must pass:**
   - `cd frontend && npx ng build && npm run build:pages`
   - `cd backend && mvn -q -DskipTests package` (the user's Maven lives at `~/.m2/wrapper/dists/apache-maven-3.9.16-bin/*/apache-maven-3.9.16/bin/mvn` if `mvn` isn't on PATH)
   - the step's own checks
7. **Deploying:** `cd frontend && npm run deploy` (`scripts/deploy-pages.sh`) builds and force-pushes to the `gh-pages` branch. Commit to `main` and push first.

### Facts about the current code
- Entry fields: `id, type (INCOME|EXPENSE|COD_SETTLEMENT), category, amount, date (yyyy-MM-dd), note, orderCount, hoursWorked, distanceKm, codAmount, paidFrom (OWN|COD_CASH), settlementMethod (DEPOSITED|DEDUCTED_FROM_PAYOUT)`.
- CSV export (`GET /api/entries/export` and `DeviceStore.csv`):
  - Header: `Date,Type,Category,Amount,Orders,Hours,Km,Note,COD,PaidFrom,SettlementMethod`.
  - Rows are **newest first** (date desc, id desc).
  - Notes are double-quoted, with `""` escapes and a leading `'` added to notes starting with `= + - @`.
  - The API writes `40.00`, the device writes `40`; both must parse.
  - Files made before 5 Nov 2026 have only the first 8 columns.
- `EntryService` uses the relative URL `/api/entries` (local dev goes through `proxy.conf.json`).
  - `exportCsv()` uses `window.location.href` in api mode, which **cannot send headers**.
- `EntryController` has `@CrossOrigin(origins = "http://localhost:4200")`.
- `SchemaUpgrade` is an H2-only fix (ENUM→VARCHAR) and must not run against Postgres.
- Local dev (`npm start` + Spring Boot on 8080 + H2 in `backend/data/`) must keep working exactly as now.

---

## Step 1 — "All time" CSV export + CSV import (works on the current site) ✅ DONE

Goal: the rider can make a **complete backup** today, and the app can load a CSV back in. This step is safe and useful even before any server exists.

### 1a. All-time export
- In the Activity footer and the top-bar download button, the export currently covers only the selected period.
  - Add a small menu or second button: **"This period"** / **"Everything"**.
  - "Everything" exports from the earliest entry date to today. The API already allows no `from`/`to`; DeviceStore needs `from = '0000-01-01'`, `to = '9999-12-31'`.
- File name: `shiftledger-all-<today>.csv`.

### 1b. Shared CSV parser — new file `frontend/src/app/csv.ts`
Pure functions with no Angular imports, so they're easy to unit-test:
- `parseCsv(text: string): { drafts: EntryDraft[]; errors: { row: number; message: string }[] }`. It must:
  - strip a UTF-8 BOM;
  - accept `\r\n` and `\n`;
  - handle quoted fields containing commas, quotes and newlines;
  - strip the `'` formula guard;
  - require the header row and match columns **by header name** (so 8-column and 11-column files both work);
  - turn empty cells into `null`.
- Map each row to an `EntryDraft`. Numbers go through `Number()`, and anything NaN is a row error.
- Run the **same `validate()`** that DeviceStore uses. Export it from `device-store.ts` (or move it into a shared `validation.ts`) instead of copying it.
- Return the drafts **oldest first**: reverse the file order, then stable-sort by date ascending (rule 3).
- `duplicateKey(d: EntryDraft): string` joins date, type, category, amount (as a number), orderCount, hoursWorked, distanceKm, note, codAmount, paidFrom and settlementMethod.

### 1c. Import UI
- In Settings, add **"Import CSV"** (file input, `accept=".csv,text/csv"`). Flow:
  1. Read the file and parse it.
  2. Find duplicates by comparing `duplicateKey` against existing entries **and** against earlier rows in the same file. Count each repeat; a genuinely repeated row (two ₹40 orders on the same day) must survive. Use a multiset of keys, not a set.
  3. Show a preview sheet: "**38 new**, 4 already in the app (skipped), 1 problem: row 12 — Hours must be between 0 and 24". It has two buttons, **Import 38 entries** and **Cancel**.
  4. On confirm, write the new drafts oldest first, then refresh and show a toast with the result.
- Device mode: add `DeviceStore.importMany(drafts)`, which appends with increasing ids in one `localStorage.setItem` call.
- API mode: `POST /api/entries/import` with a JSON body `{ entries: EntryRequest[], dryRun: boolean }` (JSON, not CSV: the browser already parsed it).
  - Response: `{ imported, duplicates, errors: [{ row, message }] }`.
  - The server re-validates every row and does its own duplicate check against the DB with the same multiset rule.
  - `@Transactional`: when `dryRun` is false, save all valid non-duplicate rows in list order, or none of them if anything unexpected fails.

### 1d. Checks
- Exporting "Everything" then importing into an empty browser profile gives identical totals, the same COD card, and the same entry count.
- Importing the same file a second time imports **0**.
- A file containing two identical ₹40 orders on one day imports both.
- A pre-5-Nov 8-column file imports.
- A note like `=1+1, "hi"` round-trips unchanged.
- Add a few unit tests for `csv.ts` if a test runner is set up. If not, write a small script and remove it afterwards.

Deploy Step 1 (`git push`, then `npm run deploy`). **Then tell the user to download an "Everything" backup from their phone.**

---

## Step 2 — Prepare the backend for hosting (code only, nothing deployed) ✅ DONE (5 Nov 2026)

> Done and tested against a local PostgreSQL 16 (prod profile). Files: `config/ApiKeyFilter.java`, `config/WebSecurityConfig.java` (CORS runs as the first filter, so the 401 also carries CORS headers), `config/HealthController.java`, `application-prod.properties`, `db/migration/V1__entries.sql`, `backend/Dockerfile`, `render.yaml`. `docker build` was **not** tested locally because Docker wasn't usable; Render will build it.

### 2a. Postgres + Flyway, prod profile only
- `pom.xml`: add `org.postgresql:postgresql` (runtime), `org.flywaydb:flyway-core` and `org.flywaydb:flyway-database-postgresql`.
- `application.properties` (local H2): add `spring.flyway.enabled=false` so local dev is unchanged.
- New `src/main/resources/application-prod.properties`:
  ```
  spring.datasource.url=${DB_URL}
  spring.datasource.username=${DB_USER}
  spring.datasource.password=${DB_PASSWORD}
  spring.datasource.driverClassName=org.postgresql.Driver
  spring.jpa.hibernate.ddl-auto=validate
  spring.flyway.enabled=true
  server.port=${PORT:8080}
  app.allowed-origins=${ALLOWED_ORIGINS}
  app.api-key=${API_KEY}
  ```
- `src/main/resources/db/migration/V1__entries.sql` creates `entries` so it passes Hibernate `validate`:
  - `id bigint generated by default as identity primary key`
  - `type varchar(20) not null`, `category varchar(30)`
  - `amount numeric(10,2) not null`, `date date not null`, `note varchar(180)`
  - `order_count integer`, `hours_worked numeric(5,2)`, `distance_km numeric(7,1)`
  - `cod_amount numeric(10,2)`, `paid_from varchar(20)`, `settlement_method varchar(30)`
  - plus `create index on entries(date)`.
- `SchemaUpgrade`: annotate `@Profile("!prod")`.
- Check locally that the prod profile boots against a real Postgres, using Docker `postgres:16` if available. If Docker isn't available, say so; don't skip silently.

### 2b. Single-user API key
- New `ApiKeyFilter extends OncePerRequestFilter`, applied to `/api/**`:
  - Let `OPTIONS` requests (CORS preflight) and `GET /api/health` through.
  - Otherwise compare the `X-Api-Key` header with `app.api-key` using `MessageDigest.isEqual` on UTF-8 bytes.
  - On a mismatch, return 401 with JSON `{"message":"Invalid or missing server key"}`.
- Active only when `app.api-key` is set. In the prod profile, fail at startup if it's blank or shorter than 32 characters.
- Local dev (no key) must keep working without a header.

### 2c. CORS
- Remove `@CrossOrigin` from `EntryController`. Add a `WebMvcConfigurer` that reads `app.allowed-origins` (comma-separated, default `http://localhost:4200`), with:
  - methods GET, POST, PUT, DELETE, OPTIONS
  - allowed headers `Content-Type, X-Api-Key`
  - exposed header `Content-Disposition`
- Prod value: exactly `https://atul-dubey12.github.io` (no path, no trailing slash).
- The filter in 2b runs before Spring MVC's CORS handling, which is why 2b lets `OPTIONS` through.

### 2d. Health + Docker + Render blueprint
- `GET /api/health` returns `{"status":"ok"}`.
- `backend/Dockerfile`, multi-stage:
  - build stage `maven:3.9-eclipse-temurin-17`: copy `pom.xml`, run `mvn -q dependency:go-offline`, copy `src`, run `mvn -q -DskipTests package`
  - run stage `eclipse-temurin:17-jre`: copy the jar to `/app/app.jar`, set `ENTRYPOINT ["java","-XX:MaxRAMPercentage=75","-jar","/app/app.jar","--spring.profiles.active=prod"]`
- `backend/.dockerignore`: `target/`, `data/`, `.idea/`.
- `render.yaml` at the repo root:
  - one web service, `runtime: docker`, `rootDir: backend`, `dockerfilePath: ./Dockerfile`, `healthCheckPath: /api/health`, `plan: free`
  - env vars `DB_URL`, `DB_USER`, `DB_PASSWORD`, `API_KEY`, `ALLOWED_ORIGINS`, all with `sync: false` (values are entered in the dashboard and never committed)

### 2e. Checks
- Local dev is unchanged: `npm start` plus the IntelliJ run still works with no key.
- With the prod profile and a key:
  - a request without a key returns 401;
  - a request with the key returns 200;
  - a preflight `OPTIONS` from `https://atul-dubey12.github.io` returns the CORS headers;
  - a preflight from another origin is rejected.
- `docker build backend` succeeds (if Docker is available).

Commit and push. **Don't touch the live site in this step.**

---

## Step 3 — The user creates the hosting (the user does this; the agent guides)

The agent can't create accounts. Give the user these steps and wait for them to come back with the values.

1. **Neon** (neon.tech): sign up with GitHub and create a project (region near India, e.g. Singapore). From "Connection details", copy the host, database, user and password. The JDBC URL is `jdbc:postgresql://<host>/<database>?sslmode=require`.
2. **Server key:** in a terminal, run `openssl rand -hex 32` and save the output somewhere safe (e.g. a password manager). This is the "server key".
3. **Render** (render.com): sign up with GitHub. Then New → Blueprint, pick `atul-dubey12/shiftledger`, and enter these env vars when asked:
   - `DB_URL`, `DB_USER`, `DB_PASSWORD` (from Neon)
   - `API_KEY` (the server key)
   - `ALLOWED_ORIGINS=https://atul-dubey12.github.io`
4. Wait for the deploy, then open `https://<service-name>.onrender.com/api/health`. It should show `{"status":"ok"}`. Give the agent **only the service URL**, never the key or password.

Free tiers change, so check them when signing up. Expect the free Render service to **sleep when idle**: the first request after a quiet period can take up to about a minute. Step 4 handles this in the UI.

---

## Step 4 — Point the website at the server

### 4a. Config
- Change `storage.config.ts` to export `STORAGE = { mode: 'api' | 'device', apiBaseUrl: string }`:
  - `storage.config.ts` (local dev): `{ mode: 'api', apiBaseUrl: '' }`
  - `storage.config.pages.ts`: `{ mode: 'device', apiBaseUrl: '' }` (keep it as a fallback build)
  - new `storage.config.pages-api.ts`: `{ mode: 'api', apiBaseUrl: 'https://<service-name>.onrender.com' }`
- `angular.json`: add a `pages-api` configuration identical to `pages` except for its file replacement. `package.json`: add `"build:pages-api"`.
- `scripts/deploy-pages.sh`: build `pages-api` by default. Allow `MODE=device npm run deploy` to build the old device version.

### 4b. Service + key
- `EntryService`: every URL becomes `${apiBaseUrl}/api/entries...`.
- A functional `HttpInterceptor` (registered in `main.ts` with `provideHttpClient(withInterceptors([...]))`) adds `X-Api-Key` from `localStorage['shiftledger.apiKey']` when it is set.
- Settings: add a **Server key** field (password input with show/hide), shown only in api mode. Save it on change.
- On a 401: open Settings, focus the key field, and show "Enter your server key to load your entries". Don't show the generic "Could not connect" banner.
- `exportCsv()` in api mode: `http.get(url, { responseType: 'text' })`, then download through a Blob (same as the device path). `window.location` can't send the key.

### 4c. Slow server / bad network
- On app start, fire `GET /api/health` immediately to wake the server.
- If any request is still pending after 3 s, show a slim non-blocking banner: "Waking up the server… first load can take up to a minute". Hide it when the request finishes.
- Save failures without a 4xx (network error or timeout):
  - keep the sheet open with everything the rider typed;
  - show "No connection — tap Save to retry".
  - Applies to Quick order, the entry form, Settle cash and End shift.
- HTTP timeout around 70 s, so a cold start doesn't fail.

### 4d. Move the phone's entries up (in-app, no CSV juggling)
- In api mode, on load, check `localStorage['shiftledger.entries']`. If it has entries and `localStorage['shiftledger.migratedAt']` is unset, show a card at the top: "**43 entries are saved only on this phone.** Upload them to your account so they show on all your devices." with buttons **Upload** and **Not now**.
- **Upload** sends them, sorted oldest first (date asc, then the old id asc), to `POST /api/entries/import` with `dryRun: true`. Then show the preview ("41 new, 2 already on the server"), then send it for real.
  - On success, set `shiftledger.migratedAt` and show a toast.
  - **Do not delete** `shiftledger.entries`; it stays as a backup.
- **Not now** hides the card for this session only.
- Duplicate detection (Step 1) makes uploading twice from two devices harmless.

### 4e. Checks
- Against the real Render URL:
  - On a fresh browser profile, Settings asks for the key, and after entering it the list loads.
  - An entry added on one device shows on the other after a refresh.
  - The upload card moves device-mode entries up once, and the COD card shows the same owed / in-hand numbers as before.
  - Uploading again imports 0.
  - Export works with the key.
  - After the service has been idle about 15 minutes, the "Waking up" banner appears and the request still succeeds.
- Local dev (`npm start` + local Spring Boot) still works with no key.

Deploy (`git push`, then `npm run deploy`).

---

## Step 5 — The user's switch-over checklist

1. Before Step 4 is deployed: on the phone, **Download CSV → Everything** (from Step 1) and keep the file as a backup.
2. After Step 4 is live: open the site on the phone. Settings → Server key → paste the key. Tap **Upload** on the "saved only on this phone" card.
3. Open the site on the laptop, enter the same key, and check the numbers match the phone.
4. If anything looks wrong, Settings → Import CSV with the backup file. Duplicates are skipped, so it's safe.

---

## Out of scope
- Multiple users, sign-up, passwords. One rider, one key.
- An offline queue (saving while there's no signal and syncing later) is a good next feature, but not now.
- Automatic data from the Zomato app.
