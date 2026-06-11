import type { Listing } from "../core/types.js";
import { log } from "../log.js";
import type { Fetcher } from "./fetcher.js";
import { parseSearchPage } from "./parser.js";
import { pageUrl } from "./urlBuilder.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

// varovalka proti pobegu, če bi se zaznavanje konca pokvarilo (100 strani = 2500 oglasov)
const MAX_PAGES = 100;

// gre čez vse strani filtra; stran preusmeri previsoke številke nazaj na prvo,
// zato neham, ko se oglasi začnejo ponavljat oz. ko zmanjka rezultatov
export async function crawlSearch(
  fetcher: Fetcher,
  searchUrl: string,
  label = "",
): Promise<Listing[]> {
  const tag = label ? `[${label}] ` : "";
  const byId = new Map<string, Listing>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) {
      await sleep(jitter(2_000, 5_000));
    }
    const html = await fetcher.fetchHtml(pageUrl(searchUrl, page));
    const listings = parseSearchPage(html);
    if (listings.length === 0) break;

    const newOnPage = listings.filter((listing) => !byId.has(listing.id));
    if (newOnPage.length === 0) break;
    for (const listing of newOnPage) {
      byId.set(listing.id, listing);
    }
    log.debug(`${tag}stran ${page}: ${listings.length} oglasov (skupaj ${byId.size})`);
    // kratka stran pomeni zadnjo stran, nima smisla naprej tečt
    if (listings.length < 20) break;
  }

  return [...byId.values()];
}
