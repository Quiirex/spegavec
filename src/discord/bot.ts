import {
  AttachmentBuilder,
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
import type { Config } from '../config.js';
import type { Poller } from '../core/poller.js';
import type { PollResult, SearchFilters, Watch } from '../core/types.js';
import { log } from '../log.js';
import type { Fetcher } from '../scraper/fetcher.js';
import { parseSearchPage } from '../scraper/parser.js';
import { buildSearchUrl, normalizeWatchUrl } from '../scraper/urlBuilder.js';
import type { ListingRepo, WatchRepo } from '../store/repo.js';
import { buildCommands, REGIONS } from './commands.js';
import { newListingEmbed, priceChangeEmbed } from './embeds.js';

const WATCH_NAME_PATTERN = /^[\w-]{1,32}$/;

interface EmbedItem {
  embed: EmbedBuilder;
  imageUrl: string | null;
  thumb: boolean;
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
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.client.on('interactionCreate', (interaction) => {
      if (interaction.isChatInputCommand()) {
        void this.handleCommand(interaction).catch((error) => {
          log.error(
            `ukaz crkno: ${error instanceof Error ? error.message : error}`,
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
    if (result.newListings.length === 0 && result.priceChanges.length === 0)
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
    // Discord dovoli največ 10 embedov (in 10 priponk) na sporočilo
    for (let i = 0; i < items.length; i += 10) {
      const batch = items.slice(i, i + 10);
      const files: AttachmentBuilder[] = [];
      await Promise.all(
        batch.map(async (item, j) => {
          if (!item.imageUrl) return;
          try {
            const buffer = await this.fetcher.fetchImage(item.imageUrl);
            const name = `oglas-${i + j}.jpg`;
            files.push(new AttachmentBuilder(buffer, { name }));
            const ref = `attachment://${name}`;
            if (item.thumb) item.embed.setThumbnail(ref);
            else item.embed.setImage(ref);
          } catch (error) {
            // hotlink ni rezerva, ampak zagotovljena polomljena slika (Discordov proxy dobi Cloudflare challenge),
            // zato ga rajši vržemo ven; sporočilo gre naprej brez slike
            if (item.thumb) item.embed.setThumbnail(null);
            else item.embed.setImage(null);
            log.warn(
              `slike ${item.imageUrl} ni bilo mogoče pobrat: ${error instanceof Error ? error.message : error}`,
            );
          }
        }),
      );
      const embeds = batch.map((item) => item.embed);
      try {
        await channel.send({ embeds, files });
      } catch (error) {
        // brez priponk je bolje kot brez obvestila
        log.warn(
          `pošiljanje s priponkami ni šlo (${error instanceof Error ? error.message : error}), pošiljam brez slik`,
        );
        for (const embed of embeds) embed.setImage(null).setThumbnail(null);
        await channel.send({ embeds });
      }
    }
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
        content: `Oglasa **${raw}** ni v iskanju **${name}**. Daj ID (npr. 7355533) ali poln URL oglasa.`,
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
          'Ime iskanja mora bit 1-32 znakov: črke, številke, `_` ali `-`.',
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
          'Poženi to v navadnem tekstovnem kanalu — tja bojo padala obvestila.',
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

    // preverjanje URL-ja rabi pravo poizvedbo, kar lahko traja dlje od Discordovih 3s
    await interaction.deferReply();
    let count: number;
    try {
      const html = await this.fetcher.fetchHtml(url);
      count = parseSearchPage(html).length;
    } catch (error) {
      await interaction.editReply(
        `Tega iskanja nisem mogel naložit (${error instanceof Error ? error.message : error}). Iskanje ni shranjeno.`,
      );
      return;
    }

    this.watches.create(name, url, interaction.channelId);
    await interaction.editReply(
      [
        `Iskanje **${name}** shranjeno — trenutno ustreza **${count}${count >= 25 ? '+' : ''}** oglasom.`,
        `URL: <${url}>`,
        `Obvestila bojo padala v ta kanal vsakih ~${this.config.pollMinutes} min. Prvi obhod samo posname trenutno stanje (brez spama).`,
        count === 0
          ? '⚠️ Trenutno 0 zadetkov — če si pričakoval kaj, prever filtre.'
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
            : `**${watch.name}**: ${result.newListings.length} novih, ${result.priceChanges.length} sprememb cene (${result.totalSeen} pregledanih).`,
        );
      } catch (error) {
        summaries.push(
          `**${watch.name}**: ni šlo — ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    await interaction.editReply(summaries.join('\n') || 'Ni aktivnih iskanj.');
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
