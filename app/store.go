package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Store is the only persistence seam. Handlers depend on this interface,
// never on SQL. A Postgres fallback can implement it later.
type Store interface {
	ListFragrances(owned *bool) ([]Fragrance, error)
	GetFragrance(id string) (*Fragrance, error)
	CreateFragrance(f Fragrance, links []RetailerLink) error
	UpdateFragrance(f Fragrance, links []RetailerLink) error
	DeleteFragrance(id string) error
	LinksForFragrance(fragranceID string) ([]RetailerLink, error)
	RecordAttempt(linkID string, at time.Time, status string) error
	RecordSuccess(linkID string, at time.Time, priceMinor int64, currency string) error
	Backup(dir string) (string, error)
	Close() error
}

type sqliteStore struct {
	db   *sql.DB
	path string
}

func openSQLite(path string) (*sqliteStore, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	s := &sqliteStore{db: db, path: path}
	if err := s.ensureSchema(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// ensureSchema creates tables idempotently and refuses a database whose
// stored version is newer than this binary supports.
func (s *sqliteStore) ensureSchema() error {
	ddl := []string{
		`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
		`CREATE TABLE IF NOT EXISTS fragrances (
			id TEXT PRIMARY KEY,
			brand TEXT NOT NULL,
			name TEXT NOT NULL,
			size_ml INTEGER NOT NULL,
			owned INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS retailer_links (
			id TEXT PRIMARY KEY,
			fragrance_id TEXT NOT NULL REFERENCES fragrances(id) ON DELETE CASCADE,
			retailer TEXT NOT NULL,
			url TEXT NOT NULL,
			last_price_minor INTEGER,
			last_price_currency TEXT,
			last_success_at TEXT,
			last_attempt_at TEXT,
			link_status TEXT NOT NULL DEFAULT 'never-checked'
		)`,
		`CREATE INDEX IF NOT EXISTS idx_links_fragrance ON retailer_links(fragrance_id)`,
	}
	for _, stmt := range ddl {
		if _, err := s.db.Exec(stmt); err != nil {
			return err
		}
	}
	var version int
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key = 'version'`).Scan(&version)
	if err == sql.ErrNoRows {
		if _, err := s.db.Exec(`INSERT INTO meta(key, value) VALUES('version', ?)`, schemaVersion); err != nil {
			return err
		}
		return nil
	}
	if err != nil {
		return err
	}
	if version > schemaVersion {
		return fmt.Errorf("database schema version %d is newer than supported %d", version, schemaVersion)
	}
	return nil
}

func (s *sqliteStore) ListFragrances(owned *bool) ([]Fragrance, error) {
	q := `SELECT id, brand, name, size_ml, owned FROM fragrances`
	var args []any
	if owned != nil {
		q += ` WHERE owned = ?`
		args = append(args, boolInt(*owned))
	}
	q += ` ORDER BY brand COLLATE NOCASE ASC, name COLLATE NOCASE ASC`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Fragrance
	for rows.Next() {
		var f Fragrance
		var ownedInt int
		if err := rows.Scan(&f.ID, &f.Brand, &f.Name, &f.SizeMl, &ownedInt); err != nil {
			return nil, err
		}
		f.Owned = ownedInt != 0
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *sqliteStore) GetFragrance(id string) (*Fragrance, error) {
	var f Fragrance
	var ownedInt int
	err := s.db.QueryRow(`SELECT id, brand, name, size_ml, owned FROM fragrances WHERE id = ?`,
		id).Scan(&f.ID, &f.Brand, &f.Name, &f.SizeMl, &ownedInt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	f.Owned = ownedInt != 0
	return &f, nil
}

func (s *sqliteStore) CreateFragrance(f Fragrance, links []RetailerLink) error {
	return s.tx(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO fragrances(id, brand, name, size_ml, owned)
			VALUES(?, ?, ?, ?, ?)`, f.ID, f.Brand, f.Name, f.SizeMl, boolInt(f.Owned)); err != nil {
			return err
		}
		return insertLinks(tx, f.ID, links)
	})
}

func (s *sqliteStore) UpdateFragrance(f Fragrance, links []RetailerLink) error {
	return s.tx(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE fragrances SET brand = ?, name = ?, size_ml = ?, owned = ?
			WHERE id = ?`, f.Brand, f.Name, f.SizeMl, boolInt(f.Owned), f.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM retailer_links WHERE fragrance_id = ?`, f.ID); err != nil {
			return err
		}
		return insertLinks(tx, f.ID, links)
	})
}

func insertLinks(tx *sql.Tx, fragranceID string, links []RetailerLink) error {
	for _, l := range links {
		if strings.TrimSpace(l.URL) == "" {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO retailer_links(id, fragrance_id, retailer, url, link_status)
			VALUES(?, ?, ?, ?, 'never-checked')`, l.ID, fragranceID, l.Retailer, l.URL); err != nil {
			return err
		}
	}
	return nil
}

func (s *sqliteStore) DeleteFragrance(id string) error {
	_, err := s.db.Exec(`DELETE FROM fragrances WHERE id = ?`, id)
	return err
}

func (s *sqliteStore) LinksForFragrance(fragranceID string) ([]RetailerLink, error) {
	rows, err := s.db.Query(`SELECT id, fragrance_id, retailer, url,
		last_price_minor, last_price_currency, last_success_at, last_attempt_at, link_status
		FROM retailer_links WHERE fragrance_id = ? ORDER BY retailer COLLATE NOCASE ASC`, fragranceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RetailerLink
	for rows.Next() {
		var l RetailerLink
		var minor sql.NullInt64
		var curr sql.NullString
		var success, attempt sql.NullString
		if err := rows.Scan(&l.ID, &l.FragranceID, &l.Retailer, &l.URL,
			&minor, &curr, &success, &attempt, &l.LinkStatus); err != nil {
			return nil, err
		}
		if minor.Valid {
			v := minor.Int64
			l.LastPriceMinor = &v
		}
		if curr.Valid {
			v := curr.String
			l.LastPriceCurrency = &v
		}
		l.LastSuccessAt = parseTime(success)
		l.LastAttemptAt = parseTime(attempt)
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *sqliteStore) RecordAttempt(linkID string, at time.Time, status string) error {
	_, err := s.db.Exec(`UPDATE retailer_links SET last_attempt_at = ?, link_status = ?
		WHERE id = ?`, at.UTC().Format(time.RFC3339), status, linkID)
	return err
}

func (s *sqliteStore) RecordSuccess(linkID string, at time.Time, priceMinor int64, currency string) error {
	ts := at.UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`UPDATE retailer_links
		SET last_price_minor = ?, last_price_currency = ?, last_success_at = ?,
		last_attempt_at = ?, link_status = 'ok'
		WHERE id = ?`, priceMinor, currency, ts, ts, linkID)
	return err
}

// Backup checkpoints the WAL then copies the self-contained database file.
func (s *sqliteStore) Backup(dir string) (string, error) {
	if _, err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return "", err
	}
	name := fmt.Sprintf("fragtrack-%s.db", time.Now().UTC().Format("20060102-150405"))
	return copyFile(s.path, dir+"/"+name)
}

func (s *sqliteStore) Close() error { return s.db.Close() }

func (s *sqliteStore) tx(fn func(*sql.Tx) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func parseTime(ns sql.NullString) *time.Time {
	if !ns.Valid || ns.String == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, ns.String)
	if err != nil {
		return nil
	}
	return &t
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
