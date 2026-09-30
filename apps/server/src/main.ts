import { createServer } from 'node:http';
import { buildApp } from './app';
import { loadDotEnvIntoProcess } from './dotenv';
import { loadConfig } from './config';

loadDotEnvIntoProcess();

const config = loadConfig();
const app = await buildApp({ config });

// HOST may list several addresses ("100.64.0.5,127.0.0.1"): e.g. a VPN
// address for direct use plus loopback for a tunnel or reverse proxy on the
// same machine, without binding every interface.
const [primary = '127.0.0.1', ...extra] = config.host
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '');

try {
  await app.listen({ host: primary, port: config.port });
  for (const host of extra) {
    const server = createServer((request, response) => app.routing(request, response));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, host, () => resolve());
    });
    app.log.info(`Server also listening at http://${host.includes(':') ? `[${host}]` : host}:${config.port}`);
  }
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
