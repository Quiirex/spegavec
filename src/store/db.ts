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

// Aditivne spremembe sheme. Nove TABELE in INDEKSI gredo v SCHEMA zgoraj (IF NOT EXISTS poskrbi).
// Nov STOLPEC na obstoječi tabeli dodaj sem kot ALTER (CREATE TABLE IF NOT EXISTS obstoječe tabele
// ne spremeni), da se v produkciji uveljavi brez brisanja baze. Vsak vnos teče samo, če stolpca še ni.
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "listings", column: "price_per_m2", ddl: "ALTER TABLE listings ADD COLUMN price_per_m2 REAL" },
  { table: "listings", column: "missed_count", ddl: "ALTER TABLE listings ADD COLUMN missed_count INTEGER NOT NULL DEFAULT 0" },
  { table: "listings", column: "removed_at", ddl: "ALTER TABLE listings ADD COLUMN removed_at TEXT" },
];

function migrate(db: DatabaseSync): void {
  for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name),
    );
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
