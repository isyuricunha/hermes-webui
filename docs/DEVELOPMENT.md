# Development

## Layout

```
apps/web        React 19 + Vite + Tailwind + TanStack Query/Router
apps/server     Fastify 5 + TypeScript (API adapters, auth boundary, CLI bridge)
packages/shared Shared types and the normalized run-event protocol
docs/           Architecture, security, compatibility
```

## Daily commands

```bash
pnpm dev          # run server (tsx watch, :8789) + web (vite, :5173) in parallel
pnpm lint         # ESLint flat config, whole repo
pnpm typecheck    # tsc --noEmit per workspace
pnpm test         # vitest: Fastify inject() on the server, jsdom + RTL on the web
pnpm build        # production build (server bundle + static web assets)
hermes verify     # outside CI: full bootstrap -> build -> test -> start -> readiness
```

Use `pnpm --filter @hermes-webui/server <script>` (or `web`) to scope to one app.

## Conventions

- **Never invent Hermes endpoints.** The gateway and dashboard clients implement only routes evidenced in `docs/HERMES-CAPABILITY-MATRIX.md`. When adding a capability, probe or read the upstream source first, then add the client method and cite it in the matrix.
- **Errors**: every non-2xx returns `{ error: { code, message }, requestId }`. Gateway 401/403 maps to `HERMES_AUTH_FAILED` (502); unreachable maps to `HERMES_UNREACHABLE` (503); dashboard equivalents use `HERMES_DASHBOARD_*` codes.
- **Secrets** stay in `apps/server/.env` (gitignored) or the service environment. The logger redacts `authorization`, `cookie` and `x-hermes-session-token` headers.
- **CLI bridge**: commands must be declared in `apps/server/src/cli/registry.ts` with fixed argv, timeout and output cap. `execFile` only; shell operators are rejected in the escape hatch; output passes through credential redaction.
- **Tests mirror behavior, not source.** Backend tests use `inject()` against the real route tree with a stubbed `fetch` for upstream Hermes; the CLI bridge tests run against a real stub binary.
- **TypeScript is pinned to `^5.9`**: `typescript-eslint` 8.x refuses TS 7. Do not let `pnpm -r up --latest` float it past that.

## Adding a Settings capability

1. Confirm the upstream route (dashboard or gateway) in the capability matrix.
2. Add the client method (`hermes/dashboard.ts` or `hermes/client.ts`).
3. Add the proxy route under `/api/settings/*` with a request schema.
4. Add the page under `apps/web/src/features/settings/` and register the route.
5. Cover the proxy with an `inject()` test (token header, passthrough, failure mapping).

## Updating dependencies

`pnpm -r up --latest` works, but re-run the full gate afterwards and watch for toolchain ceilings (see `docs/COMPATIBILITY.md`).
