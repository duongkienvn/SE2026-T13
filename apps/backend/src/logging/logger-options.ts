import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { EnvironmentConfig } from '../config/environment';

export function loggerOptions(
  config: Pick<EnvironmentConfig, 'LOG_LEVEL' | 'NODE_ENV'>,
): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers.set-cookie',
          'password',
          '*.password',
          '*.token',
        ],
        censor: '[REDACTED]',
      },
      genReqId: (request: IncomingMessage, response: ServerResponse) => {
        const incoming = request.headers['x-request-id'];
        const requestId =
          typeof incoming === 'string' &&
          /^[A-Za-z0-9._-]{1,128}$/.test(incoming)
            ? incoming
            : randomUUID();
        response.setHeader('X-Request-Id', requestId);
        return requestId;
      },
      serializers: {
        req: (request: IncomingMessage & { id?: string }) => ({
          method: request.method,
          path: request.url?.split('?')[0],
          requestId: request.id,
        }),
        res: (response: ServerResponse) => ({
          statusCode: response.statusCode,
        }),
        err: (error: Error) => ({ type: error.name }),
      },
      customReceivedMessage: () => 'request received',
      customSuccessMessage: () => 'request completed',
      customErrorMessage: () => 'request failed',
    },
  };
}
