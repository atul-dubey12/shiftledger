CREATE TABLE IF NOT EXISTS weekly_payouts (
 week_start DATE PRIMARY KEY, amount NUMERIC(11,2) NOT NULL, received_on DATE NOT NULL, version BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_items (
 id VARCHAR(36) PRIMARY KEY, title VARCHAR(120) NOT NULL, kind VARCHAR(30) NOT NULL,
 due_date DATE, due_km INTEGER, estimated_cost NUMERIC(11,2), completed_on DATE, actual_cost NUMERIC(11,2), version BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS bike_state (
 id INTEGER PRIMARY KEY, odometer INTEGER NOT NULL, version BIGINT NOT NULL
);
