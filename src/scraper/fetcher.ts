import { Impit } from 'impit';
import { log } from '../log.js';

export class BlockedError extends Error {
  constructor(url: string) {
    super(`Anti-bot zaščita nas je vrgla ven pri ${url}`);
    this.name = 'BlockedError';
  }
}

export class HttpError extends Error {
  constructor(
    url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} pri ${url}`);
    this.name = 'HttpError';
  }
}

const BLOCK_MARKERS = ['Just a moment', 'challenges.cloudflare.com', 'cf-chl'];

function looksBlocked(html: string): boolean {
  // challenge stran je majhna; prave rezultate ne smemo zamenjat za blokado, če kje noter omenjajo Cloudflare
  return (
    html.length < 30_000 &&
    BLOCK_MARKERS.some((marker) => html.includes(marker))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Fetcher {
  private readonly impit: Impit;

  constructor(
    private readonly retries = 2,
    private readonly retryDelayMs = 5_000,
  ) {
    this.impit = new Impit({
      browser: 'chrome',
      timeout: 30_000,
    });
  }

  // slike na img.nepremicnine.net so zdaj za Cloudflareom; Discordov proxy dobi challenge namesto slike,
  // zato jih poberemo sami (Chrome TLS gre skozi) in botu vrnemo bajte za priponko
  async fetchImage(url: string): Promise<Buffer> {
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await sleep(this.retryDelayMs * attempt);
      try {
        const response = await this.impit.fetch(url);
        if (response.status >= 400) throw new HttpError(url, response.status);
        const type = response.headers.get('content-type') ?? '';
        if (!type.startsWith('image/')) throw new BlockedError(url);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0) throw new BlockedError(url);
        return buffer;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (lastError instanceof HttpError && lastError.status < 500) throw lastError;
      }
    }
    throw lastError;
  }

  async fetchHtml(url: string): Promise<string> {
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await sleep(this.retryDelayMs * attempt);
      }
      try {
        log.debug(`GET ${url}`);
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
        if (lastError instanceof HttpError && lastError.status < 500) {
          throw lastError;
        }
        if (attempt < this.retries) {
          log.warn(`${lastError.message}; ponovni poskus ${attempt + 1}/${this.retries} čez ${(this.retryDelayMs * (attempt + 1)) / 1000}s`);
        }
      }
    }
    throw lastError;
  }
}
