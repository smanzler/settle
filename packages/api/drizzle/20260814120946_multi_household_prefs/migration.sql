CREATE TABLE "user_household_prefs" (
	"user_id" uuid PRIMARY KEY,
	"active_household_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "households_created_by_user_id_key";--> statement-breakpoint
CREATE INDEX "household_invites_open_email_idx" ON "household_invites" (lower("email")) WHERE redeemed_at is null and revoked_at is null;--> statement-breakpoint
CREATE INDEX "households_created_by_user_id_idx" ON "households" ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "user_household_prefs" ADD CONSTRAINT "user_household_prefs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_household_prefs" ADD CONSTRAINT "user_household_prefs_active_household_id_households_id_fkey" FOREIGN KEY ("active_household_id") REFERENCES "households"("id") ON DELETE SET NULL;