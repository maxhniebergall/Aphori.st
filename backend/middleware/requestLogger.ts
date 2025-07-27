import { randomUUID } from 'crypto';
import { pinoHttp, Options as PinoHttpOptions } from 'pino-http';
import { Request, Response, NextFunction } from 'express';
import { err as errSerializer } from 'pino-std-serializers';
import logger from '../logger.js'; // Your existing pino logger instance
import { IncomingMessage, ServerResponse } from 'http';

// Define the options for pino-http
const pinoHttpOptions: PinoHttpOptions = {
  logger: logger,

  genReqId: function (req: IncomingMessage, res: ServerResponse) {
    const expressReq = req as Request;
    const expressRes = res as Response;
    const existingId = expressReq.id ?? expressReq.headers["x-cloud-trace-context"];
    if (existingId) {
      expressRes.locals.requestId = existingId;
      return existingId;
    }
    const id = randomUUID();
    expressRes.locals.requestId = id;
    return id;
  },

  customLogLevel: function (req: IncomingMessage, res: ServerResponse, err?: Error) {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    } else if (res.statusCode >= 300 && res.statusCode < 400) {
      return 'debug';
    }
    return 'info';
  },

  customSuccessMessage: function (req: IncomingMessage, res: ServerResponse) {
    const expressReq = req as Request;
    const expressRes = res as Response;
    const statusMessagePart = expressRes.statusMessage && expressRes.statusMessage.trim() !== '' ? ` ${expressRes.statusMessage}` : '';
    const baseMessage = `${expressReq.method} ${(expressReq as any).originalUrl || expressReq.url} - ${expressRes.statusCode}${statusMessagePart}`;

    if (expressRes.locals.jsonErrorBody && typeof expressRes.locals.jsonErrorBody.error === 'string' && expressRes.statusCode >= 400 && expressRes.statusCode < 500) {
      return `${baseMessage} (Client Error: ${expressRes.locals.jsonErrorBody.error})`;
    }
    return baseMessage;
  },

  customErrorMessage: function (req: IncomingMessage, res: ServerResponse, err: Error) {
    const expressReq = req as Request;
    const expressRes = res as Response;
    const baseMessage = `${expressReq.method} ${(expressReq as any).originalUrl || expressReq.url} - ${expressRes.statusCode}`;
    if (err && err.message) {
        return `${baseMessage} Error: ${err.message}`;
    }
    if (expressRes.locals.jsonErrorBody && typeof expressRes.locals.jsonErrorBody.error === 'string') {
        return `${baseMessage} (Client Error: ${expressRes.locals.jsonErrorBody.error})`;
    }
    return `${baseMessage} (Status: ${expressRes.statusCode}, Error: ${err ? err.message || 'Present (no message)' : 'Unknown'})`;
  },

  serializers: {
    req: (reqInSerializer) => {
      const originalReq = (reqInSerializer as any).raw as Request || reqInSerializer as Request;
      const standard = {
        id: originalReq.id,
        method: originalReq.method,
        url: originalReq.url,
        remoteAddress: originalReq.socket?.remoteAddress,
        remotePort: originalReq.socket?.remotePort,
      };
      const httpRequest = {
        requestMethod: originalReq.method,
        requestUrl: originalReq.originalUrl || originalReq.url,
        remoteIp: originalReq.ip ||
                  (Array.isArray(originalReq.headers?.['x-forwarded-for']) ? originalReq.headers['x-forwarded-for'][0] : originalReq.headers?.['x-forwarded-for']) ||
                  originalReq.socket?.remoteAddress,
        userAgent: originalReq.headers?.['user-agent'],
        referrer: originalReq.headers?.referer,
      };
      return { ...standard, httpRequest };
    },
    res: (resInSerializer) => {
      const originalRes = (resInSerializer as any).raw as Response || resInSerializer as Response;
      const standard = {
        statusCode: originalRes.statusCode,
      };
      const httpRequest = {
        status: originalRes.statusCode,
      };
      return { ...standard, httpRequest };
    },
    err: errSerializer,
  },

  customProps: function (req: IncomingMessage, res: ServerResponse): object {
    const expressRes = res as Response;
    const props: Record<string, any> = {};
    if (expressRes.locals.jsonErrorBody && expressRes.statusCode >= 400 && expressRes.statusCode < 500) {
      props.clientErrorDetails = expressRes.locals.jsonErrorBody;
    }
    return props;
  },
};

const pinoHttpLoggerInstance = pinoHttp(pinoHttpOptions);

const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;

  res.json = function (body: any) {
    if (this.statusCode >= 400 && this.statusCode < 500 && body && typeof body.error === 'string') {
      this.locals.jsonErrorBody = body;
    }
    return originalJson.call(this, body);
  };

  pinoHttpLoggerInstance(req, res, next);
};

export default requestLogger;