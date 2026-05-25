import { Impit } from "impit";

export class BlockedError extends Error {
  constructor(url: string) {
    super(`Anti-bot zaščita nas je vrgla ven pri ${url}`);
    this.name = "BlockedError";
  }
}

export class HttpError extends Error {
  constructor(
    url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} pri ${url}`);
    this.name = "HttpError";
  }
}

const BLOCK_MARKERS = ["Just a moment", "challenges.cloudflare.com", "cf-chl"];

function looksBlocked(html: string): boolean {
  // challenge stran je majhna; prave rezultate ne smemo zamenjat za blokado, če kje notr omenjajo Cloudflare
  return html.length < 30_000 && BLOCK_MARKERS.some((marker) => html.includes(marker));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// impit se dela ko pravi Chrome (TLS/HTTP2 prstni odtis), drugač nas Cloudflare ne spusti skoz brez brskalnika
export class Fetcher {
  private readonly impit: Impit;

  constructor(
    private readonly retries = 2,
    private readonly retryDelayMs = 5_000,
  ) {
    this.impit = new Impit({
      browser: "chrome",
      timeout: 30_000,
    });
  }

  async fetchHtml(url: string): Promise<string> {
    let lastError: Error = new Error("unreachable");
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await sleep(this.retryDelayMs * attempt);
      }
      try {
        const response = await this.impit.fetch(url);
        const html = await response.text();
        if (response.status === 403 || looksBlocked(html)) {
          throw new BlockedError(url);
        }
        if (response.status >= 400) {
          throw new HttpError(url, response.status);
        }
        return html;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // 404 se sam ne bo zracelu, blokade in 5xx pa splača poskusit še enkrat
        if (lastError instanceof HttpError && lastError.status < 500) {
          throw lastError;
        }
      }
    }
    throw lastError;
  }
}
