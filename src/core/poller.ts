import type { PollResult, Watch } from './types.js';
import { BlockedError, type Fetcher } from '../scraper/fetcher.js';
import { crawlSearch } from '../scraper/crawler.js';
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
    const crawled = await crawlSearch(this.fetcher, watch.url);
    const seeded = watch.lastPolledAt === null;
    const diff = this.listings.applyCrawl(watch.id, crawled);
    this.watches.recordPoll(
      watch.id,
      seeded
        ? `posnel ${crawled.length} oglasov`
        : `ok: ${diff.newListings.length} novih, ${diff.priceChanges.length} sprememb cene`,
    );
    return {
      watch,
      seeded,
      totalSeen: crawled.length,
      newListings: seeded ? [] : diff.newListings,
      priceChanges: seeded ? [] : diff.priceChanges,
    };
  }

  async pollAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const watch of this.watches.active()) {
        try {
          const result = await this.pollWatch(watch);
          this.blockedSince = null;
          this.consecutiveBlocks = 0;
          await this.events.onResult(result);
        } catch (error) {
          if (error instanceof BlockedError) {
            this.consecutiveBlocks++;
            this.watches.recordPoll(watch.id, 'blokiran s strani Cloudflare');
            if (!this.blockedSince) {
              this.blockedSince = new Date();
              await this.events.onBlocked(watch);
            }
            break; // nima smisla tolč po strani, dokler smo blokirani
          }
          const err = error instanceof Error ? error : new Error(String(error));
          this.watches.recordPoll(watch.id, `napaka: ${err.message}`);
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
    this.timer = setTimeout(() => {
      void this.pollAll();
    }, delay);
    this.timer.unref();
  }
}
