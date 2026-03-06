const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? LOG_LEVELS.info;
const isProduction = process.env.NODE_ENV === 'production';

function formatMessage(level, tag, message, data) {
  const ts = new Date().toISOString();
  if (isProduction) {
    const entry = { ts, level, tag, message };
    if (data !== undefined) entry.data = data;
    return JSON.stringify(entry);
  }
  const prefix = `[${ts}] [${level.toUpperCase()}] [${tag}]`;
  return data !== undefined ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;
}

function createLogger(tag) {
  return {
    error(message, data) {
      if (currentLevel >= LOG_LEVELS.error) console.error(formatMessage('error', tag, message, data));
    },
    warn(message, data) {
      if (currentLevel >= LOG_LEVELS.warn) console.warn(formatMessage('warn', tag, message, data));
    },
    info(message, data) {
      if (currentLevel >= LOG_LEVELS.info) console.log(formatMessage('info', tag, message, data));
    },
    debug(message, data) {
      if (currentLevel >= LOG_LEVELS.debug) console.log(formatMessage('debug', tag, message, data));
    },
  };
}

export default createLogger;
