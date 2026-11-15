Offline sync regression checks

Run all frontend regression suites from frontend with `npm test`.

Frontend queue tests (run from frontend):

    node_modules/.bin/esbuild tests/offline-queue.test.ts --bundle --platform=node --format=esm --outfile=/tmp/shiftledger-offline-test.mjs
    node /tmp/shiftledger-offline-test.mjs

Backend integration tests use ONLY a disposable in-memory database on port 18085:

    java -jar ../backend/target/shiftledger-api-0.0.1-SNAPSHOT.jar --server.port=18085 --spring.datasource.url=jdbc:h2:mem:offline-test --spring.datasource.username=sa --spring.datasource.password= --app.api-key=
    python3 tests/offline-api.test.py

The API test creates and deletes test entries. Never point it at a production database.

Queued entries are local to the browser and credential. Clearing browser storage deletes unsynced entries. Existing edits, deletes, CSV imports and exports still require the server. Pending entries can be corrected or removed after a definitive validation rejection; uncertain submissions retain their original token until acknowledged. Receipts are retained after server-side deletion to prevent late retries from recreating an entry.

Planning features (payout sync, maintenance, monthly reports):

    node_modules/.bin/esbuild tests/planning.test.ts tests/planning-service.test.ts --bundle --platform=node --format=esm --out-extension:.js=.mjs --outdir=/tmp/shiftledger-planning-tests
    node /tmp/shiftledger-planning-tests/planning.test.mjs
    node /tmp/shiftledger-planning-tests/planning-service.test.mjs

API tests use a separate disposable H2 database on port 18086 (never production):

    java -jar ../backend/target/shiftledger-api-0.0.1-SNAPSHOT.jar --server.port=18086 '--spring.datasource.url=jdbc:h2:mem:planning-test;DB_CLOSE_DELAY=-1' --spring.datasource.username=sa --spring.datasource.password= --app.api-key=planning-test-key
    python3 tests/planning-api.test.py

Start a fresh database for each API test run. Tests cover API-key protection, create-only payout migration semantics, stale-write conflicts, maintenance completion/deletion, odometer updates, and ledger separation.
