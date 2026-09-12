import type { DatabaseSync } from "node:sqlite";
import type { Listing, PriceChange, PriceHistoryEntry, Relisted, Watch } from "../core/types.js";
import { medianOfSample } from "../core/stats.js";
import { transaction } from "./db.js";

// kolikokrat zapored mora oglas manjkati v zajemu, da ga štejemo za prodanega/umaknjenega
const REMOVE_THRESHOLD = 2;

interface WatchRow {
  id: number;
  name: string;
  url: string;
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
    channelId: row.channel_id,
    paused: Number(row.paused) === 1,
    createdAt: row.created_at,
    lastPolledAt: row.last_polled_at,
    lastStatus: row.last_status,
  };
}

export class WatchRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(name: string, url: string, channelId: string): Watch {
    const result = this.db
      .prepare(
        `INSERT INTO watches (name, url, channel_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(name, url, channelId, new Date().toISOString());
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

export interface RecapStats {
  added: number;
  removed: number;
  active: number;
  priceChanges: number;
  drops: number;
  raises: number;
  // povprečna sprememba cene v %, null brez sprememb
  avgChangePct: number | null;
  // mediana €/m² oglasov, dodanih v obdobju, in v prejšnjem obdobju (null pri premajhnem vzorcu)
  medianPpm2New: number | null;
  medianPpm2Prev: number | null;
}

export interface DiffResult {
  newListings: Listing[];
  priceChanges: PriceChange[];
  removed: Listing[];
  relisted: Relisted[];
}

interface ListingRow {
  listing_id: string;
  url: string;
  title: string;
  deal_type: string | null;
  property_type: string | null;
  rooms: string | null;
  size_m2: number | null;
  year: string | null;
  floor: string | null;
  price: number | null;
  price_per_m2: number | null;
  price_display: string | null;
  description: string | null;
  image_url: string | null;
  agency: string | null;
  first_seen_at: string;
  last_seen_at: string;
  missed_count: number;
  removed_at: string | null;
}

export interface StoredListing extends Listing {
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
}

function toListing(row: ListingRow): Listing {
  return {
    id: row.listing_id,
    url: row.url,
    title: row.title,
    dealType: row.deal_type,
    propertyType: row.property_type,
    rooms: row.rooms,
    sizeM2: row.size_m2 === null ? null : Number(row.size_m2),
    year: row.year,
    floor: row.floor,
    price: row.price === null ? null : Number(row.price),
    pricePerM2: row.price_per_m2 === null ? null : Number(row.price_per_m2),
    priceDisplay: row.price_display,
    description: row.description,
    imageUrl: row.image_url,
    agency: row.agency,
  };
}

function toStored(row: ListingRow): StoredListing {
  return {
    ...toListing(row),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    removedAt: row.removed_at,
  };
}

export class ListingRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Primerja sveže pobrane oglase z bazo: nove vstavi, spremembe cene zabeleži,
   * ostalim osveži last_seen. Če detectRemovals, oglase, ki po REMOVE_THRESHOLD
   * obhodih izginejo, označi za umaknjene/prodane. detectRemovals naj bo false ob
   * praznem/blokiranem zajemu, da po nesreči ne pobrišemo vsega.
   */
  applyCrawl(watchId: number, listings: Listing[], detectRemovals = true): DiffResult {
    const now = new Date().toISOString();
    const result: DiffResult = { newListings: [], priceChanges: [], removed: [], relisted: [] };
    const crawledIds = new Set(listings.map((listing) => listing.id));

    const selectExisting = this.db.prepare(
      "SELECT price, removed_at FROM listings WHERE watch_id = ? AND listing_id = ?",
    );
    const insert = this.db.prepare(
      `INSERT INTO listings (
         watch_id, listing_id, url, title, deal_type, property_type, rooms,
         size_m2, year, floor, price, price_per_m2, price_display, description,
         image_url, agency, first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // ob ponovni pojavitvi oglas spet aktiviramo (missed_count=0, removed_at=NULL)
    const update = this.db.prepare(
      `UPDATE listings SET
         url = ?, title = ?, price = ?, price_per_m2 = ?, price_display = ?,
         description = ?, image_url = ?, last_seen_at = ?, missed_count = 0, removed_at = NULL
       WHERE watch_id = ? AND listing_id = ?`,
    );
    const insertPrice = this.db.prepare(
      "INSERT INTO price_history (watch_id, listing_id, price, observed_at) VALUES (?, ?, ?, ?)",
    );
    const selectActive = this.db.prepare(
      "SELECT * FROM listings WHERE watch_id = ? AND removed_at IS NULL",
    );
    const bumpMissed = this.db.prepare(
      "UPDATE listings SET missed_count = ? WHERE watch_id = ? AND listing_id = ?",
    );
    const markRemoved = this.db.prepare(
      "UPDATE listings SET removed_at = ? WHERE watch_id = ? AND listing_id = ?",
    );

    transaction(this.db, () => {
      for (const listing of listings) {
        const existing = selectExisting.get(watchId, listing.id) as
          | { price: number | null; removed_at: string | null }
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
            listing.pricePerM2,
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
          listing.pricePerM2,
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
        if (priceChanged) insertPrice.run(watchId, listing.id, listing.price, now);

        // vrnjen oglas javimo enkrat, s staro ceno v istem obvestilu, ne še posebej kot spremembo cene
        if (existing.removed_at !== null) {
          result.relisted.push({
            listing,
            removedAt: existing.removed_at,
            oldPrice: priceChanged ? oldPrice : null,
          });
        } else if (priceChanged) {
          result.priceChanges.push({
            listing,
            oldPrice: oldPrice!,
            newPrice: listing.price!,
          });
        }
      }

      if (detectRemovals) {
        const active = selectActive.all(watchId) as unknown as ListingRow[];
        for (const row of active) {
          if (crawledIds.has(row.listing_id)) continue;
          const missed = Number(row.missed_count) + 1;
          if (missed >= REMOVE_THRESHOLD) {
            markRemoved.run(now, watchId, row.listing_id);
            result.removed.push(toListing(row));
          } else {
            bumpMissed.run(missed, watchId, row.listing_id);
          }
        }
      }
    });

    return result;
  }

  /**
   * Povzetek dogajanja od `since` naprej: novi, umaknjeni, spremembe cene in mediana €/m²
   * novih oglasov v primerjavi s prejšnjim, enako dolgim obdobjem (`prevSince`..`since`).
   * Izhodiščni posnetek (prvi obhod) ne šteje med nove: vsi njegovi oglasi delijo isti first_seen_at.
   */
  recap(watchId: number, since: string, prevSince: string): RecapStats {
    const seedFilter = "first_seen_at > (SELECT MIN(first_seen_at) FROM listings WHERE watch_id = ?)";
    const count = (sql: string, ...params: (string | number)[]) =>
      Number((this.db.prepare(sql).get(...params) as { n: number }).n);

    const added = count(
      `SELECT COUNT(*) AS n FROM listings WHERE watch_id = ? AND first_seen_at >= ? AND ${seedFilter}`,
      watchId, since, watchId,
    );
    const removed = count(
      "SELECT COUNT(*) AS n FROM listings WHERE watch_id = ? AND removed_at >= ?",
      watchId, since,
    );
    const active = count(
      "SELECT COUNT(*) AS n FROM listings WHERE watch_id = ? AND removed_at IS NULL",
      watchId,
    );

    // prva vrstica v zgodovini je začetna cena, sprememba je šele vsaka naslednja
    const changes = this.db
      .prepare(
        `SELECT price, prev FROM (
           SELECT price, observed_at,
                  LAG(price) OVER (PARTITION BY listing_id ORDER BY observed_at, id) AS prev
           FROM price_history WHERE watch_id = ?
         ) WHERE prev IS NOT NULL AND observed_at >= ?`,
      )
      .all(watchId, since) as unknown as { price: number; prev: number }[];
    let drops = 0;
    let raises = 0;
    let pctSum = 0;
    for (const { price, prev } of changes) {
      if (price < prev) drops++;
      else raises++;
      pctSum += (price - prev) / prev;
    }

    const medianNew = (from: string, to: string | null) =>
      this.db
        .prepare(
          `SELECT price_per_m2 AS v FROM listings
           WHERE watch_id = ? AND price_per_m2 IS NOT NULL AND first_seen_at >= ?
             AND (? IS NULL OR first_seen_at < ?) AND ${seedFilter}`,
        )
        .all(watchId, from, to, to, watchId)
        .map((row) => Number((row as { v: number }).v));

    return {
      added,
      removed,
      active,
      priceChanges: changes.length,
      drops,
      raises,
      avgChangePct: changes.length > 0 ? (pctSum / changes.length) * 100 : null,
      medianPpm2New: medianOfSample(medianNew(since, null)),
      medianPpm2Prev: medianOfSample(medianNew(prevSince, since)),
    };
  }

  // vsi oglasi iskanja (tudi umaknjeni), ali samo aktivni
  listings(watchId: number, activeOnly = false): StoredListing[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM listings WHERE watch_id = ? ${activeOnly ? "AND removed_at IS NULL" : ""}
         ORDER BY first_seen_at, listing_id`,
      )
      .all(watchId) as unknown as ListingRow[];
    return rows.map(toStored);
  }

  allPriceHistory(watchId: number): (PriceHistoryEntry & { listingId: string; title: string })[] {
    const rows = this.db
      .prepare(
        `SELECT h.listing_id, l.title, h.price, h.observed_at
         FROM price_history h JOIN listings l ON l.watch_id = h.watch_id AND l.listing_id = h.listing_id
         WHERE h.watch_id = ? ORDER BY h.observed_at, h.id`,
      )
      .all(watchId) as unknown as { listing_id: string; title: string; price: number; observed_at: string }[];
    return rows.map((row) => ({
      listingId: row.listing_id,
      title: row.title,
      price: Number(row.price),
      observedAt: row.observed_at,
    }));
  }

  getListing(watchId: number, listingId: string): StoredListing | null {
    const row = this.db
      .prepare("SELECT * FROM listings WHERE watch_id = ? AND listing_id = ?")
      .get(watchId, listingId) as ListingRow | undefined;
    return row ? toStored(row) : null;
  }

  priceHistory(watchId: number, listingId: string): PriceHistoryEntry[] {
    const rows = this.db
      .prepare(
        "SELECT price, observed_at FROM price_history WHERE watch_id = ? AND listing_id = ? ORDER BY observed_at",
      )
      .all(watchId, listingId) as unknown as { price: number; observed_at: string }[];
    return rows.map((row) => ({ price: Number(row.price), observedAt: row.observed_at }));
  }
}
