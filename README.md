# budget

pnpm monorepo starting point: Expo mobile app, TanStack Start web app, Fastify +
tRPC API, shared types.

```
apps/mobile     Expo Router app — email OTP auth, push notifications
apps/web        TanStack Start (Vite) app — shadcn/Tailwind v4
packages/api    Fastify + tRPC + better-auth + Drizzle (Postgres)
packages/shared Types/schemas shared between the API and the clients
docker/         Local Postgres, pgAdmin and Mailpit
```

## What's wired up

- **Auth** — better-auth with email OTP. The API mails codes through SMTP
  (Mailpit locally); the mobile app has sign-in + verify screens, and everything
  under `app/(protected)` requires a session.
- **API** — tRPC router mounted at `/trpc`, `protectedProcedure` for
  session-guarded calls, better-auth routes at `/api/auth/*`.
- **Push notifications** — `notify()` writes a notification row and queues a
  delivery on pg-boss, which sends it via Expo. The mobile app registers its
  push token on launch.
- **File uploads** — `files.createUpload` / `files.confirmUpload` hand out
  presigned S3 URLs so clients upload straight to the bucket.
- **Split & settle** — every transaction is attributed to one or more
  **household members**, and the app tracks who owes the person whose card
  actually moved. See below.

## Households, splits and the ledger

Everything is scoped to a **household**. A household has **members** — seats,
not users, so you can split a bill with someone before they install the app.
Each bank account has an owner member: the creditor.

Two separate ideas, and keeping them apart is the whole design:

- `transaction_splits` is **intent** — `(member, weight, amount_cents)` rows
  that sum exactly to the transaction amount, in Plaid's sign convention. This
  is what the split editor writes.
- `ledger_entries` is **truth** — append-only, signed, pairwise
  `(debtor, creditor, amount_cents)` rows keyed by a stable `external_ref`.
  Balances are a `SUM` over it, derived on read; nothing is materialized.

One function, `postShareDeltas` in `lib/ledger.ts`, diffs what the splits say
against what is already posted and appends only the difference. A new
transaction, an edited split, a Plaid amount change, a transaction moving
accounts, and a Plaid deletion are all the same call — and calling it twice
writes nothing.

Because splits carry Plaid's sign, a refund is just a negative split and the
debt reverses itself; there is no second rule for refunds. Rounding goes through
`allocate` in `packages/shared/src/money.ts` (largest-remainder, exact,
sign-symmetric), which lives in `shared` so the editor previews the exact cents
the server will store.

`balances.verify` recomputes the target from the splits and reports any ref the
entries disagree with — the projection is only correct if no `postShareDeltas`
call was ever missed, so drift is detectable rather than silent.

A single user never sees any of this: the household exists from signup, but
every household surface is gated on having more than one member.

## Local setup

1. `pnpm install`
2. Copy the env examples and fill them in:
   - `cp docker/.env.example docker/.env`
   - `cp packages/api/.env.example packages/api/.env` — generate
     `BETTER_AUTH_SECRET` with `openssl rand -base64 32`
   - `cp apps/mobile/.env.example apps/mobile/.env`
3. `pnpm start` — Postgres (5432), pgAdmin (15433), Mailpit (8025)
4. Create the first migration, then apply it:
   `pnpm --filter @budget/api exec drizzle-kit generate` and
   `pnpm --filter @budget/api exec drizzle-kit migrate`
5. `pnpm dev` — runs docker, API, mobile and web in tmux panes

Sign-in codes land in Mailpit at http://localhost:8025.

## Per-project setup checklist

Things that can't be inherited from the template — do these once per project:

- [ ] **Expo/EAS**: run `eas init` in `apps/mobile` to create the project and
      fill in `extra.eas.projectId` (push tokens and EAS builds need it). Check
      `owner`, `name`, `slug`, `scheme` and the bundle/package IDs in
      `app.config.ts`.
- [ ] **Android push**: add `google-services.json` to `apps/mobile` and
      re-enable `android.googleServicesFile` in `app.config.ts`.
- [ ] **Icons**: replace the images in `packages/shared/assets/images` (app
      icon, splash, adaptive icons, favicon, and `icon-email.png` used in the
      OTP email).
- [ ] **Fly.io**: `app` in `packages/api/fly.toml` must be an app that exists
      (`fly apps create <name>`), then set the `FLY_API_TOKEN` and
      `DATABASE_URL` GitHub secrets.
- [ ] **Vercel**: set `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
      GitHub secrets for the web deploy, and `EXPO_TOKEN` for mobile OTA.
- [ ] **S3**: create a bucket and fill in the `BUCKET_*` env vars, or delete
      `packages/api/src/lib/s3.ts` and the `files` router if you don't need
      uploads.

## Notes

- Postgres runs the stock `postgres:16` image. Need PostGIS or another
  extension? Point the `database` service at a custom image and add a
  `CREATE EXTENSION` line to `docker/postgres/init.sql`.
- `packages/shared/src/notify.ts` defines the notification payload union — add a
  variant per notification type your app sends, then handle it in
  `renderNotification` in `packages/api/src/lib/notify.ts`.
- Social sign-in (Google/Apple) isn't included. better-auth's `socialProviders`
  is the place to add it back.

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm check` (prettier) — all run
across every workspace.

### Integration tests

`packages/api/src/lib/ledger.test.ts` and `src/routes/scope.test.ts` exercise
real SQL — a full outer join, an append-only reconcile, and the `WHERE` clauses
that keep one household out of another's data. A mock would only test the mock,
so they need a live database and skip themselves without one:

```
INTEGRATION_DATABASE_URL=postgresql://budget:<pw>@localhost:5432/budget \
  pnpm --filter @budget/api test
```

The ledger tests run inside a transaction that is always rolled back. The scope
tests cannot (they go through the `db` singleton, which would not see
uncommitted rows), so they create run-stamped users and delete exactly those in
`afterAll`. Point them at a scratch database if that makes you nervous.
