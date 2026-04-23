# AGENTS.md

## Commands

- **Run CLI directly**: `node --env-file=.env src/cli/index.ts <command>` — no build step or `tsx` needed (Node 22+ type stripping)
- **Tests**: `npm test` — uses `node --test`, not Jest/Vitest
- **Integration tests**: `npm run test:integration` — requires `.env` with real API credentials
- **Typecheck**: `npm run typecheck`

## Landmines

- Tests mock HTTP via undici `MockAgent` / `setGlobalDispatcher`. Always restore the original dispatcher in `afterEach` or subsequent tests break.
- The `.env` file contains real HackerOne API credentials — never commit it. `.env.example` has the template.
