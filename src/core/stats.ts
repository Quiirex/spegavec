import type { Listing } from "./types.js";

// oglas pod tem deležem mediane €/m² velja za "dober posel"
export const GOOD_DEAL_RATIO = 0.85;

// premajhen vzorec da nezanesljivo mediano, zato pod tem ne označujemo nič
const MIN_SAMPLE = 5;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Mediana €/m² čez oglase, ki imajo izračunan pricePerM2 (ali null pri premajhnem vzorcu). */
export function medianPricePerM2(listings: Listing[]): number | null {
  const values = listings
    .map((listing) => listing.pricePerM2)
    .filter((value): value is number => value !== null);
  return medianOfSample(values);
}

/** Mediana, a le pri dovolj velikem vzorcu (sicer null). */
export function medianOfSample(values: number[]): number | null {
  if (values.length < MIN_SAMPLE) return null;
  return median(values);
}

export function isGoodDeal(listing: Listing, medianPpm2: number | null): boolean {
  return (
    medianPpm2 !== null &&
    listing.pricePerM2 !== null &&
    listing.pricePerM2 <= medianPpm2 * GOOD_DEAL_RATIO
  );
}
