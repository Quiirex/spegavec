import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  type AutocompleteInteraction,
  type EmbedBuilder,
  type SendableChannels,
} from 'discord.js';
import { Agent, FormData as UndiciFormData, fetch as undiciFetch } from 'undici';
import type { Config } from '../config.js';
import type { Poller } from '../core/poller.js';
import type { PollResult, SearchFilters, Watch } from '../core/types.js';
import { log } from '../log.js';
import type { Fetcher } from '../scraper/fetcher.js';
import { parseSearchPage } from '../scraper/parser.js';
import { buildSearchUrl, normalizeWatchUrl } from '../scraper/urlBuilder.js';
import { toCsv } from '../core/csv.js';
import { medianPricePerM2 } from '../core/stats.js';
import type { ListingRepo, RecapStats, WatchRepo } from '../store/repo.js';
import { buildCommands, REGIONS } from './commands.js';
import { newListingEmbed, priceChangeEmbed, relistedEmbed } from './embeds.js';

const WATCH_NAME_PATTERN = /^[\w-]{1,32}$/;

interface UploadFile {
  name: string;
  data: Buffer;
  type: string;
}

interface EmbedItem {
  embed: EmbedBuilder;
  imageUrl: string | null;
  thumb: boolean;
}

// Discord dovoli 10 embedov in 10 priponk na sporočilo
const MAX_PER_MESSAGE = 10;

const RECAP_PERIODS = {
  teden: { days: 7, label: 'teden' },
  mesec: { days: 30, label: 'mesec' },
  leto: { days: 365, label: 'leto' },
} as const;

// smer cen: najprej iz dejanskih sprememb cen, sicer iz mediane novih oglasov proti prejšnjemu obdobju
function priceTrend(s: RecapStats): string {
  let signal: number | null = null;
  if (s.avgChangePct !== null) signal = s.avgChangePct;
  else if (s.medianPpm2New !== null && s.medianPpm2Prev !== null) {
    signal = ((s.medianPpm2New - s.medianPpm2Prev) / s.medianPpm2Prev) * 100;
  }
  if (signal === null) return 'premalo podatkov';
  if (signal <= -1) return '📉 padajo';
  if (signal >= 1) return '📈 rastejo';
  return '➡️ stabilne';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const EUR = new Intl.NumberFormat('sl-SI', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

export class Bot {
  readonly client: Client;

  constructor(
    private readonly config: Config,
    private readonly watches: WatchRepo,
    private readonly listings: ListingRepo,
    private readonly fetcher: Fetcher,
    private readonly getPoller: () => Poller,
  ) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
      // privzetih 15 s je pretesnih za nalaganje slik z domače povezave
      rest: { timeout: 45_000 },
    });
    this.client.on('interactionCreate', (interaction) => {
      if (interaction.isChatInputCommand()) {
        void this.handleCommand(interaction).catch((error) => {
          log.error(
            `ukaz ni uspel: ${error instanceof Error ? error.message : error}`,
          );
        });
      } else if (interaction.isAutocomplete()) {
        void this.handleAutocomplete(interaction).catch(() => undefined);
      }
    });
  }

  async start(): Promise<void> {
    await this.client.login(this.config.discordToken);
    await new Promise<void>((resolve) => {
      if (this.client.isReady()) return resolve();
      this.client.once('clientReady', () => resolve());
    });
    await this.registerCommands();
    log.info(`Prijavljen kot ${this.client.user?.tag}`);
  }

  private async registerCommands(): Promise<void> {
    const rest = new REST().setToken(this.config.discordToken);
    const appId = this.client.application!.id;
    const body = buildCommands();
    if (this.config.discordGuildId) {
      await rest.put(
        Routes.applicationGuildCommands(appId, this.config.discordGuildId),
        { body },
      );
    } else {
      await rest.put(Routes.applicationCommands(appId), { body });
    }
  }

  async notify(result: PollResult): Promise<void> {
    if (
      result.newListings.length === 0 &&
      result.priceChanges.length === 0 &&
      result.relisted.length === 0
    )
      return;
    // umaknjene/prodane oglase zaznamo in shranimo (za /zgodovina), a v kanal ne trobimo
    const items: EmbedItem[] = [
      ...result.newListings.map((listing) => ({
        embed: newListingEmbed(result.watch, listing, result.medianPricePerM2),
        imageUrl: listing.imageUrl,
        thumb: false,
      })),
      ...result.priceChanges.map((change) => ({
        embed: priceChangeEmbed(result.watch, change),
        imageUrl: change.listing.imageUrl,
        thumb: true,
      })),
      ...result.relisted.map((item) => ({
        embed: relistedEmbed(result.watch, item),
        imageUrl: item.listing.imageUrl,
        thumb: true,
      })),
    ];
    await this.sendItems(result.watch.channelId, items);
  }

  async notifyText(channelId: string, message: string): Promise<void> {
    const channel = await this.fetchSendable(channelId);
    await channel?.send(message);
  }

  // slike host je za Cloudflareom, Discordov proxy jih ne dobi; poberemo jih sami in priložimo kot datoteko
  private async sendItems(channelId: string, items: EmbedItem[]): Promise<void> {
    const channel = await this.fetchSendable(channelId);
    if (!channel) return;
    for (let i = 0; i < items.length; i += MAX_PER_MESSAGE) {
      const batch = items.slice(i, i + MAX_PER_MESSAGE);
      const files: UploadFile[] = [];
      await Promise.all(
        batch.map(async (item, j) => {
          if (!item.imageUrl) return;
          try {
            const buffer = await this.fetcher.fetchImage(item.imageUrl);
            const name = `oglas-${i + j}.jpg`;
            files.push({ name, data: buffer, type: 'image/jpeg' });
            const ref = `attachment://${name}`;
            if (item.thumb) item.embed.setThumbnail(ref);
            else item.embed.setImage(ref);
          } catch (error) {
            // hotlink ni rezerva, ampak zagotovljena polomljena slika (Discordov proxy dobi Cloudflare challenge),
            // zato ga rajši vržemo ven; sporočilo gre naprej brez slike
            if (item.thumb) item.embed.setThumbnail(null);
            else item.embed.setImage(null);
            log.warn(
              `slike ${item.imageUrl} ni bilo mogoče pobrati: ${error instanceof Error ? error.message : error}`,
            );
          }
        }),
      );
      const embeds = batch.map((item) => item.embed);
      if (files.length > 0 && (await this.uploadWithRetry(channelId, embeds, files))) continue;
      if (files.length > 0) {
        // brez slik je bolje kot brez obvestila
        log.warn('slik ne morem naložiti, pošiljam obvestilo brez njih');
        for (const embed of embeds) embed.setImage(null).setThumbnail(null);
      }
      await channel.send({ embeds });
    }
  }

  // V dolgo živečem procesu se v skupnem undici bazenu ena povezava proti Discordu pokvari:
  // majhne zahteve gredo skozi, velik POST s priponko pa obvisi in ga Discord po 15 s zapre.
  // Nov REST tega ne reši, ker vsi delijo isti globalni bazen; isti upload iz svežega procesa
  // steče v pol sekunde. Zato dobi vsak poskus svoj Agent, ki ga potem zapremo.
  private uploadWithRetry(
    channelId: string,
    embeds: EmbedBuilder[],
    files: UploadFile[],
  ): Promise<boolean> {
    return this.postMultipart(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      'POST',
      { embeds: embeds.map((e) => e.toJSON()) },
      files,
      [0, 15_000, 60_000],
    );
  }

  // odgovor na odloženo interakcijo s priponko; webhook URL nosi žeton, zato brez bot avtorizacije
  private editDeferredReplyWithFiles(
    interaction: ChatInputCommandInteraction,
    content: string,
    files: UploadFile[],
  ): Promise<boolean> {
    return this.postMultipart(
      `https://discord.com/api/v10/webhooks/${interaction.applicationId}/${interaction.token}/messages/@original`,
      'PATCH',
      { content },
      files,
      [0, 5_000],
    );
  }

  private async postMultipart(
    url: string,
    method: 'POST' | 'PATCH',
    payload: Record<string, unknown>,
    files: UploadFile[],
    delaysMs: number[],
  ): Promise<boolean> {
    for (const [attempt, delay] of delaysMs.entries()) {
      if (delay > 0) await sleep(delay);
      const agent = new Agent({ connections: 1, keepAliveTimeout: 1, keepAliveMaxTimeout: 1 });
      try {
        // zahtevo sestavimo sami: discord.js nosi svojo kopijo undicija in njegovega FormData
        // naš undici ne prepozna kot multipart, zato Discord vrne CONTENT_TYPE_INVALID
        const form = new UndiciFormData();
        form.append('payload_json', JSON.stringify(payload));
        files.forEach((file, index) => {
          form.append(`files[${index}]`, new Blob([file.data], { type: file.type }), file.name);
        });
        const response = await undiciFetch(url, {
          method,
          headers: { authorization: `Bot ${this.config.discordToken}` },
          body: form,
          dispatcher: agent,
        });
        if (response.ok) return true;
        throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 150)}`);
      } catch (error) {
        log.warn(
          `nalaganje priponk ni šlo (poskus ${attempt + 1}/${delaysMs.length}): ${error instanceof Error ? error.message : error}`,
        );
      } finally {
        void agent.close().catch(() => undefined);
      }
    }
    return false;
  }

  private async fetchSendable(
    channelId: string,
  ): Promise<SendableChannels | null> {
    const channel = await this.client.channels
      .fetch(channelId)
      .catch(() => null);
    return channel?.isSendable() ? channel : null;
  }

  private async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    const query = focused.value.toLowerCase();
    const source =
      focused.name === 'regija'
        ? [...REGIONS]
        : this.watches.all().map((watch) => watch.name);
    const matches = source
      .filter((value) => value.toLowerCase().includes(query))
      .slice(0, 25)
      .map((value) => ({ name: value, value }));
    await interaction.respond(matches);
  }

  private async handleCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    switch (interaction.commandName) {
      case 'iskanje':
        return this.handleWatch(interaction);
      case 'preveri':
        return this.handleCheck(interaction);
      case 'status':
        return this.handleStatus(interaction);
      case 'zgodovina':
        return this.handleZgodovina(interaction);
      case 'povzetek':
        return this.handleRecap(interaction);
      case 'posli':
        return this.handleDeals(interaction);
      case 'izvoz':
        return this.handleExport(interaction);
    }
  }

  private async handleZgodovina(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const name = interaction.options.getString('ime', true);
    const watch = this.watches.byName(name);
    if (!watch) {
      await interaction.reply({
        content: `Ni iskanja z imenom **${name}**.`,
        ephemeral: true,
      });
      return;
    }

    const raw = interaction.options.getString('oglas', true).trim();
    const id = /^\d+$/.test(raw)
      ? raw
      : (raw.match(/_(\d+)\/?$/)?.[1] ?? raw.match(/(\d{6,})/)?.[1] ?? null);
    const stored = id ? this.listings.getListing(watch.id, id) : null;
    if (!stored) {
      await interaction.reply({
        content: `Oglasa **${raw}** ni v iskanju **${name}**. Podaj ID (npr. 7355533) ali poln URL oglasa.`,
        ephemeral: true,
      });
      return;
    }

    const history = this.listings.priceHistory(watch.id, stored.id);
    const lines: string[] = [];
    let prev: number | null = null;
    for (const entry of history) {
      const delta =
        prev !== null && entry.price !== prev
          ? ` (${entry.price > prev ? '+' : '−'}${EUR.format(Math.abs(entry.price - prev))})`
          : '';
      lines.push(`• ${entry.observedAt.slice(0, 10)}: ${EUR.format(entry.price)}${delta}`);
      prev = entry.price;
    }

    const status = stored.removedAt
      ? `umaknjen/prodan (${stored.removedAt.slice(0, 10)})`
      : 'aktiven';
    const body = [
      `**${stored.title}**`,
      `<${stored.url}>`,
      `Status: ${status}` +
        (stored.pricePerM2 !== null ? ` · ${EUR.format(stored.pricePerM2)}/m²` : ''),
      '',
      lines.length > 0 ? '**Zgodovina cene:**' : 'Brez zabeležene cene.',
      ...lines,
    ].join('\n');
    await interaction.reply({ content: body, flags: 'SuppressEmbeds' });
  }

  private async handleWatch(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'dodaj':
      case 'sestavi':
        return this.handleWatchAdd(interaction, sub);
      case 'seznam':
        return this.handleWatchList(interaction);
      case 'odstrani': {
        const name = interaction.options.getString('ime', true);
        const removed = this.watches.remove(name);
        await interaction.reply(
          removed
            ? `Iskanje **${name}** odstranjeno.`
            : `Ni iskanja z imenom **${name}**.`,
        );
        return;
      }
      case 'ustavi':
      case 'nadaljuj': {
        const name = interaction.options.getString('ime', true);
        const pause = sub === 'ustavi';
        const ok = this.watches.setPaused(name, pause);
        const what = pause ? 'ustavljeno' : 'spet zagnano';
        await interaction.reply(
          ok
            ? `Iskanje **${name}** ${what}.`
            : `Ni iskanja z imenom **${name}**.`,
        );
        return;
      }
    }
  }

  private async handleWatchAdd(
    interaction: ChatInputCommandInteraction,
    sub: 'dodaj' | 'sestavi',
  ): Promise<void> {
    const name = interaction.options.getString('ime', true);
    if (!WATCH_NAME_PATTERN.test(name)) {
      await interaction.reply({
        content:
          'Ime iskanja mora biti 1-32 znakov: črke, številke, `_` ali `-`.',
        ephemeral: true,
      });
      return;
    }
    if (this.watches.byName(name)) {
      await interaction.reply({
        content: `Iskanje **${name}** že obstaja.`,
        ephemeral: true,
      });
      return;
    }
    if (interaction.channel?.type !== ChannelType.GuildText) {
      await interaction.reply({
        content:
          'Poženi to v navadnem tekstovnem kanalu — tja bodo padala obvestila.',
        ephemeral: true,
      });
      return;
    }

    let url: string;
    try {
      url =
        sub === 'dodaj'
          ? normalizeWatchUrl(interaction.options.getString('url', true))
          : buildSearchUrl(this.filtersFromOptions(interaction));
    } catch (error) {
      await interaction.reply({
        content: `Napačen URL: ${error instanceof Error ? error.message : error}`,
        ephemeral: true,
      });
      return;
    }

    // preverjanje URL-ja zahteva pravo poizvedbo, kar lahko traja dlje od Discordovih 3s
    await interaction.deferReply();
    let count: number;
    try {
      const html = await this.fetcher.fetchHtml(url);
      count = parseSearchPage(html).length;
    } catch (error) {
      await interaction.editReply(
        `Tega iskanja nisem mogel naložiti (${error instanceof Error ? error.message : error}). Iskanje ni shranjeno.`,
      );
      return;
    }

    this.watches.create(name, url, interaction.channelId);
    await interaction.editReply(
      [
        `Iskanje **${name}** shranjeno — trenutno ustreza **${count}${count >= 25 ? '+' : ''}** oglasom.`,
        `URL: <${url}>`,
        'Obvestila bodo padala v ta kanal ob vsaki polni uri. Prvi obhod samo posname trenutno stanje (brez spama).',
        count === 0
          ? '⚠️ Trenutno 0 zadetkov — če si pričakoval kaj, preveri filtre.'
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  private filtersFromOptions(
    interaction: ChatInputCommandInteraction,
  ): SearchFilters {
    const opt = interaction.options;
    const filters: SearchFilters = {
      deal: opt.getString('posel', true) as SearchFilters['deal'],
      region: opt.getString('regija', true),
      type: opt.getString('tip', true) as SearchFilters['type'],
    };
    const rooms = opt.getString('sobnost');
    if (rooms) filters.rooms = rooms;
    const setRange = (
      key:
        | 'priceMin'
        | 'priceMax'
        | 'sizeMin'
        | 'sizeMax'
        | 'yearMin'
        | 'yearMax',
      name: string,
    ) => {
      const value = opt.getInteger(name);
      if (value !== null) filters[key] = value;
    };
    setRange('priceMin', 'cena_min');
    setRange('priceMax', 'cena_max');
    setRange('sizeMin', 'velikost_min');
    setRange('sizeMax', 'velikost_max');
    setRange('yearMin', 'letnik_min');
    setRange('yearMax', 'letnik_max');
    return filters;
  }

  private async handleWatchList(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const all = this.watches.all();
    if (all.length === 0) {
      await interaction.reply(
        'Še ni nobenega iskanja. Dodaj ga z `/iskanje dodaj` ali `/iskanje sestavi`.',
      );
      return;
    }
    const lines = all.map((watch) => {
      const state = watch.paused ? '⏸' : '▶️';
      const tracked = this.watches.listingCount(watch.id);
      return `${state} **${watch.name}** — ${tracked} sledenih, <#${watch.channelId}>\n<${watch.url}>`;
    });
    await interaction.reply({
      content: lines.join('\n'),
      flags: 'SuppressEmbeds',
    });
  }

  private async handleCheck(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const name = interaction.options.getString('ime');
    const targets = name ? [this.watches.byName(name)] : this.watches.active();
    if (name && !targets[0]) {
      await interaction.reply({
        content: `Ni iskanja z imenom **${name}**.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();
    const summaries: string[] = [];
    for (const watch of targets as Watch[]) {
      try {
        const result = await this.getPoller().pollWatch(watch);
        await this.notify(result);
        summaries.push(
          result.seeded
            ? `**${watch.name}**: posnel ${result.totalSeen} oglasov (izhodišče nastavljeno).`
            : `**${watch.name}**: ${result.newListings.length} novih, ${result.priceChanges.length} sprememb cene, ${result.relisted.length} vrnjenih (${result.totalSeen} pregledanih).`,
        );
      } catch (error) {
        summaries.push(
          `**${watch.name}**: ni šlo — ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    await interaction.editReply(summaries.join('\n') || 'Ni aktivnih iskanj.');
  }

  private async handleRecap(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const period = (interaction.options.getString('obdobje') ?? 'teden') as keyof typeof RECAP_PERIODS;
    const name = interaction.options.getString('ime');
    const targets = name ? [this.watches.byName(name)] : this.watches.all();
    if (name && !targets[0]) {
      await interaction.reply({ content: `Ni iskanja z imenom **${name}**.`, ephemeral: true });
      return;
    }
    if (targets.length === 0) {
      await interaction.reply('Še ni nobenega iskanja.');
      return;
    }

    const { days, label } = RECAP_PERIODS[period];
    const now = Date.now();
    const since = new Date(now - days * 86_400_000).toISOString();
    const prevSince = new Date(now - 2 * days * 86_400_000).toISOString();
    const pct = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)} %`;

    // ena vrstica na iskanje, samo številke
    const blocks = (targets as Watch[]).map((watch) => {
      const s = this.listings.recap(watch.id, since, prevSince);
      const changes =
        s.priceChanges === 0
          ? '0 sprememb cene'
          : `${s.priceChanges} sprememb cene (${s.drops} ↓ ${s.raises} ↑, povp. ${pct(s.avgChangePct!)})`;
      return `**${watch.name}**: ${s.added} novih · ${s.removed} umaknjenih · ${changes} · cene ${priceTrend(s)}`;
    });

    // Discord dovoli 2000 znakov na sporočilo; pri več iskanjih pošljemo v več kosih
    const chunks: string[] = [`📊 Povzetek za zadnji ${label} (od ${since.slice(0, 10)})`];
    for (const block of blocks) {
      const last = chunks[chunks.length - 1]!;
      if (last.length + block.length + 2 > 1_900) chunks.push(block);
      else chunks[chunks.length - 1] = `${last}\n${block}`;
    }
    await interaction.reply(chunks[0]!);
    for (const chunk of chunks.slice(1)) await interaction.followUp(chunk);
  }

  // aktivni oglasi z najnižjo €/m²; odstotek je glede na mediano vseh aktivnih v iskanju
  private async handleDeals(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const name = interaction.options.getString('ime', true);
    const watch = this.watches.byName(name);
    if (!watch) {
      await interaction.reply({ content: `Ni iskanja z imenom **${name}**.`, ephemeral: true });
      return;
    }
    const limit = interaction.options.getInteger('stevilo') ?? 5;
    const active = this.listings.listings(watch.id, true);
    const priced = active
      .filter((listing) => listing.pricePerM2 !== null)
      .sort((a, b) => a.pricePerM2! - b.pricePerM2!)
      .slice(0, limit);
    if (priced.length === 0) {
      await interaction.reply(`V iskanju **${name}** ni aktivnih oglasov z znano €/m².`);
      return;
    }
    const median = medianPricePerM2(active);
    const lines = priced.map((listing, index) => {
      const below =
        median !== null ? ` · ${Math.round((1 - listing.pricePerM2! / median) * 100)} % pod mediano` : '';
      const size = listing.sizeM2 !== null ? `, ${listing.sizeM2} m²` : '';
      const price = listing.price !== null ? EUR.format(listing.price) : (listing.priceDisplay ?? '?');
      // naslov skrajšamo in mu vzamemo oglate oklepaje, da ne razbije markdown povezave
      const title = listing.title.replace(/[[\]]/g, '').slice(0, 50).trim();
      return `${index + 1}. [${title}](<${listing.url}>) — ${price}${size}, **${EUR.format(listing.pricePerM2!)}/m²**${below}, od ${listing.firstSeenAt.slice(0, 10)}`;
    });
    const header =
      `💸 Najcenejši aktivni oglasi v **${name}** po €/m²` +
      (median !== null ? ` (mediana ${EUR.format(median)}/m², ${active.length} aktivnih)` : '');
    await interaction.reply([header, ...lines].join('\n'));
  }

  private async handleExport(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const name = interaction.options.getString('ime', true);
    const watch = this.watches.byName(name);
    if (!watch) {
      await interaction.reply({ content: `Ni iskanja z imenom **${name}**.`, ephemeral: true });
      return;
    }
    // priponka gre po naši poti mimo discord.js (glej postMultipart), zato najprej potrdimo interakcijo
    await interaction.deferReply();
    const what = interaction.options.getString('kaj') ?? 'oglasi';
    const stamp = new Date().toISOString().slice(0, 10);
    let csv: string;
    let count: number;
    if (what === 'cene') {
      const rows = this.listings.allPriceHistory(watch.id);
      count = rows.length;
      csv = toCsv(
        ['listing_id', 'title', 'price', 'observed_at'],
        rows.map((row) => [row.listingId, row.title, row.price, row.observedAt]),
      );
    } else {
      const rows = this.listings.listings(watch.id);
      count = rows.length;
      csv = toCsv(
        ['listing_id', 'url', 'title', 'deal_type', 'property_type', 'rooms', 'size_m2', 'year', 'floor',
          'price', 'price_per_m2', 'agency', 'first_seen_at', 'last_seen_at', 'removed_at'],
        rows.map((l) => [l.id, l.url, l.title, l.dealType, l.propertyType, l.rooms, l.sizeM2, l.year, l.floor,
          l.price, l.pricePerM2, l.agency, l.firstSeenAt, l.lastSeenAt, l.removedAt]),
      );
    }
    if (count === 0) {
      await interaction.editReply(`Za iskanje **${name}** še ni podatkov za izvoz.`);
      return;
    }
    const ok = await this.editDeferredReplyWithFiles(
      interaction,
      `Izvoz **${what}** za **${name}**: ${count} vrstic.`,
      [{ name: `${name}-${what}-${stamp}.csv`, data: Buffer.from(csv, 'utf8'), type: 'text/csv' }],
    );
    if (!ok) await interaction.editReply('Priponke ni bilo mogoče naložiti, poskusi znova čez minuto.');
  }

  private async handleStatus(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const all = this.watches.all();
    const blockedSince = this.getPoller().blockedSinceDate;
    const header = blockedSince
      ? `🔴 Cloudflare nas blokira od ${blockedSince.toISOString()} — umaknjeni.`
      : '🟢 Špegavec zdrav.';
    const lines = all.map((watch) => {
      const polled = watch.lastPolledAt
        ? `<t:${Math.floor(Date.parse(watch.lastPolledAt) / 1000)}:R>`
        : 'nikoli';
      return `• **${watch.name}**${watch.paused ? ' (ustavljeno)' : ''} — zadnji obhod ${polled}, ${watch.lastStatus ?? 'n/a'}`;
    });
    await interaction.reply([header, ...lines].join('\n'));
  }
}
