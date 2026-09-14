# settle

pnpm monorepo — Expo mobile app (`apps/mobile`), TanStack Start web app (`apps/web`), Fastify + tRPC + Drizzle API (`packages/api`), shared types/schemas (`packages/shared`).

## General

- Do not execute `cd` commands into your current working directory

## Writing code

- Read `STYLE.md` and follow the guidelines therein
- Follow DRY (Don't Repeat Yourself) principles: avoid duplicating logic, extract reusable abstractions, and prefer referencing existing code over copying it
- Prettier runs on commit via husky + lint-staged. To format sooner, run `pnpm format` (or `pnpm --filter @settle/<pkg> format`)
- Prefer node built-ins to 3rd-party libraries (e.g. `fetch` not `axios`, `crypto.randomUUID()` not `uuid`)
- Anything crossing the API↔client boundary — payload shapes, enums, response types — belongs in `packages/shared` as a zod schema with its inferred type exported alongside it
- Import with the `@/*` alias inside an app, and by package name (`@settle/shared`, `@settle/api`) across workspaces. Never reach into another workspace by relative path
- Avoid flattened type unions discriminated at runtime vs algebraic type unions discriminated at type-check time; e.g.:
  DO:
  type Thing = { type: "left", x: number } | { type: "right", y: string }
  AVOID:
  type Thing = { x?: number, y?: string }

  On the wire this means `z.discriminatedUnion`, as in `packages/shared/src/notify.ts`.

## Frontend styling

Prefer `className` over the `style` prop for frontend styling whenever possible.

In app code, import UI components from `@/components/ui` — never `Text`, `Pressable`, or other styled primitives straight from `react-native`, and never `@base-ui/react` directly on the web. Those belong inside `components/ui` wrappers, which carry the shared variants and theming. If a component isn't there yet, add it rather than styling a raw primitive at the call site.

## Verification

If a dev server is up, feel free to use it when it makes sense to, not just for the sake of it.
