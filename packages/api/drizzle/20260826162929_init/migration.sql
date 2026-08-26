CREATE TYPE "channel" AS ENUM('email', 'mobile');--> statement-breakpoint
CREATE TYPE "group_member_status" AS ENUM('invited', 'active', 'removed');--> statement-breakpoint
CREATE TYPE "group_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "ledger_entry_type" AS ENUM('paid', 'share', 'settlement');--> statement-breakpoint
CREATE TYPE "ledger_source_type" AS ENUM('expense', 'settlement');--> statement-breakpoint
CREATE TYPE "status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "expense_payers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"expense_version_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "expense_payers_version_member_unique" UNIQUE("expense_version_id","member_id"),
	CONSTRAINT "expense_payers_amount_positive" CHECK ("amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "expense_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"expense_version_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "expense_shares_version_member_unique" UNIQUE("expense_version_id","member_id"),
	CONSTRAINT "expense_shares_amount_non_negative" CHECK ("amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expense_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"expense_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" text NOT NULL,
	"expense_date" date NOT NULL,
	"note" text,
	"created_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_versions_expense_version_unique" UNIQUE("expense_id","version"),
	CONSTRAINT "expense_versions_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "expense_versions_amount_positive" CHECK ("amount_cents" > 0),
	CONSTRAINT "expense_versions_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "expenses_id_group_unique" UNIQUE("id","group_id")
);
--> statement-breakpoint
CREATE TABLE "group_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL UNIQUE,
	"invited_by_member_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"role" "group_role" DEFAULT 'member'::"group_role" NOT NULL,
	"status" "group_member_status" DEFAULT 'invited'::"group_member_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "group_members_id_group_unique" UNIQUE("id","group_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"created_by_user_id" uuid,
	"iso_currency_code" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"entry_type" "ledger_entry_type" NOT NULL,
	"source_type" "ledger_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"source_version" integer DEFAULT 1 NOT NULL,
	"reverses_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_non_zero" CHECK ("amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"notification_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"device_token" text,
	"status" "status" DEFAULT 'pending'::"status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb,
	"dedupe_key" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_id_dedupe_key_unique" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text,
	"note" text,
	"settled_on" date NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "settlements_amount_positive" CHECK ("amount_cents" > 0),
	CONSTRAINT "settlements_distinct_members" CHECK ("from_member_id" <> "to_member_id")
);
--> statement-breakpoint
CREATE TABLE "user_group_prefs" (
	"user_id" uuid PRIMARY KEY,
	"active_group_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "expense_versions_date_idx" ON "expense_versions" ("group_id","expense_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expenses_group_created_idx" ON "expenses" ("group_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "group_invites_group_id_idx" ON "group_invites" ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_invites_open_email_key" ON "group_invites" ("group_id","email") WHERE redeemed_at is null and revoked_at is null;--> statement-breakpoint
CREATE INDEX "group_invites_open_email_idx" ON "group_invites" (lower("email")) WHERE redeemed_at is null and revoked_at is null;--> statement-breakpoint
CREATE INDEX "group_members_group_id_idx" ON "group_members" ("group_id");--> statement-breakpoint
CREATE INDEX "group_members_user_id_idx" ON "group_members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_user_key" ON "group_members" ("group_id","user_id") WHERE status <> 'removed';--> statement-breakpoint
CREATE INDEX "ledger_entries_group_member_idx" ON "ledger_entries" ("group_id","member_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_source_idx" ON "ledger_entries" ("source_type","source_id","source_version");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_reverses_unique" ON "ledger_entries" ("reverses_id") WHERE reverses_id is not null;--> statement-breakpoint
CREATE INDEX "settlements_group_date_idx" ON "settlements" ("group_id","settled_on" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" ("identifier");--> statement-breakpoint
ALTER TABLE "expense_payers" ADD CONSTRAINT "expense_payers_version_fk" FOREIGN KEY ("expense_version_id","group_id") REFERENCES "expense_versions"("id","group_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "expense_payers" ADD CONSTRAINT "expense_payers_member_fk" FOREIGN KEY ("member_id","group_id") REFERENCES "group_members"("id","group_id");--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_version_fk" FOREIGN KEY ("expense_version_id","group_id") REFERENCES "expense_versions"("id","group_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_member_fk" FOREIGN KEY ("member_id","group_id") REFERENCES "group_members"("id","group_id");--> statement-breakpoint
ALTER TABLE "expense_versions" ADD CONSTRAINT "expense_versions_expense_fk" FOREIGN KEY ("expense_id","group_id") REFERENCES "expenses"("id","group_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "expense_versions" ADD CONSTRAINT "expense_versions_created_by_fk" FOREIGN KEY ("created_by_member_id","group_id") REFERENCES "group_members"("id","group_id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fk" FOREIGN KEY ("created_by_member_id","group_id") REFERENCES "group_members"("id","group_id");--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_redeemed_by_user_id_users_id_fkey" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_member_fk" FOREIGN KEY ("member_id","group_id") REFERENCES "group_members"("id","group_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_inviter_fk" FOREIGN KEY ("invited_by_member_id","group_id") REFERENCES "group_members"("id","group_id");--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_fk" FOREIGN KEY ("reverses_id") REFERENCES "ledger_entries"("id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_member_fk" FOREIGN KEY ("member_id","group_id") REFERENCES "group_members"("id","group_id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_fk" FOREIGN KEY ("from_member_id","group_id") REFERENCES "group_members"("id","group_id");--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_fk" FOREIGN KEY ("to_member_id","group_id") REFERENCES "group_members"("id","group_id");--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_fk" FOREIGN KEY ("created_by_member_id","group_id") REFERENCES "group_members"("id","group_id");--> statement-breakpoint
ALTER TABLE "user_group_prefs" ADD CONSTRAINT "user_group_prefs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_group_prefs" ADD CONSTRAINT "user_group_prefs_active_group_id_groups_id_fkey" FOREIGN KEY ("active_group_id") REFERENCES "groups"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;