-- `ledger_entries` is append-only, enforced by the database rather than by
-- convention. A correction is a reversing INSERT — see `reverseExpenseVersion`
-- in src/lib/ledger.ts. Nothing may UPDATE or DELETE a row here: not application
-- code, not a later migration, not a one-off fix script.
CREATE OR REPLACE FUNCTION ledger_entries_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only; insert a reversing entry instead';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();
