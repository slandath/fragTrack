# Migration runbook

One-time operator procedures for data cleanups tied to migrations that have already been applied. These are not part of normal setup or deployment — see the [README](../README.md) for the live quarantined-row review query and current schema behavior.

## 0005 — aborted legacy price conversion

Migration `0005` converts valid legacy decimal amounts to cents and aborts with a row report when a value cannot be safely converted, so ambiguous history is never silently rewritten. All changes roll back on abort. Whole-number legacy values (for example `2030`, possibly a collapsed price range) convert but stay quarantined and hidden from displayed prices until an operator verifies them.

A legacy amount of `0.00` converts to zero and passes the row report (it is convertible), but the later positive-amount check aborts the migration. The abort rolls back `amount_minor`, so find the rows through the legacy text column, correct or delete them, then retry the migration:

```sql
SELECT id, retailer_url_id, amount FROM price WHERE amount ~ '^0+(\.0+)?$';
```

## 0006 — duplicate URLs in pre-existing history

Migration `0006` does not canonicalize rows stored before it: a legacy URL with a fragment (or a default port) and its canonical form can coexist for the same fragrance, because the unique constraint compares stored text. The constraint cannot detect these pairs until they are reconciled.

Do **not** simply update the legacy row's `url` to the canonical form while both rows exist — the `retailer_url_fragrance_url_unique` constraint will reject it. Identify candidate pairs first:

```sql
SELECT a.id AS legacy_id, a.url AS legacy_url, b.id AS canonical_id, b.url AS canonical_url
FROM retailer_url a
JOIN retailer_url b
  ON b.fragrance_id = a.fragrance_id
 AND b.id <> a.id
 AND b.url = regexp_replace(regexp_replace(regexp_replace(a.url, '#.*$', ''), ':443/', '/'), ':80/', '/')
WHERE a.url LIKE '%#%' OR a.url LIKE '%:443/%' OR a.url LIKE '%:80/%';
```

For each pair, merge in one transaction: move every linked price observation from the legacy row to the canonical row, then delete the legacy row. Verify the before/after price counts per canonical URL.

```sql
BEGIN;
UPDATE price SET retailer_url_id = :canonical_id WHERE retailer_url_id = :legacy_id;
DELETE FROM retailer_url WHERE id = :legacy_id;
COMMIT;
```

Keep the canonical row (the one without fragment/default port) so existing links and canonicalization rules stay consistent.
