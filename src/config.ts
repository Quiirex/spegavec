function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Manjka obvezna okoljska spremenljivka: ${name}`);
  }
  return value;
}

export interface Config {
  discordToken: string;
  // brez guild ID-ja se ukazi registrirajo globalno in se prikažejo šele v ~1h
  discordGuildId: string | undefined;
  dbPath: string;
}

export function loadConfig(): Config {
  return {
    discordToken: required("DISCORD_TOKEN"),
    discordGuildId: process.env.DISCORD_GUILD_ID,
    dbPath: process.env.DB_PATH ?? "./data/spegavec.db",
  };
}
