# budget

pnpm monorepo — Expo mobile app (`apps/mobile`), TanStack Start web app (`apps/web`), Fastify + tRPC + Drizzle API (`packages/api`), shared types/schemas (`packages/shared`).

## General

- Do not execute `cd` commands into your current working directory
- Write any documentation (including code comments) using ASD-STE100 formt

## Writing code

- Read `STYLE.md` and follow the guidelines therein
- Follow DRY (Don't Repeat Yourself) principles: avoid duplicating logic, extract reusable abstractions, and prefer referencing existing code over copying it
- Prettier runs on commit via husky + lint-staged. To format sooner, run `pnpm format` (or `pnpm --filter @budget/<pkg> format`)
- Prefer node built-ins to 3rd-party libraries (e.g. `fetch` not `axios`, `crypto.randomUUID()` not `uuid`)
- Anything crossing the API↔client boundary — payload shapes, enums, response types — belongs in `packages/shared` as a zod schema with its inferred type exported alongside it
- Import with the `@/*` alias inside an app, and by package name (`@budget/shared`, `@budget/api`) across workspaces. Never reach into another workspace by relative path
- Avoid flattened type unions discriminated at runtime vs algebraic type unions discriminated at type-check time; e.g.:
  DO:
  type Thing = { type: "left", x: number } | { type: "right", y: string }
  AVOID:
  type Thing = { x?: number, y?: string }

  On the wire this means `z.discriminatedUnion`, as in `packages/shared/src/notify.ts`.

## Verification

- Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before you report the work as complete
- Give `test` a file path to run one test file. This works in every workspace:

  ```sh
  pnpm --filter @budget/api test src/lib/splits.test.ts
  pnpm --filter @budget/mobile test src/lib/money.test.ts
  ```

- Use a dev server that already runs when you must see the change. Examples: a UI difference, or a bug that you must reproduce
- Do not start a dev server when `lint` and `typecheck` answer the question
- Check for a dev server before you start one. Stop each dev server that you start
