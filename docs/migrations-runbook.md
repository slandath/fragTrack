# Migration runbook

One-time operator procedures for data cleanups tied to migrations that have already been applied. These are not part of normal setup or deployment — see the [README](../README.md) for the live quarantined-row review query and current schema behavior.

## 0005 — aborted legacy price conversion

Migration `0005` converts valid legacy decimal amounts to cents and aborts with a row report when a value cannot be safely converted, so ambiguous history is never silently rewritten. All changes roll back on abort. Whole-number legacy values (for example `2030`, possibly a collapsed price range) convert but stay quarantined and hidden from displayed prices until an operator verifies them.

A legacy amount of `0.00` converts to zero and passes the row report (it is convertible), but the later positive-amount check aborts the migration. The abort rolls back `amount_minor`, so find the rows through the legacy text column, correct or delete them, then retry the migration:

```sql
SELECT id, retailer_url_id, amount FROM price WHERE amount ~ '^0+(\.0+)?$';
```

## 0006 — duplicate URLs in pre-existing history

Migration `0006` does not canonicalize rows stored before it: a legacy URL with a fragment and its canonical form can coexist and bypass duplicate detection. Normalize such history before relying on the unique constraint for old data.
