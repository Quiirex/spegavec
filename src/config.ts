function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Manjka obvezna okoljska spremenljivka: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Spremenljivka ${name} mora biti pozitivno celo število, dobil pa "${raw}"`);
  }
  return parsed;
}

export interface Config {
  discordToken: string;
  // brez guild ID-ja se ukazi registrirajo globalno in se prikažejo šele v ~1h
  discordGuildId: string | undefined;
  pollMinutes: number;
  dbPath: string;
}

export function loadConfig(): Config {
  return {
    discordToken: required("DISCORD_TOKEN"),
    discordGuildId: process.env.DISCORD_GUILD_ID,
    pollMinutes: optionalInt("POLL_MINUTES", 20),
    dbPath: process.env.DB_PATH ?? "./data/spegavec.db",
  };
}
