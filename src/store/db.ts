import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_polled_at TEXT,
  last_status TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  deal_type TEXT,
  property_type TEXT,
  rooms TEXT,
  size_m2 REAL,
  year TEXT,
  floor TEXT,
  price REAL,
  price_per_m2 REAL,
  price_display TEXT,
  description TEXT,
  image_url TEXT,
  agency TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missed_count INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT,
  PRIMARY KEY (watch_id, listing_id)
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER NOT NULL,
  listing_id TEXT NOT NULL,
  price REAL NOT NULL,
  observed_at TEXT NOT NULL,
  FOREIGN KEY (watch_id, listing_id) REFERENCES listings(watch_id, listing_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_price_history_listing
  ON price_history (watch_id, listing_id);
`;

// stolpci, dodani po prvi različici sheme; obstoječe baze jih dobijo prek ALTER
const MIGRATIONS: { column: string; ddl: string }[] = [
  { column: "price_per_m2", ddl: "ALTER TABLE listings ADD COLUMN price_per_m2 REAL" },
  { column: "missed_count", ddl: "ALTER TABLE listings ADD COLUMN missed_count INTEGER NOT NULL DEFAULT 0" },
  { column: "removed_at", ddl: "ALTER TABLE listings ADD COLUMN removed_at TEXT" },
];

function migrate(db: DatabaseSync): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(listings)").all() as { name: string }[]).map((r) => r.name),
  );
  for (const { column, ddl } of MIGRATIONS) {
    if (!cols.has(column)) db.exec(ddl);
  }
}

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// cel obhod gre v eno transakcijo, da padec na pol poti ne pusti zmešnjave v bazi
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
