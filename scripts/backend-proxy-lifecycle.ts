import type { Plugin, ProxyOptions } from 'vite';
import type { Socket } from 'node:net';

/** Classify errors only after the browser's own proxied socket has closed. */
export function backendProxyLifecycle() {
  const expectedErrors = new WeakSet<Error>();
  const clients = new WeakMap<Socket, { closed: boolean }>();
  const expectedCodes = new Set(['ECONNRESET', 'ECONNABORTED', 'EPIPE']);
  const classify = (error: Error, client: { closed: boolean }) => {
    const code = 'code' in error ? error.code : undefined;
    if (client.closed && typeof code === 'string' && expectedCodes.has(code)) expectedErrors.add(error);
  };

  const configure: NonNullable<ProxyOptions['configure']> = (proxy) => {
    proxy.on('proxyReqWs', (request, incoming, socket) => {
      const client = { closed: false };
      clients.set(socket, client);
      socket.once('end', () => {
        client.closed = true;
      });
      socket.once('close', () => {
        client.closed = true;
      });
      // Vite adds its diagnostic listener after this callback. Retain the
      // error's ownership so its logger can distinguish navigation from an
      // upstream reset while the browser remains connected.
      const clientError = (error: Error) => {
        client.closed = true;
        classify(error, client);
      };
      incoming.prependListener('error', clientError);
      socket.prependListener('error', clientError);
      request.on('error', (error) => classify(error, client));
      request.on('upgrade', (_response, upstream) => {
        upstream.prependListener('error', (error) => classify(error, client));
      });
    });
    proxy.on('error', (error, _incoming, response) => {
      const client = clients.get(response as Socket);
      if (client) classify(error, client);
    });
  };

  const plugin: Plugin = {
    name: 'modiff-backend-proxy-lifecycle',
    apply: 'serve',
    configResolved(config) {
      const reportError = config.logger.error.bind(config.logger);
      config.logger.error = (message, options) => {
        if (options?.error instanceof Error && expectedErrors.has(options.error)) return;
        reportError(message, options);
      };
    },
  };
  return { configure, plugin };
}
