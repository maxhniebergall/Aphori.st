import { pino } from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';

// Basic Pino configuration for structured JSON logging
const logger = pino({
  level: logLevel,
  formatters: {
    // Ensure severity matches Google Cloud Logging expectations
    // https://cloud.google.com/logging/docs/structured-logging#special-payload-fields
    level: (label) => {
      // Pino levels: 'trace', 'debug', 'info', 'warn', 'error', 'fatal'
      // GCP levels: 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'
      // Basic mapping:
      switch (label) {
        case 'trace': return { severity: 'DEBUG' };
        case 'debug': return { severity: 'DEBUG' };
        case 'info': return { severity: 'INFO' };
        case 'warn': return { severity: 'WARNING' };
        case 'error': return { severity: 'ERROR' };
        case 'fatal': return { severity: 'CRITICAL' };
        default: return { severity: 'DEFAULT' };
      }
    },
    // Optional: Customize bindings (pid, hostname) if needed,
    // but Cloud Run often injects its own context. Defaults are usually fine.
    // bindings: (bindings) => {
    //   return { pid: bindings.pid, hostname: bindings.hostname };
    // }
  },
  // Cloud Run adds its own timestamp, but Pino's can be useful locally.
  // Disable Pino's timestamp if it causes duplication in Cloud Logging.
  // timestamp: pino.stdTimeFunctions.isoTime, // Or keep enabled for local dev
  messageKey: 'message', // Standard field for message text
});

// Log the initial log level being used
logger.info(`Logger initialized with level: ${logLevel}`);

// Export the configured logger instance
export default logger; 