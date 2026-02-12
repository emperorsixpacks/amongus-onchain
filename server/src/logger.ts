import winston from "winston";

const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] [${level}]${metaStr} ${message}`;
});

export function createLogger(name: string): winston.Logger {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
    defaultMeta: { service: name },
    transports: [
      new winston.transports.Console({
        format: combine(colorize(), timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
      }),
    ],
  });
}

export const logger = createLogger("ws-server");
