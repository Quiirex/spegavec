import { describe, expect, it } from "vitest";
import type { Listing } from "../src/core/types.js";
import { isGoodDeal, median, medianPricePerM2 } from "../src/core/stats.js";

function withPpm2(id: string, ppm2: number | null): Listing {
  return {
    id,
    url: "x",
    title: "x",
    dealType: null,
    propertyType: null,
    rooms: null,
    sizeM2: null,
    year: null,
    floor: null,
    price: null,
    pricePerM2: ppm2,
    priceDisplay: null,
    description: null,
    imageUrl: null,
    agency: null,
  };
}

describe("median", () => {
  it("liho število", () => expect(median([3, 1, 2])).toBe(2));
  it("sodo število je povprečje sredine", () => expect(median([1, 2, 3, 4])).toBe(2.5));
  it("prazno vrne null", () => expect(median([])).toBeNull());
});

describe("medianPricePerM2", () => {
  it("vrne null pod minimalnim vzorcem (< 5)", () => {
    const listings = [1000, 2000, 3000].map((p, i) => withPpm2(String(i), p));
    expect(medianPricePerM2(listings)).toBeNull();
  });

  it("upošteva samo oglase z €/m² in vrne mediano", () => {
    const listings = [
      ...[1000, 2000, 3000, 4000, 5000].map((p, i) => withPpm2(String(i), p)),
      withPpm2("brez", null),
    ];
    expect(medianPricePerM2(listings)).toBe(3000);
  });
});

describe("isGoodDeal", () => {
  it("oglas dovolj pod mediano je dober posel", () => {
    expect(isGoodDeal(withPpm2("x", 2000), 3000)).toBe(true); // 2000 <= 3000*0.85=2550
  });
  it("oglas blizu mediane ni dober posel", () => {
    expect(isGoodDeal(withPpm2("x", 2800), 3000)).toBe(false);
  });
  it("brez mediane ali brez €/m² ni dober posel", () => {
    expect(isGoodDeal(withPpm2("x", 2000), null)).toBe(false);
    expect(isGoodDeal(withPpm2("x", null), 3000)).toBe(false);
  });
});
