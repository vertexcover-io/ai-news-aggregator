import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(name: string): pino.Logger {
  return pino({ name });
}
