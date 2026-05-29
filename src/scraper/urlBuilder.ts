import type { SearchFilters } from "../core/types.js";

const BASE = "https://www.nepremicnine.net";

function rangeSegment(unit: string, min?: number, max?: number): string | null {
  if (min !== undefined && max !== undefined) return `${unit}-od-${min}-do-${max}`;
  if (min !== undefined) return `${unit}-od-${min}`;
  if (max !== undefined) return `${unit}-do-${max}`;
  return null;
}

// sestavljeno tak, kot to dela iskalnik na strani: segmenti v poti, filtri pa z vejico skupaj
// npr. .../stanovanje/2-sobno/cena-od-100000-do-250000-eur,velikost-od-50-do-80-m2/
export function buildSearchUrl(filters: SearchFilters): string {
  const parts = [`oglasi-${filters.deal}`, filters.region, filters.type];
  if (filters.rooms) parts.push(filters.rooms);

  const priceUnit = filters.deal === "oddaja" ? "eur-na-mesec" : "eur";
  const price = rangeSegment("cena", filters.priceMin, filters.priceMax);
  const size = rangeSegment("velikost", filters.sizeMin, filters.sizeMax);
  const year = rangeSegment("letnik", filters.yearMin, filters.yearMax);

  const filterSegments = [
    price ? `${price}-${priceUnit}` : null,
    size ? `${size}-m2` : null,
    year,
  ].filter((segment): segment is string => segment !== null);

  if (filterSegments.length > 0) parts.push(filterSegments.join(","));

  return `${BASE}/${parts.join("/")}/`;
}

// stran ima stranjenje kot .../2/
export function pageUrl(searchUrl: string, page: number): string {
  const normalized = searchUrl.endsWith("/") ? searchUrl : `${searchUrl}/`;
  return page <= 1 ? normalized : `${normalized}${page}/`;
}

// dovolimo tudi prilepljen URL brez protokola, samo da je z nepremicnine.net
export function normalizeWatchUrl(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  if (!url.hostname.endsWith("nepremicnine.net")) {
    throw new Error(`To ni nepremicnine.net URL: ${input}`);
  }
  url.protocol = "https:";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}
