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
  const watch = watches.create("test", "https://www.nepremicnine.net/x/", 3, "123");
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
