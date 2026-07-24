import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseListingPage, parseSearchPage } from "../src/scraper/parser.js";
import { buildSearchUrl, normalizeWatchUrl, pageUrl } from "../src/scraper/urlBuilder.js";

const searchPage = readFileSync(new URL("./fixtures/search-page.html", import.meta.url), "utf8");
const emptyPage = readFileSync(new URL("./fixtures/empty-page.html", import.meta.url), "utf8");
const listingPage = readFileSync(new URL("./fixtures/listing-page.html", import.meta.url), "utf8");

describe("parseSearchPage", () => {
  it("prebere vse oglase na polni strani rezultatov", () => {
    const listings = parseSearchPage(searchPage);
    expect(listings).toHaveLength(25);
  });

  it("izlušči vsa polja prvega oglasa", () => {
    const [first] = parseSearchPage(searchPage);
    expect(first).toMatchObject({
      id: "7355533",
      url: "https://www.nepremicnine.net/oglasi-prodaja/crnuce-lj-bezigrad-stanovanje_7355533/",
      title: "ČRNUČE, LJ. - BEŽIGRAD",
      dealType: "Prodaja",
      propertyType: "Stanovanje",
      rooms: "1-sobno",
      sizeM2: 32.6,
      year: "2008",
      floor: "1/2",
      price: 224000,
      pricePerM2: 6871, // round(224000 / 32.6)
      agency: "Mreža&Partnerji, nepremičnine, d.o.o.",
    });
    expect(first!.imageUrl).toMatch(/^https:\/\/img\.nepremicnine\.net\//);
    expect(first!.description).toContain("32,6 m2");
  });

  it("ceno prebere kot število pri vsakem oglasu, ki jo prikaže", () => {
    const listings = parseSearchPage(searchPage);
    const withPrice = listings.filter((listing) => listing.price !== null);
    expect(withPrice.length).toBeGreaterThan(20);
    for (const listing of withPrice) {
      expect(listing.price).toBeGreaterThan(1000);
    }
  });

  it("vrne nič oglasov na prazni strani", () => {
    expect(parseSearchPage(emptyPage)).toHaveLength(0);
  });
});

describe("parseListingPage", () => {
  it("pobere cel opis s strani oglasa in ohrani odstavke", () => {
    const { description } = parseListingPage(listingPage);
    expect(description).toContain("Prodamo 4-sobni duplex");
    expect(description).toContain("Pred stavbo sta dve parkirni mesti.");
    expect(description).toContain("Ogrevanje: daljinsko");
    expect(description).toMatch(/\n/);
    // izsek na iskalni strani je odrezan pri ~120 znakih, tu pricakujemo bistveno vec
    expect(description!.length).toBeGreaterThan(200);
  });

  it("ne pusti trojnih preskokov vrstic", () => {
    expect(parseListingPage(listingPage).description).not.toMatch(/\n{3,}/);
  });

  it("izlušči kontakt in naslov agencije", () => {
    const details = parseListingPage(listingPage);
    expect(details.contactPhone).toBe("051/690-000");
    expect(details.contactName).toBe("Jasmina Bratož");
    expect(details.agencyAddress).toBe("Tivolska 48, 1000 Ljubljana");
  });

  it("na strani brez podatkov vrne prazno", () => {
    const details = parseListingPage(emptyPage);
    expect(details.description).toBeNull();
    expect(details.contactPhone).toBeNull();
  });
});

describe("buildSearchUrl", () => {
  it("sestavi URL z vsemi filtri", () => {
    const url = buildSearchUrl({
      deal: "prodaja",
      region: "ljubljana-mesto",
      type: "stanovanje",
      rooms: "2-sobno",
      priceMin: 100000,
      priceMax: 250000,
      sizeMin: 50,
      sizeMax: 80,
      yearMin: 2000,
    });
    expect(url).toBe(
      "https://www.nepremicnine.net/oglasi-prodaja/ljubljana-mesto/stanovanje/2-sobno/" +
        "cena-od-100000-do-250000-eur,velikost-od-50-do-80-m2,letnik-od-2000/",
    );
  });

  it("pri oddaji uporabi mesečno ceno", () => {
    const url = buildSearchUrl({
      deal: "oddaja",
      region: "ljubljana-mesto",
      type: "stanovanje",
      priceMax: 900,
    });
    expect(url).toContain("cena-do-900-eur-na-mesec");
  });

  it("izpusti filtrski del, ko ni nobenega razpona", () => {
    const url = buildSearchUrl({ deal: "prodaja", region: "gorenjska", type: "hisa" });
    expect(url).toBe("https://www.nepremicnine.net/oglasi-prodaja/gorenjska/hisa/");
  });
});

describe("pageUrl", () => {
  it("za prvo stran vrne kar sam URL iskanja", () => {
    expect(pageUrl("https://www.nepremicnine.net/x/", 1)).toBe("https://www.nepremicnine.net/x/");
  });

  it("za naslednje strani pripne številko strani", () => {
    expect(pageUrl("https://www.nepremicnine.net/x/", 3)).toBe("https://www.nepremicnine.net/x/3/");
  });
});

describe("normalizeWatchUrl", () => {
  it("sprejme in normalizira URL-je strani", () => {
    expect(normalizeWatchUrl("www.nepremicnine.net/oglasi-prodaja/gorenjska/hisa")).toBe(
      "https://www.nepremicnine.net/oglasi-prodaja/gorenjska/hisa/",
    );
  });

  it("zavrne tuje domene", () => {
    expect(() => normalizeWatchUrl("https://example.com/x")).toThrow(/To ni nepremicnine.net URL/);
  });
});
