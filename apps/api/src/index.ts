import { loadConfig } from './config.js';
import { createPool } from './db/db.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { AzureResourceGraphClient } from './azure/resourceGraph.js';
import { createLlmProvider } from './llm/provider.js';

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL, cfg.DATABASE_SSL);
await migrate(db);
const app = createApp({
  db,
  cfg,
  arg: cfg.ARG_ENABLED ? new AzureResourceGraphClient() : null,
  llm: createLlmProvider(cfg),
});
const server = app.listen(cfg.PORT, () =>
  console.log(
    `AEGIS API listening on :${cfg.PORT} (auth=${cfg.AUTH_MODE}, resourceGraph=${cfg.ARG_ENABLED})`,
  ),
);
const stop = (): void => {
  server.close(() => {
    void db.end().then(() => process.exit(0));
  });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
