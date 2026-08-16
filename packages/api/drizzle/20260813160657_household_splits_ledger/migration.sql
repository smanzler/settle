-- Hand-edited after `drizzle-kit generate`.
--
-- The generated file dropped `user_id` and added NOT NULL columns before
-- anything could backfill from them. The order below is: create everything
-- nullable, derive the household data, verify it, and only then lock it down.
-- The whole file runs in one transaction, so a failed assertion at the bottom
-- rolls back the entire migration rather than leaving a half-scoped database.

CREATE TYPE "account_split_default" AS ENUM('owner', 'equal');--> statement-breakpoint
CREATE TYPE "household_member_status" AS ENUM('invited', 'active', 'removed');--> statement-breakpoint
CREATE TYPE "household_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "ledger_entry_kind" AS ENUM('share', 'settlement', 'adjustment');--> statement-breakpoint
CREATE TYPE "split_method" AS ENUM('owner', 'shares', 'exact');--> statement-breakpoint
-- Safe inside a transaction on PG12+ as long as the new value is not *used*
-- before commit. Nothing below references 'disconnected'.
ALTER TYPE "plaid_item_status" ADD VALUE 'disconnected';--> statement-breakpoint
CREATE TABLE "household_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL UNIQUE,
	"invited_by_member_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"redeemed_at" timestamp,
	"redeemed_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"role" "household_role" DEFAULT 'member'::"household_role" NOT NULL,
	"status" "household_member_status" DEFAULT 'invited'::"household_member_status" NOT NULL,
	"joined_at" timestamp,
	"removed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_user_unique" UNIQUE("household_id","user_id"),
	CONSTRAINT "household_members_id_household_unique" UNIQUE("id","household_id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"created_by_user_id" uuid,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"household_id" uuid NOT NULL,
	"debtor_member_id" uuid NOT NULL,
	"creditor_member_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"iso_currency_code" text NOT NULL,
	"kind" "ledger_entry_kind" NOT NULL,
	"external_ref" text NOT NULL,
	"transaction_id" uuid,
	"settlement_id" uuid,
	"reverses_entry_id" uuid,
	"memo" text,
	"effective_date" date NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_nonzero" CHECK ("amount_cents" <> 0),
	CONSTRAINT "ledger_entries_distinct_parties" CHECK ("debtor_member_id" <> "creditor_member_id")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY,
	"household_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"iso_currency_code" text NOT NULL,
	"settled_on" date NOT NULL,
	"method" text,
	"note" text,
	"created_by_member_id" uuid NOT NULL,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_amount_positive" CHECK ("amount_cents" > 0),
	CONSTRAINT "settlements_distinct_parties" CHECK ("from_member_id" <> "to_member_id")
);
--> statement-breakpoint
CREATE TABLE "split_intents" (
	"plaid_transaction_id" text PRIMARY KEY,
	"household_id" uuid NOT NULL,
	"split_method" "split_method" NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_splits" (
	"household_id" uuid NOT NULL,
	"transaction_id" uuid,
	"member_id" uuid,
	"weight" integer DEFAULT 1 NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_splits_pkey" PRIMARY KEY("transaction_id","member_id"),
	CONSTRAINT "transaction_splits_weight_range" CHECK ("weight" > 0 and "weight" <= 1000)
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_user_id_users_id_fkey";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_user_id_users_id_fkey";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fkey";--> statement-breakpoint
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_plaid_account_id_key";--> statement-breakpoint
DROP INDEX "bank_accounts_user_id_idx";--> statement-breakpoint
DROP INDEX "transactions_user_id_date_id_idx";--> statement-breakpoint
-- Every new scope/ownership column starts NULLABLE. The NOT NULLs go on after
-- the backfill, further down.
ALTER TABLE "bank_accounts" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "owner_member_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "default_split" "account_split_default" DEFAULT 'owner'::"account_split_default" NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "default_split_from" date;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "excluded_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN "owner_member_id" uuid;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN "disconnected_at" timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "creditor_member_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "plaid_pending_transaction_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "split_method" "split_method" DEFAULT 'owner'::"split_method" NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "splits_stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "split_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "split_updated_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "plaid_items" ALTER COLUMN "access_token" DROP NOT NULL;--> statement-breakpoint

-- ── backfill ──────────────────────────────────────────────────────────────
-- One household per existing user, paired on `created_by_user_id`.
--
-- This is the single most dangerous step in the migration. Every user this app
-- creates has `users.name = ''` (better-auth's emailOTP writes `name || ""` and
-- the verify screen never sends one), so pairing on name — or on row_number()
-- over an INSERT ... RETURNING — would silently merge every user into one
-- household and there is no way back.
INSERT INTO "households" ("id", "name", "created_by_user_id")
SELECT gen_random_uuid(),
       coalesce(nullif(u."name", ''), split_part(u."email", '@', 1)) || '''s household',
       u."id"
FROM "users" u;--> statement-breakpoint

INSERT INTO "household_members"
  ("household_id", "user_id", "display_name", "role", "status", "joined_at")
SELECT h."id",
       h."created_by_user_id",
       coalesce(nullif(u."name", ''), split_part(u."email", '@', 1)),
       'owner', 'active', now()
FROM "households" h
JOIN "users" u ON u."id" = h."created_by_user_id";--> statement-breakpoint

UPDATE "plaid_items" pi SET "household_id" = h."id"
FROM "households" h WHERE h."created_by_user_id" = pi."user_id";--> statement-breakpoint
UPDATE "bank_accounts" ba SET "household_id" = h."id"
FROM "households" h WHERE h."created_by_user_id" = ba."user_id";--> statement-breakpoint
UPDATE "transactions" t SET "household_id" = h."id"
FROM "households" h WHERE h."created_by_user_id" = t."user_id";--> statement-breakpoint

UPDATE "plaid_items" pi SET "owner_member_id" = m."id"
FROM "household_members" m
WHERE m."household_id" = pi."household_id" AND m."role" = 'owner';--> statement-breakpoint
UPDATE "bank_accounts" ba SET "owner_member_id" = m."id"
FROM "household_members" m
WHERE m."household_id" = ba."household_id" AND m."role" = 'owner';--> statement-breakpoint
-- The creditor follows the ACCOUNT's owner, not the item's — they can diverge
-- once accounts are reassigned.
UPDATE "transactions" t SET "creditor_member_id" = ba."owner_member_id"
FROM "bank_accounts" ba WHERE ba."id" = t."bank_account_id";--> statement-breakpoint

-- Seed the partition: 100% of every existing transaction to its creditor.
-- Exact by construction — ROUND on a numeric involves no float — and every
-- split has debtor == creditor, so the correct starting balance is exactly
-- zero. This is why no ledger entries are backfilled: the feature is a no-op
-- until a second member is invited.
INSERT INTO "transaction_splits"
  ("household_id", "transaction_id", "member_id", "weight", "amount_cents")
SELECT t."household_id", t."id", t."creditor_member_id", 1,
       ROUND(t."amount" * 100)::bigint
FROM "transactions" t;--> statement-breakpoint

-- ── verify before locking down ────────────────────────────────────────────
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT t."id"
    FROM "transactions" t
    LEFT JOIN "transaction_splits" s ON s."transaction_id" = t."id"
    GROUP BY t."id", t."amount"
    HAVING coalesce(sum(s."amount_cents"), -1) <> round(t."amount" * 100)::bigint
  ) q;
  IF bad > 0 THEN
    RAISE EXCEPTION 'split partition invariant violated on % transaction(s)', bad;
  END IF;
END $$;--> statement-breakpoint

DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT u."id"
    FROM "users" u
    LEFT JOIN "household_members" m
      ON m."user_id" = u."id" AND m."status" = 'active'
    GROUP BY u."id"
    HAVING count(m."id") <> 1
  ) q;
  IF bad > 0 THEN
    RAISE EXCEPTION '% user(s) without exactly one active membership', bad;
  END IF;
END $$;--> statement-breakpoint

DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT 1 FROM "plaid_items"
      WHERE "household_id" IS NULL OR "owner_member_id" IS NULL
    UNION ALL
    SELECT 1 FROM "bank_accounts"
      WHERE "household_id" IS NULL OR "owner_member_id" IS NULL
    UNION ALL
    SELECT 1 FROM "transactions"
      WHERE "household_id" IS NULL OR "creditor_member_id" IS NULL
  ) q;
  IF bad > 0 THEN
    RAISE EXCEPTION '% row(s) left unscoped by the backfill', bad;
  END IF;
END $$;--> statement-breakpoint

-- ── lock down ─────────────────────────────────────────────────────────────
ALTER TABLE "plaid_items" ALTER COLUMN "household_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plaid_items" ALTER COLUMN "owner_member_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ALTER COLUMN "household_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ALTER COLUMN "owner_member_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "household_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "creditor_member_id" SET NOT NULL;--> statement-breakpoint
-- Only now is `user_id` no longer needed. Keeping it alongside `household_id`
-- would leave two plausible scope columns, which is how cross-tenant bugs are
-- born. `plaid_items.user_id` stays: it is the credential holder.
ALTER TABLE "bank_accounts" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_item_account_unique" UNIQUE("plaid_item_id","plaid_account_id");--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_id_household_unique" UNIQUE("id","household_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_id_household_unique" UNIQUE("id","household_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_household_id_idx" ON "bank_accounts" ("household_id");--> statement-breakpoint
CREATE INDEX "household_invites_household_id_idx" ON "household_invites" ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_invites_open_email_key" ON "household_invites" ("household_id","email") WHERE redeemed_at is null and revoked_at is null;--> statement-breakpoint
CREATE INDEX "household_members_user_id_idx" ON "household_members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "households_created_by_user_id_key" ON "households" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_household_ref_idx" ON "ledger_entries" ("household_id","external_ref");--> statement-breakpoint
CREATE INDEX "ledger_entries_household_date_id_idx" ON "ledger_entries" ("household_id","effective_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_entries_debtor_idx" ON "ledger_entries" ("household_id","debtor_member_id","effective_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_entries_creditor_idx" ON "ledger_entries" ("household_id","creditor_member_id","effective_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plaid_items_household_id_idx" ON "plaid_items" ("household_id");--> statement-breakpoint
CREATE INDEX "settlements_household_idx" ON "settlements" ("household_id","settled_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transaction_splits_member_id_idx" ON "transaction_splits" ("member_id");--> statement-breakpoint
CREATE INDEX "transactions_household_id_date_id_idx" ON "transactions" ("household_id","date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_pending_transaction_id_idx" ON "transactions" ("plaid_pending_transaction_id") WHERE plaid_pending_transaction_id is not null;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_household_id_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_owner_fk" FOREIGN KEY ("owner_member_id","household_id") REFERENCES "household_members"("id","household_id");--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_redeemed_by_user_id_users_id_fkey" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_member_fk" FOREIGN KEY ("member_id","household_id") REFERENCES "household_members"("id","household_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_inviter_fk" FOREIGN KEY ("invited_by_member_id","household_id") REFERENCES "household_members"("id","household_id");--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_household_id_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_transactions_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_settlement_id_settlements_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_debtor_fk" FOREIGN KEY ("debtor_member_id","household_id") REFERENCES "household_members"("id","household_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_creditor_fk" FOREIGN KEY ("creditor_member_id","household_id") REFERENCES "household_members"("id","household_id");--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_household_id_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_owner_fk" FOREIGN KEY ("owner_member_id","household_id") REFERENCES "household_members"("id","household_id");--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_household_id_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_fk" FOREIGN KEY ("from_member_id","household_id") REFERENCES "household_members"("id","household_id");--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_fk" FOREIGN KEY ("to_member_id","household_id") REFERENCES "household_members"("id","household_id");--> statement-breakpoint
ALTER TABLE "split_intents" ADD CONSTRAINT "split_intents_household_id_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_household_id_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_fk" FOREIGN KEY ("transaction_id","household_id") REFERENCES "transactions"("id","household_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_member_fk" FOREIGN KEY ("member_id","household_id") REFERENCES "household_members"("id","household_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_fk" FOREIGN KEY ("bank_account_id","household_id") REFERENCES "bank_accounts"("id","household_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_creditor_fk" FOREIGN KEY ("creditor_member_id","household_id") REFERENCES "household_members"("id","household_id");
