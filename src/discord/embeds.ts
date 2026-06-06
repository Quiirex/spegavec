import { EmbedBuilder } from "discord.js";
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
  add("Velikost", listing.sizeM2 !== null ? `${listing.sizeM2} m²` : null);
  add("Sobe", listing.rooms);
  add("Leto", listing.year);
  add("Nadstropje", listing.floor);
  add("Agencija", listing.agency);
  return fields;
}

export function newListingEmbed(watch: Watch, listing: Listing): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setAuthor({ name: `Nov oglas · ${watch.name}` })
    .setTitle(listing.title)
    .setURL(listing.url)
    .addFields(listingFields(listing))
    .setTimestamp();
  if (listing.description) embed.setDescription(listing.description.slice(0, 300));
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
