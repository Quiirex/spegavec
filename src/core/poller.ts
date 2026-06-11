import type { PollResult, Watch } from './types.js';
import { BlockedError, type Fetcher } from '../scraper/fetcher.js';
import { crawlSearch } from '../scraper/crawler.js';
import { medianPricePerM2 } from './stats.js';
import { log } from '../log.js';
import type { ListingRepo, WatchRepo } from '../store/repo.js';

export interface PollerEvents {
  onResult: (result: PollResult) => Promise<void>;
  onBlocked: (watch: Watch) => Promise<void>;
  onError: (watch: Watch, error: Error) => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ko nas Cloudflare začne blokirat, se umaknemo (eksponentno)
export class Poller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private blockedSince: Date | null = null;
  private consecutiveBlocks = 0;

  constructor(
    private readonly fetcher: Fetcher,
    private readonly watches: WatchRepo,
    private readonly listings: ListingRepo,
    private readonly events: PollerEvents,
    private readonly intervalMinutes: number,
  ) {}

  start(): void {
    this.scheduleNext(30_000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get blockedSinceDate(): Date | null {
    return this.blockedSince;
  }

  // takojšen obhod enega iskanja (kliče ga ukaz /preveri)
  async pollWatch(watch: Watch): Promise<PollResult> {
    const started = Date.now();
    log.info(`zajemam "${watch.name}"`);
    const crawled = await crawlSearch(this.fetcher, watch.url, watch.name);
    const seeded = watch.lastPolledAt === null;
    // ob praznem zajemu (npr. okvara) ne zaznavamo umaknjenih, da ne pobrišemo vsega
    const diff = this.listings.applyCrawl(watch.id, crawled, crawled.length > 0);
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    this.watches.recordPoll(
      watch.id,
      seeded
        ? `posnel ${crawled.length} oglasov`
        : `ok: ${diff.newListings.length} novih, ${diff.priceChanges.length} sprememb cene, ${diff.removed.length} umaknjenih`,
    );
    if (seeded) {
      log.info(`"${watch.name}": izhodišče posneto, ${crawled.length} oglasov (${secs}s)`);
    } else {
      log.info(
        `"${watch.name}": ${crawled.length} oglasov, ${diff.newListings.length} novih, ${diff.priceChanges.length} sprememb cene, ${diff.removed.length} umaknjenih (${secs}s)`,
      );
    }
    return {
      watch,
      seeded,
      totalSeen: crawled.length,
      newListings: seeded ? [] : diff.newListings,
      priceChanges: seeded ? [] : diff.priceChanges,
      removed: seeded ? [] : diff.removed,
      medianPricePerM2: medianPricePerM2(crawled),
    };
  }

  async pollAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const active = this.watches.active();
      if (active.length > 0) {
        log.info(`obhod: ${active.length} ${active.length === 1 ? 'iskanje' : 'iskanj'}`);
      }
      for (const watch of active) {
        try {
          const result = await this.pollWatch(watch);
          this.blockedSince = null;
          this.consecutiveBlocks = 0;
          await this.events.onResult(result);
        } catch (error) {
          if (error instanceof BlockedError) {
            this.consecutiveBlocks++;
            this.watches.recordPoll(watch.id, 'blokiran s strani Cloudflare');
            log.warn(`"${watch.name}" blokiran (Cloudflare), prekinjam obhod in se umikam`);
            if (!this.blockedSince) {
              this.blockedSince = new Date();
              await this.events.onBlocked(watch);
            }
            break; // nima smisla tolč po strani, dokler smo blokirani
          }
          const err = error instanceof Error ? error : new Error(String(error));
          this.watches.recordPoll(watch.id, `napaka: ${err.message}`);
          log.error(`"${watch.name}" napaka: ${err.message}`);
          await this.events.onError(watch, err);
        }
        await sleep(3_000 + Math.random() * 4_000);
      }
    } finally {
      this.running = false;
      this.scheduleNext();
    }
  }

  private scheduleNext(overrideMs?: number): void {
    if (this.timer) clearTimeout(this.timer);
    const baseMs = this.intervalMinutes * 60_000;
    // do 8x umik ob blokadi; jitter ±20%, da obhodi ne zgledajo ko cron
    const backoff = Math.min(2 ** this.consecutiveBlocks, 8);
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = overrideMs ?? baseMs * backoff * jitter;
    const human = delay < 60_000 ? `${Math.round(delay / 1000)} s` : `${Math.round(delay / 60_000)} min`;
    log.info(`naslednji obhod čez ~${human}`);
    this.timer = setTimeout(() => {
      void this.pollAll();
    }, delay);
    this.timer.unref();
  }
}
