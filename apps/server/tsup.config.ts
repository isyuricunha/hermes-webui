import { defineConfig } from 'tsup';

// The shared workspace package ships TypeScript sources: bundle it into the
// server instead of leaving a runtime import of .ts files.
export default defineConfig({
  noExternal: ['@hermes-webui/shared'],
});
