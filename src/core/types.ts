export interface Listing {
  // ID je v URL-ju (..._7355533/), zato se ga držimo za dedup namesto naslova
  id: string;
  url: string;
  title: string;
  dealType: string | null;
  propertyType: string | null;
  rooms: string | null;
  sizeM2: number | null;
  year: string | null;
  floor: string | null;
  price: number | null;
  priceDisplay: string | null;
  // cena/m², izračunana ko sta na voljo price in sizeM2
  pricePerM2: number | null;
  description: string | null;
  imageUrl: string | null;
  agency: string | null;
}

export interface Watch {
  id: number;
  name: string;
  url: string;
  channelId: string;
  paused: boolean;
  createdAt: string;
  lastPolledAt: string | null;
  lastStatus: string | null;
}

export interface PriceChange {
  listing: Listing;
  oldPrice: number;
  newPrice: number;
}

export interface PollResult {
  watch: Watch;
  // prvi obhod samo posname obstoječe oglase, da te ne zasuje
  seeded: boolean;
  totalSeen: number;
  newListings: Listing[];
  priceChanges: PriceChange[];
  // oglasi, ki so izginili (verjetno prodani/umaknjeni)
  removed: Listing[];
  // mediana €/m² čez celoten zajem; podlaga za oznako "dober posel"
  medianPricePerM2: number | null;
}

export interface PriceHistoryEntry {
  price: number;
  observedAt: string;
}

export interface SearchFilters {
  deal: "prodaja" | "oddaja";
  region: string;
  type: "stanovanje" | "hisa" | "vikend" | "posest" | "poslovni-prostor" | "garaza";
  rooms?: string;
  priceMin?: number;
  priceMax?: number;
  sizeMin?: number;
  sizeMax?: number;
  yearMin?: number;
  yearMax?: number;
}
