import { loadConfig } from "./config.js";
import { Poller } from "./core/poller.js";
import { Bot } from "./discord/bot.js";
import { Fetcher } from "./scraper/fetcher.js";
import { openDatabase } from "./store/db.js";
import { ListingRepo, WatchRepo } from "./store/repo.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const watches = new WatchRepo(db);
  const listings = new ListingRepo(db);
  const fetcher = new Fetcher();

  // bot in poller se sklicujeta drug na drugega; getter razbije ta krog
  let poller: Poller;
  const bot = new Bot(config, watches, fetcher, () => poller);

  poller = new Poller(fetcher, watches, listings, {
    onResult: async (result) => {
      if (result.seeded) {
        await bot.notifyText(
          result.watch.channelId,
          `Iskanje **${result.watch.name}** posneto z ${result.totalSeen} obstoječimi oglasi. Od zdaj naprej te obvestim o vsakem novem.`,
        );
        return;
      }
      await bot.notify(result);
    },
    onBlocked: async (watch) => {
      await bot.notifyText(
        watch.channelId,
        "⚠️ nepremicnine.net nas trenutno blokira (Cloudflare challenge). Se umaknem in samodejno poskušam naprej.",
      );
    },
    onError: async (watch, error) => {
      console.error(`obhod za ${watch.name} ni uspel:`, error);
    },
  }, config.pollMinutes);

  await bot.start();
  poller.start();
  console.log(`Obhod vsakih ~${config.pollMinutes} min. Iskanj: ${watches.all().length}`);

  const shutdown = () => {
    poller.stop();
    void bot.client.destroy();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("usodna napaka:", error);
  process.exit(1);
});
