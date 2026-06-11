type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// LOG_LEVEL=debug pokaže tudi posamezne strani med zajemom; privzeto info
const envLevel = process.env.LOG_LEVEL as Level | undefined;
const threshold = ORDER[envLevel && envLevel in ORDER ? envLevel : "info"];

function emit(level: Level, message: string): void {
  if (ORDER[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string) => emit("debug", message),
  info: (message: string) => emit("info", message),
  warn: (message: string) => emit("warn", message),
  error: (message: string) => emit("error", message),
};
