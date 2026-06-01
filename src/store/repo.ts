import type { DatabaseSync } from "node:sqlite";
import type { Listing, PriceChange, Watch } from "../core/types.js";
import { transaction } from "./db.js";

interface WatchRow {
  id: number;
  name: string;
  url: string;
  pages: number;
  channel_id: string;
  paused: number;
  created_at: string;
  last_polled_at: string | null;
  last_status: string | null;
}

function toWatch(row: WatchRow): Watch {
  return {
    id: Number(row.id),
    name: row.name,
    url: row.url,
    pages: Number(row.pages),
    channelId: row.channel_id,
    paused: Number(row.paused) === 1,
    createdAt: row.created_at,
    lastPolledAt: row.last_polled_at,
    lastStatus: row.last_status,
  };
}

export class WatchRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(name: string, url: string, pages: number, channelId: string): Watch {
    const result = this.db
      .prepare(
        `INSERT INTO watches (name, url, pages, channel_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(name, url, pages, channelId, new Date().toISOString());
    return this.byId(Number(result.lastInsertRowid))!;
  }

  byId(id: number): Watch | null {
    const row = this.db.prepare("SELECT * FROM watches WHERE id = ?").get(id) as
      | WatchRow
      | undefined;
    return row ? toWatch(row) : null;
  }

  byName(name: string): Watch | null {
    const row = this.db.prepare("SELECT * FROM watches WHERE name = ?").get(name) as
      | WatchRow
      | undefined;
    return row ? toWatch(row) : null;
  }

  all(): Watch[] {
    const rows = this.db.prepare("SELECT * FROM watches ORDER BY name").all() as unknown as WatchRow[];
    return rows.map(toWatch);
  }

  active(): Watch[] {
    return this.all().filter((watch) => !watch.paused);
  }

  remove(name: string): boolean {
    return this.db.prepare("DELETE FROM watches WHERE name = ?").run(name).changes > 0;
  }

  setPaused(name: string, paused: boolean): boolean {
    return (
      this.db
        .prepare("UPDATE watches SET paused = ? WHERE name = ?")
        .run(paused ? 1 : 0, name).changes > 0
    );
  }

  recordPoll(id: number, status: string): void {
    this.db
      .prepare("UPDATE watches SET last_polled_at = ?, last_status = ? WHERE id = ?")
      .run(new Date().toISOString(), status, id);
  }

  listingCount(id: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM listings WHERE watch_id = ?")
      .get(id) as { n: number };
    return Number(row.n);
  }
}

export interface DiffResult {
  newListings: Listing[];
  priceChanges: PriceChange[];
}

export class ListingRepo {
  constructor(private readonly db: DatabaseSync) {}

  // primerja sveže pobrane oglase z bazo: nove vstavi, spremembe cene zabeleži, ostalim osveži last_seen
  applyCrawl(watchId: number, listings: Listing[]): DiffResult {
    const now = new Date().toISOString();
    const result: DiffResult = { newListings: [], priceChanges: [] };

    const selectPrice = this.db.prepare(
      "SELECT price FROM listings WHERE watch_id = ? AND listing_id = ?",
    );
    const insert = this.db.prepare(
      `INSERT INTO listings (
         watch_id, listing_id, url, title, deal_type, property_type, rooms,
         size_m2, year, floor, price, price_display, description, image_url,
         agency, first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = this.db.prepare(
      `UPDATE listings SET
         url = ?, title = ?, price = ?, price_display = ?, description = ?,
         image_url = ?, last_seen_at = ?
       WHERE watch_id = ? AND listing_id = ?`,
    );
    const insertPrice = this.db.prepare(
      "INSERT INTO price_history (watch_id, listing_id, price, observed_at) VALUES (?, ?, ?, ?)",
    );

    transaction(this.db, () => {
      for (const listing of listings) {
        const existing = selectPrice.get(watchId, listing.id) as
          | { price: number | null }
          | undefined;

        if (!existing) {
          insert.run(
            watchId,
            listing.id,
            listing.url,
            listing.title,
            listing.dealType,
            listing.propertyType,
            listing.rooms,
            listing.sizeM2,
            listing.year,
            listing.floor,
            listing.price,
            listing.priceDisplay,
            listing.description,
            listing.imageUrl,
            listing.agency,
            now,
            now,
          );
          if (listing.price !== null) {
            insertPrice.run(watchId, listing.id, listing.price, now);
          }
          result.newListings.push(listing);
          continue;
        }

        update.run(
          listing.url,
          listing.title,
          listing.price,
          listing.priceDisplay,
          listing.description,
          listing.imageUrl,
          now,
          watchId,
          listing.id,
        );

        const oldPrice = existing.price === null ? null : Number(existing.price);
        const priceChanged =
          listing.price !== null && oldPrice !== null && Math.abs(listing.price - oldPrice) >= 1;
        if (priceChanged) {
          insertPrice.run(watchId, listing.id, listing.price, now);
          result.priceChanges.push({
            listing,
            oldPrice: oldPrice!,
            newPrice: listing.price!,
          });
        }
      }
    });

    return result;
  }
}
