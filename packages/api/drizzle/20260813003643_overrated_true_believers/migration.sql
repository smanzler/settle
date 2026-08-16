CREATE TYPE "plaid_item_status" AS ENUM('syncing', 'active', 'login_required', 'error');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"plaid_account_id" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"official_name" text,
	"type" text,
	"subtype" text,
	"mask" text,
	"current_balance" numeric(12,2),
	"available_balance" numeric(12,2),
	"iso_currency_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"plaid_item_id" text NOT NULL UNIQUE,
	"access_token" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"institution_logo_url" text,
	"cursor" text,
	"status" "plaid_item_status" DEFAULT 'syncing'::"plaid_item_status" NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"plaid_transaction_id" text NOT NULL UNIQUE,
	"amount" numeric(12,2) NOT NULL,
	"iso_currency_code" text,
	"date" date NOT NULL,
	"authorized_date" date,
	"name" text NOT NULL,
	"merchant_name" text,
	"category" text,
	"category_detailed" text,
	"payment_channel" text,
	"pending" boolean DEFAULT false NOT NULL,
	"logo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bank_accounts_user_id_idx" ON "bank_accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_plaid_item_id_idx" ON "bank_accounts" ("plaid_item_id");--> statement-breakpoint
CREATE INDEX "plaid_items_user_id_idx" ON "plaid_items" ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_user_id_date_id_idx" ON "transactions" ("user_id","date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_bank_account_id_idx" ON "transactions" ("bank_account_id");--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_plaid_item_id_plaid_items_id_fkey" FOREIGN KEY ("plaid_item_id") REFERENCES "plaid_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE;