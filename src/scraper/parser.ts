import * as cheerio from 'cheerio';
import type { Listing, ListingDetails } from '../core/types.js';

const AD_ID_PATTERN = /_(\d+)\/?$/;

function parseSlovenianNumber(text: string): number | null {
  const match = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/.exec(text);
  if (!match) return null;
  const value = Number.parseFloat(
    match[0].replace(/\./g, '').replace(',', '.'),
  );
  return Number.isFinite(value) ? value : null;
}

function cleanText(text: string | undefined): string | null {
  const cleaned = text?.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned : null;
}

// iskalna stran da samo odrezan izsek in eno sliko; ostalo je na strani oglasa
export function parseListingPage(html: string): ListingDetails {
  const $ = cheerio.load(html);

  const phoneLink = $("a[href^='tel:']").first();
  const phone = cleanText(phoneLink.attr('href')?.replace(/^tel:/, ''));
  // napis je oblike "041/123-456 (Janez Novak)"
  const contactName = cleanText(/\(([^)]+)\)/.exec(phoneLink.text())?.[1]);

  return {
    description: parseListingDescription($),
    contactName,
    contactPhone: phone,
    agencyAddress: cleanText($('.category-property .agent-info p').first().text()),
  };
}

function parseListingDescription($: cheerio.CheerioAPI): string | null {
  const box = $("div[itemprop='disambiguatingDescription']").first();
  if (box.length === 0) return null;

  // brez tega se odstavki zlijejo v eno kepo besedila
  box.find('br').replaceWith('\n');
  box.find('p, div, li').each((_, node) => {
    $(node).after('\n');
  });

  const text = box
    .text()
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text : null;
}

export function parseSearchPage(
  html: string,
  baseUrl = 'https://www.nepremicnine.net',
): Listing[] {
  const $ = cheerio.load(html);
  const listings: Listing[] = [];

  $('div.property-box').each((_, box) => {
    const $box = $(box);
    const details = $box.find('div.property-details').first();

    const href =
      details.attr('data-href') ??
      details.find('a.url-title-d').attr('href') ??
      $box.find("a[href*='_']").attr('href');
    if (!href) return;

    const url = href.startsWith('http') ? href : new URL(href, baseUrl).href;
    const id = AD_ID_PATTERN.exec(url)?.[1];
    if (!id) return;

    const title =
      cleanText(details.find('a.url-title-d').attr('title')) ??
      cleanText(details.find('h2').first().text());

    // oblika: "Prodaja: Stanovanje, <span class=tipi>2-sobno</span>"
    const typeLine = cleanText(details.find('span.font-roboto').first().text());
    const typeMatch = typeLine ? /^([^:]+):\s*([^,]+)/.exec(typeLine) : null;
    const rooms = cleanText(details.find('span.tipi').first().text());

    let sizeM2: number | null = null;
    let year: string | null = null;
    let floor: string | null = null;
    details
      .find("ul[itemprop='disambiguatingDescription'] li")
      .each((_, li) => {
        const $li = $(li);
        const icon = $li.find('img').attr('src') ?? '';
        const text = cleanText($li.text());
        if (!text) return;
        if (icon.includes('velikost')) sizeM2 = parseSlovenianNumber(text);
        else if (icon.includes('leto')) year = text;
        else if (icon.includes('nadstropje')) floor = text;
      });

    const priceMeta = details.find("meta[itemprop='price']").attr('content');
    const rawPrice = priceMeta ? Number.parseFloat(priceMeta) : null;
    const price = rawPrice !== null && Number.isFinite(rawPrice) ? rawPrice : null;

    const pricePerM2 =
      price !== null && sizeM2 !== null && sizeM2 > 0 ? Math.round(price / sizeM2) : null;

    const imageSrc = $box
      .find('.slider-for img, .property-image img')
      .first()
      .attr('data-src');

    listings.push({
      id,
      url,
      title: title ?? `Oglas ${id}`,
      dealType: cleanText(typeMatch?.[1]),
      propertyType: cleanText(typeMatch?.[2]),
      rooms,
      sizeM2,
      year,
      floor,
      price,
      pricePerM2,
      priceDisplay: cleanText(details.find('h6').first().text()),
      description: cleanText(
        details.find("p[itemprop='description']").first().text(),
      ),
      imageUrl: imageSrc ?? null,
      agency: cleanText(details.find("meta[itemprop='name']").attr('content')),
    });
  });

  return listings;
}
