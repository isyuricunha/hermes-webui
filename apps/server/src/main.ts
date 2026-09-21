import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await buildApp({ config });

app.listen({ host: config.host, port: config.port }).catch((error) => {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
});
