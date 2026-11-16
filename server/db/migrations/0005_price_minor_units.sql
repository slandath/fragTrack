ALTER TABLE "price" ADD COLUMN "amount_minor" integer;
--> statement-breakpoint
UPDATE "price" SET "amount_minor" = (split_part("amount", '.', 1)::bigint * 100 + COALESCE(NULLIF(rpad(split_part("amount", '.', 2), 2, '0'), ''), '00')::integer) WHERE "amount" ~ '^\d{1,6}(\.\d{1,2})?$';
--> statement-breakpoint
DO $$
DECLARE
  bad_count integer;
  bad_sample text;
  bad_cur_count integer;
  bad_cur_sample text;
BEGIN
  SELECT count(*), (SELECT string_agg(t, ', ') FROM (SELECT format('%s amount=%s', "id", "amount") AS t FROM "price" WHERE "amount_minor" IS NULL ORDER BY "id" LIMIT 20) s)
    INTO bad_count, bad_sample FROM "price" WHERE "amount_minor" IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Migration 0005 aborted: % price row(s) have non-decimal or out-of-range amounts that cannot be safely converted to minor units (sample: %). Delete or correct these rows and re-run the migration. All changes were rolled back.', bad_count, bad_sample;
  END IF;
  SELECT count(*), (SELECT string_agg(t, ', ') FROM (SELECT format('%s currency=%s', "id", "currency") AS t FROM "price" WHERE "currency" !~ '^[A-Z]{3}$' ORDER BY "id" LIMIT 20) s)
    INTO bad_cur_count, bad_cur_sample FROM "price" WHERE "currency" !~ '^[A-Z]{3}$';
  IF bad_cur_count > 0 THEN
    RAISE EXCEPTION 'Migration 0005 aborted: % price row(s) have invalid currency codes (sample: %). Correct these rows and re-run the migration. All changes were rolled back.', bad_cur_count, bad_cur_sample;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "price" ALTER COLUMN "amount_minor" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "price" ADD CONSTRAINT "price_amount_minor_range" CHECK("price"."amount_minor" > 0 AND "price"."amount_minor" <= 99999999);
--> statement-breakpoint
ALTER TABLE "price" ADD CONSTRAINT "price_currency_code" CHECK("price"."currency" ~ '^[A-Z]{3}$');
--> statement-breakpoint
ALTER TABLE "price" DROP COLUMN "amount";
