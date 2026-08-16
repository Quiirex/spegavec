import { loadConfig } from "./config.js";
import { Poller } from "./core/poller.js";
import { Bot } from "./discord/bot.js";
import { log } from "./log.js";
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
  const bot = new Bot(config, watches, listings, fetcher, () => poller);

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
      // brez obvestila v kanal: blokade so prehodne in same od sebe minejo, spamati uporabnika nima smisla
      // stanje vidiš v /status (🔴) in v logih
      log.debug(`"${watch.name}" blokiran (Cloudflare), tiho se umikam`);
    },
    onError: async (_watch, error) => {
      // poller že zabeleži kratko sporočilo; tu samo sled za razhroščevanje
      log.debug(error.stack ?? String(error));
    },
  }, config.pollMinutes);

  await bot.start();
  poller.start();
  log.info(`Špegavec teče. Obhod vsakih ~${config.pollMinutes} min, ${watches.all().length} iskanj.`);

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
  log.error(`usodna napaka: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
  process.exit(1);
});
