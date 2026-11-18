import { Agent, request } from 'node:http';
import { Buffer } from 'node:buffer';

export function keepAliveTransport(baseUrl, token) {
  const agent = new Agent({ keepAlive: true, maxSockets: 32 });
  const send = (path, body, key) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        baseUrl + path,
        {
          agent,
          method: payload === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            ...(payload === undefined
              ? {}
              : {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }),
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          signal: globalThis.AbortSignal.timeout(30000),
        },
        (response) => {
          response.setEncoding('utf8');
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('error', reject);
          response.on('end', () => {
            try {
              resolve({ status: response.statusCode, body: JSON.parse(data) });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
  return { send, close: () => agent.destroy() };
}
