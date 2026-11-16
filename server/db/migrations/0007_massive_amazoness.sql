-- Spec 04: indexes for retailer_url access patterns.
-- Migration 0006 already enforces UNIQUE(fragrance_id, url). If a database
-- somehow still contains duplicates, fail loudly rather than indexing around
-- them. Cleanup procedure: for each duplicate group, choose one surviving
-- retailer_url (the row with the most recent price), reparent all its price
-- rows to that survivor, then delete the other rows. This preserves price
-- history and is an explicit operator decision, not an automatic merge.
DO $$
DECLARE
  dup_count integer;
  dup_sample text;
BEGIN
  SELECT count(*), (SELECT string_agg(t, ', ') FROM (
    SELECT format('%s/%s', fragrance_id, url) AS t
    FROM "retailer_url"
    GROUP BY fragrance_id, url HAVING count(*) > 1
    ORDER BY t LIMIT 10
  ) s) INTO dup_count, dup_sample
  FROM (SELECT 1 FROM "retailer_url" GROUP BY fragrance_id, url HAVING count(*) > 1) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Migration 0007 aborted: % duplicate retailer_url group(s) found (sample: %). Clean them up per the procedure in this migration and re-run. All changes were rolled back.', dup_count, dup_sample;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX "retailer_url_fragrance_id_idx" ON "retailer_url" USING btree ("fragrance_id");--> statement-breakpoint
CREATE INDEX "retailer_url_retailer_id_idx" ON "retailer_url" USING btree ("retailer_id");
