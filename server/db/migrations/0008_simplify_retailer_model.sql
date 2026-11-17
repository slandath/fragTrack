-- Spec 07: store the retailer domain directly on retailer_url and drop the
-- redundant retailer table. The URL is authoritative for the domain; the
-- retailer row is only used to backfill and to detect inconsistent history.

DO $$
DECLARE
  frag_count integer;
  url_count integer;
  price_count integer;
  domain_count integer;
BEGIN
  SELECT count(*) INTO frag_count FROM "fragrance";
  SELECT count(*) INTO url_count FROM "retailer_url";
  SELECT count(*) INTO price_count FROM "price";
  SELECT count(DISTINCT "url") INTO domain_count FROM "retailer";
  RAISE NOTICE 'Spec 07 pre-migration: fragrances=%, urls=%, prices=%, distinct_domains=%',
    frag_count, url_count, price_count, domain_count;
END $$;
--> statement-breakpoint

ALTER TABLE "retailer_url" ADD COLUMN "retailer_domain" text;
--> statement-breakpoint

-- Populate from the existing relationship before the foreign key or table is
-- removed, so every URL keeps a domain even if its URL text is unparseable.
UPDATE "retailer_url" AS ru
SET "retailer_domain" = lower(regexp_replace(r."url", '^www\.', '', 'i'))
FROM "retailer" AS r
WHERE ru."retailer_id" = r."id";
--> statement-breakpoint

-- Report rows whose URL hostname disagrees with the retailer domain. The URL
-- is authoritative (it is the actual scrape target), so those rows are
-- reassigned below. The sample makes the reassignment auditable.
DO $$
DECLARE
  mismatch_count integer;
  mismatch_sample text;
BEGIN
  WITH derived AS (
    SELECT ru."id" AS id,
           lower(regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(ru."url", '^[a-zA-Z][a-zA-Z0-9+.-]*://', '', 'i'),
                   '^[^@/]*@', ''
                 ),
                 '[/?#].*$', ''
               ),
               ':[0-9]+$', ''
             ),
             '^www\.', '', 'i'
           )) AS host
    FROM "retailer_url" AS ru
  ), mismatches AS (
    SELECT d."id", d."host", ru."retailer_domain" AS old_domain
    FROM derived AS d
    JOIN "retailer_url" AS ru ON ru."id" = d."id"
    WHERE d."host" <> ''
      AND d."host" IS DISTINCT FROM lower(regexp_replace(ru."retailer_domain", '^www\.', '', 'i'))
  )
  SELECT count(*), (
    SELECT string_agg(format('%s: %s -> %s', "id", old_domain, "host"), ', ')
    FROM (SELECT "id", old_domain, "host" FROM mismatches ORDER BY "id" LIMIT 10) AS s
  )
  INTO mismatch_count, mismatch_sample
  FROM mismatches;

  IF mismatch_count > 0 THEN
    RAISE NOTICE 'Spec 07: % retailer_url row(s) had a URL hostname disagreeing with the retailer domain; URL wins. Sample: %',
      mismatch_count, mismatch_sample;
  END IF;
END $$;
--> statement-breakpoint

-- Reassign mismatches to the URL-derived (www-stripped, lowercased) hostname.
WITH derived AS (
  SELECT ru."id" AS id,
         lower(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(ru."url", '^[a-zA-Z][a-zA-Z0-9+.-]*://', '', 'i'),
                 '^[^@/]*@', ''
               ),
               '[/?#].*$', ''
             ),
             ':[0-9]+$', ''
           ),
           '^www\.', '', 'i'
         )) AS host
  FROM "retailer_url" AS ru
)
UPDATE "retailer_url" AS ru
SET "retailer_domain" = d."host"
FROM derived AS d
WHERE ru."id" = d."id"
  AND d."host" <> ''
  AND d."host" IS DISTINCT FROM lower(regexp_replace(ru."retailer_domain", '^www\.', '', 'i'));
--> statement-breakpoint

ALTER TABLE "retailer_url" ALTER COLUMN "retailer_domain" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "retailer_url" DROP CONSTRAINT "retailer_url_retailer_id_retailer_id_fk";
--> statement-breakpoint

DROP INDEX "retailer_url_retailer_id_idx";
--> statement-breakpoint

ALTER TABLE "retailer_url" DROP COLUMN "retailer_id";
--> statement-breakpoint

CREATE INDEX "retailer_url_retailer_domain_idx" ON "retailer_url" USING btree ("retailer_domain");
--> statement-breakpoint

DROP TABLE "retailer";
--> statement-breakpoint

DO $$
DECLARE
  frag_count integer;
  url_count integer;
  price_count integer;
  domain_count integer;
BEGIN
  SELECT count(*) INTO frag_count FROM "fragrance";
  SELECT count(*) INTO url_count FROM "retailer_url";
  SELECT count(*) INTO price_count FROM "price";
  SELECT count(DISTINCT "retailer_domain") INTO domain_count FROM "retailer_url";
  RAISE NOTICE 'Spec 07 post-migration: fragrances=%, urls=%, prices=%, distinct_domains=%',
    frag_count, url_count, price_count, domain_count;
END $$;
