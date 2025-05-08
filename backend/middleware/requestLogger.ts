import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';
import { Request, Response, NextFunction } from 'express'; // Import express types
import { err } from 'pino-std-serializers'; // Import the error serializer directly
import logger from '../logger.js'; // Import the shared logger instance

const requestLogger = pinoHttp({
  logger: logger, // Use our pre-configured logger

  // Generate a unique ID for each request
  genReqId: function (req: Request, res: Response) { // Use Express types explicitly
    const existingId = req.id ?? req.headers["x-cloud-trace-context"];
    if (existingId) return existingId;
    const id = randomUUID();
    // Also set it on res.locals for easier access within handlers if needed
    // Note: pino-http automatically adds req.id to logs if using the same logger instance
    res.locals.requestId = id; // Now correctly typed
    return id;
  },

  // Customize logging output
  customLogLevel: function (req, res, err) {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    } else if (res.statusCode >= 300 && res.statusCode < 400) {
        return 'silent'; // Usually redirects aren't worth logging unless debugging
    }
    return 'info'; // Default for 2xx responses
  },

  // Customize the log message
  customSuccessMessage: function (req, res) {
    // Check if res.statusMessage exists and is non-empty before using it
    const statusMessage = res.statusMessage && res.statusMessage.trim() !== '' ? ` ${res.statusMessage}` : '';
    return `${req.method} ${req.url} - ${res.statusCode}${statusMessage}`;
  },
  customErrorMessage: function (req, res, err) {
      return `${req.method} ${req.url} - ${res.statusCode} Error: ${err.message}`;
  },


  // Format log object to include httpRequest structure for Cloud Logging
  serializers: {
    req: (req) => {
        // Standard request properties for pino-http
        const standard = {
            id: req.id, // Ensure request ID is logged
            method: req.method,
            url: req.url,
            // Include other standard req properties if needed (e.g., headers, remoteAddress)
            // headers: req.headers,
            remoteAddress: req.remoteAddress,
            remotePort: req.remotePort,
        };
        // GCP httpRequest specific fields
        // See: https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#HttpRequest
        // Note: pino-http automatically adds responseTime for latency
        const httpRequest = {
            requestMethod: req.method,
            requestUrl: req.originalUrl || req.url, // Use originalUrl if available
            // requestSize: req.headers['content-length'], // Need to parse potentially
            remoteIp: req.ip || req.headers['x-forwarded-for'] || (req.socket ? req.socket.remoteAddress : undefined), // Standard IP detection, safely check socket
            userAgent: req.headers['user-agent'],
            referrer: req.headers['referer'],
            // protocol: req.protocol, // Available in express 5+ or need to infer
            // responseSize: res.getHeader('content-length'), // Logged on response side
            // status: res.statusCode, // Logged on response side
            // latency: // Calculated by pino-http as responseTime
        };
        return { ...standard, httpRequest };
    },
    res: (res) => {
        // Standard response properties for pino-http
        const standard = {
            statusCode: res.statusCode,
            // headers: res.getHeaders(), // Can be verbose
        };
        // GCP httpRequest specific fields (logged on response)
        const httpRequest = {
             status: res.statusCode,
            // responseSize: res.getHeader('content-length'), // Might need parsing
        };
         return { ...standard, httpRequest };
    },
    // Use standard pino error serializer
    err: err, 
  },

  // Use `trace` level for request start, `info`/`warn`/`error` for completion
  // autoLogging: true, // Default is true
  // quietReqLogger: true, // Prevents logging request details twice if not needed

  // Optional: Wrap request object to include custom context if needed later
  // wrapRequest: (req: Request) => {
  //   return { ...req, customContext: {} };
  // },
});

export default requestLogger; 