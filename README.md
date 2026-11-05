# ShiftLedger

A small delivery-work money tracker for Zomato shifts. The web app pairs an Angular dashboard with a Spring Boot API and an H2 database.

## What it tracks

- Shift earnings, optionally with orders, hours and km ridden (unlocks ₹/hour, ₹/order and fuel cost per km)
- **Quick order**: log each delivery in two taps (payout, km, COD), then **End shift** to add hours and incentive
- **COD cash**: cash collected on delivery is tracked apart from earnings. Expenses can be paid from it, and the dashboard shows what you owe Zomato, the cash in hand, and how much of it went on expenses, with a **Settle cash** action
- Fuel, food, bike service, phone & data, bike EMI/rent, and other expenses
- Earnings, expenses and take-home for any day, week or month, compared with the same point in the previous period
- A daily earnings/costs chart, a weekly take-home goal, and automatic insights (fuel share, best weekday, …)
- Activity grouped by day with search, edit, delete-with-undo, and CSV export
- Light / night theme and a phone-friendly layout with a bottom action bar

Entry types: `INCOME`, `EXPENSE`, `COD_SETTLEMENT`. API: `GET/POST /api/entries`, `PUT/DELETE /api/entries/{id}`, `GET /api/entries/export?from=&to=` (CSV).
Older databases are upgraded automatically on startup (see `SchemaUpgrade`).

## Run locally

Requirements: Java 17+, Maven, Node.js 18.19.1+ and npm.

```sh
cd backend && mvn spring-boot:run
```

In another terminal:

```sh
cd frontend && npm install && npm start
```

Open http://localhost:4200. The API is at http://localhost:8080/api/entries. H2 data is stored in `backend/data`.

Angular 19 is used in this initial scaffold to fit the Node 18 runtime available in the development environment. Angular 19 is outside its support window; before deploying this app, upgrade Node and Angular to a currently supported release.

## GitHub Pages

Live at https://atul-dubey12.github.io/shiftledger/. To publish changes: `cd frontend && npm run deploy` (builds and pushes to the `gh-pages` branch).

GitHub Pages only serves static files, so the hosted build (`npm run build:pages`) stores entries **in the browser on that device** instead of calling the API. Clearing browser data erases them, so use **Download CSV** now and then as a backup. Running locally with `npm start` still uses the Spring Boot API.
