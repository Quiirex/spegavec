import { EmbedBuilder } from "discord.js";
import { isGoodDeal } from "../core/stats.js";
import type { Listing, PriceChange, Watch } from "../core/types.js";

const eur = new Intl.NumberFormat("sl-SI", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function listingFields(listing: Listing): { name: string; value: string; inline: boolean }[] {
  const fields: { name: string; value: string; inline: boolean }[] = [];
  const add = (name: string, value: string | null) => {
    if (value) fields.push({ name, value, inline: true });
  };
  add("Cena", listing.price !== null ? eur.format(listing.price) : listing.priceDisplay);
  add("€/m²", listing.pricePerM2 !== null ? eur.format(listing.pricePerM2) : null);
  add("Velikost", listing.sizeM2 !== null ? `${listing.sizeM2} m²` : null);
  add("Sobe", listing.rooms);
  add("Leto", listing.year);
  add("Nadstropje", listing.floor);
  const address = listing.details?.agencyAddress;
  add("Agencija", listing.agency && address ? `${listing.agency}\n${address}` : listing.agency);
  const { contactName, contactPhone } = listing.details ?? {};
  if (contactPhone) {
    add("Kontakt", contactName ? `${contactName}\n${contactPhone}` : contactPhone);
  }
  return fields;
}

export function newListingEmbed(
  watch: Watch,
  listing: Listing,
  medianPpm2: number | null,
): EmbedBuilder {
  const goodDeal = isGoodDeal(listing, medianPpm2);
  const embed = new EmbedBuilder()
    .setColor(goodDeal ? 0xf1c40f : 0x2ecc71)
    .setAuthor({ name: `${goodDeal ? "🟢 Dober posel" : "Nov oglas"} · ${watch.name}` })
    .setTitle(listing.title)
    .setURL(listing.url)
    .addFields(listingFields(listing))
    .setTimestamp();

  const parts: string[] = [];
  if (goodDeal && medianPpm2 !== null && listing.pricePerM2 !== null) {
    const below = Math.round((1 - listing.pricePerM2 / medianPpm2) * 100);
    parts.push(`💸 **${below} % pod** mediano iskanja (${eur.format(medianPpm2)}/m²)`);
  }
  // kratek izsek opisa; cel opis je klik stran, embed pa naj ostane pregleden
  if (listing.description) parts.push(excerpt(listing.description, 500));
  if (parts.length > 0) embed.setDescription(parts.join("\n\n"));
  if (listing.imageUrl) embed.setImage(listing.imageUrl);
  return embed;
}

export function priceChangeEmbed(watch: Watch, change: PriceChange): EmbedBuilder {
  const { listing, oldPrice, newPrice } = change;
  const drop = newPrice < oldPrice;
  const pct = Math.abs(((newPrice - oldPrice) / oldPrice) * 100).toFixed(1);
  const embed = new EmbedBuilder()
    .setColor(drop ? 0xe67e22 : 0xe74c3c)
    .setAuthor({ name: `${drop ? "Cena znižana" : "Cena zvišana"} · ${watch.name}` })
    .setTitle(listing.title)
    .setURL(listing.url)
    .setDescription(`${eur.format(oldPrice)} → **${eur.format(newPrice)}** (${drop ? "−" : "+"}${pct} %)`)
    .addFields(listingFields(listing).filter((field) => field.name !== "Cena"))
    .setTimestamp();
  if (listing.imageUrl) embed.setThumbnail(listing.imageUrl);
  return embed;
}

// odreže na zadnjem presledku pred mejo, da ne seka besed
function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
