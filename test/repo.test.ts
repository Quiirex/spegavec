import { describe, expect, it } from "vitest";
import type { Listing } from "../src/core/types.js";
import { openDatabase } from "../src/store/db.js";
import { ListingRepo, WatchRepo } from "../src/store/repo.js";

function listing(id: string, price: number): Listing {
  return {
    id,
    url: `https://www.nepremicnine.net/oglasi-prodaja/x_${id}/`,
    title: `Listing ${id}`,
    dealType: "Prodaja",
    propertyType: "Stanovanje",
    rooms: "2-sobno",
    sizeM2: 60,
    year: "2010",
    floor: "1/3",
    price,
    pricePerM2: Math.round(price / 60),
    priceDisplay: `${price} €`,
    description: "desc",
    imageUrl: null,
    agency: "Agency",
  };
}

function setup() {
  const db = openDatabase(":memory:");
  const watches = new WatchRepo(db);
  const listings = new ListingRepo(db);
  const watch = watches.create("test", "https://www.nepremicnine.net/x/", "123");
  return { watches, listings, watch };
}

describe("ListingRepo.applyCrawl", () => {
  it("ob prvem obhodu javi vse kot novo", () => {
    const { listings, watch } = setup();
    const diff = listings.applyCrawl(watch.id, [listing("1", 100000), listing("2", 200000)]);
    expect(diff.newListings).toHaveLength(2);
    expect(diff.priceChanges).toHaveLength(0);
  });

  it("ob naslednjih obhodih javi samo nevidene oglase", () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000)]);
    const diff = listings.applyCrawl(watch.id, [listing("1", 100000), listing("2", 200000)]);
    expect(diff.newListings.map((l) => l.id)).toEqual(["2"]);
    expect(diff.priceChanges).toHaveLength(0);
  });

  it("zazna spremembe cene", () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000)]);
    const diff = listings.applyCrawl(watch.id, [listing("1", 95000)]);
    expect(diff.newListings).toHaveLength(0);
    expect(diff.priceChanges).toEqual([
      expect.objectContaining({ oldPrice: 100000, newPrice: 95000 }),
    ]);
  });

  it("prešteje sledene oglase na iskanje", () => {
    const { watches, listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 1500), listing("2", 2500)]);
    expect(watches.listingCount(watch.id)).toBe(2);
  });

  it("oglas označi za umaknjenega šele po dveh manjkajočih obhodih", () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000), listing("2", 200000)]);

    // 1. obhod brez oglasa 2: še ne umaknjen (samo missed_count++)
    const first = listings.applyCrawl(watch.id, [listing("1", 100000)]);
    expect(first.removed).toHaveLength(0);

    // 2. obhod brez oglasa 2: zdaj umaknjen
    const second = listings.applyCrawl(watch.id, [listing("1", 100000)]);
    expect(second.removed.map((l) => l.id)).toEqual(["2"]);

    // umaknjen se ne javi znova
    const third = listings.applyCrawl(watch.id, [listing("1", 100000)]);
    expect(third.removed).toHaveLength(0);
  });

  it("ponovno pojavljen oglas se aktivira nazaj in ne ostane umaknjen", () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000), listing("2", 200000)]);
    listings.applyCrawl(watch.id, [listing("1", 100000)]);
    listings.applyCrawl(watch.id, [listing("1", 100000)]); // oglas 2 umaknjen
    expect(listings.getListing(watch.id, "2")?.removedAt).not.toBeNull();

    // spet se pojavi
    const diff = listings.applyCrawl(watch.id, [listing("1", 100000), listing("2", 200000)]);
    expect(listings.getListing(watch.id, "2")?.removedAt).toBeNull();
    expect(diff.newListings).toHaveLength(0);
    expect(diff.relisted.map((r) => r.listing.id)).toEqual(["2"]);
    expect(diff.relisted[0]?.removedAt).toBeTruthy();
    expect(diff.relisted[0]?.oldPrice).toBeNull();
  });

  it("vrnjen oglas z novo ceno javi staro ceno v isti postavki, ne kot spremembo cene", () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000), listing("2", 200000)]);
    listings.applyCrawl(watch.id, [listing("1", 100000)]);
    listings.applyCrawl(watch.id, [listing("1", 100000)]); // oglas 2 umaknjen

    const diff = listings.applyCrawl(watch.id, [listing("1", 100000), listing("2", 180000)]);
    expect(diff.priceChanges).toHaveLength(0);
    expect(diff.relisted).toHaveLength(1);
    expect(diff.relisted[0]?.oldPrice).toBe(200000);
    expect(listings.priceHistory(watch.id, "2").map((h) => h.price)).toEqual([200000, 180000]);
  });

  it("ne zaznava umaknjenih, če je zajem prazen (detectRemovals=false)", () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000)]);
    const diff = listings.applyCrawl(watch.id, [], false);
    expect(diff.removed).toHaveLength(0);
    expect(listings.getListing(watch.id, "1")?.removedAt).toBeNull();
  });

  it("hrani zgodovino cene", () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000)]);
    listings.applyCrawl(watch.id, [listing("1", 95000)]);
    const history = listings.priceHistory(watch.id, "1");
    expect(history.map((h) => h.price)).toEqual([100000, 95000]);
  });
});

describe("ListingRepo.recap", () => {
  const longAgo = "2000-01-01T00:00:00.000Z";
  const evenLonger = "1999-01-01T00:00:00.000Z";
  const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

  it("sešteje nove, umaknjene in spremembe cene; izhodiščni posnetek ne šteje med nove", async () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000), listing("2", 200000), listing("3", 300000)]);
    await tick();
    // 4 nov, 1 podražen, 2 pocenjen, 3 izgine
    listings.applyCrawl(watch.id, [listing("1", 110000), listing("2", 180000), listing("4", 400000)]);
    listings.applyCrawl(watch.id, [listing("1", 110000), listing("2", 180000), listing("4", 400000)]);

    const s = listings.recap(watch.id, longAgo, evenLonger);
    expect(s.added).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.active).toBe(3);
    expect(s.priceChanges).toBe(2);
    expect(s.drops).toBe(1);
    expect(s.raises).toBe(1);
    expect(s.avgChangePct).toBeCloseTo(0, 5); // +10 % in −10 %
  });

  it("izven obdobja ne šteje nič", () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000)]);
    listings.applyCrawl(watch.id, [listing("1", 90000)]);
    const s = listings.recap(watch.id, "2999-01-01T00:00:00.000Z", "2998-01-01T00:00:00.000Z");
    expect(s.added).toBe(0);
    expect(s.priceChanges).toBe(0);
    expect(s.avgChangePct).toBeNull();
    expect(s.medianPpm2New).toBeNull();
  });
});

describe("ListingRepo.listings / allPriceHistory", () => {
  it("vrne vse ali samo aktivne oglase in celotno zgodovino cen", () => {
    const { listings, watch } = setup();
    listings.applyCrawl(watch.id, [listing("1", 100000), listing("2", 200000)]);
    listings.applyCrawl(watch.id, [listing("1", 90000)]);
    listings.applyCrawl(watch.id, [listing("1", 90000)]); // oglas 2 umaknjen

    expect(listings.listings(watch.id).map((l) => l.id)).toEqual(["1", "2"]);
    expect(listings.listings(watch.id, true).map((l) => l.id)).toEqual(["1"]);
    expect(listings.listings(watch.id)[1]?.removedAt).not.toBeNull();

    const history = listings.allPriceHistory(watch.id);
    expect(history.map((h) => [h.listingId, h.price])).toEqual([["1", 100000], ["2", 200000], ["1", 90000]]);
    expect(history[0]?.title).toBe("Listing 1");
  });
});

describe("WatchRepo", () => {
  it("ustavi, nadaljuje in odstrani iskanja", () => {
    const { watches } = setup();
    expect(watches.setPaused("test", true)).toBe(true);
    expect(watches.active()).toHaveLength(0);
    expect(watches.setPaused("test", false)).toBe(true);
    expect(watches.remove("test")).toBe(true);
    expect(watches.all()).toHaveLength(0);
  });
});
