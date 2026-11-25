package main

import (
	"path/filepath"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *sqliteStore {
	t.Helper()
	s, err := openSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestStoreRoundTripAndOrdering(t *testing.T) {
	s := newTestStore(t)
	creed := Fragrance{ID: "b", Brand: "Creed", Name: "Aventus", SizeMl: 100}
	chanel := Fragrance{ID: "a", Brand: "Chanel", Name: "Bleu", SizeMl: 50}
	dior := Fragrance{ID: "c", Brand: "Dior", Name: "Sauvage", SizeMl: 200, Owned: true}
	for _, f := range []Fragrance{creed, chanel, dior} {
		if err := s.CreateFragrance(f, nil); err != nil {
			t.Fatalf("create: %v", err)
		}
	}
	all, err := s.ListFragrances(nil)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(all) != 3 || all[0].Brand != "Chanel" || all[1].Brand != "Creed" || all[2].Brand != "Dior" {
		t.Fatalf("ordering: %+v", all)
	}
	owned := false
	buyList, err := s.ListFragrances(&owned)
	if err != nil || len(buyList) != 2 {
		t.Fatalf("buy list: %+v, %v", buyList, err)
	}
	want := true
	ownedList, err := s.ListFragrances(&want)
	if err != nil || len(ownedList) != 1 || ownedList[0].Brand != "Dior" {
		t.Fatalf("owned list: %+v, %v", ownedList, err)
	}
}

func TestStoreFreshnessSemantics(t *testing.T) {
	s := newTestStore(t)
	f := Fragrance{ID: "f1", Brand: "Creed", Name: "Aventus", SizeMl: 100}
	link := RetailerLink{ID: "l1", Retailer: "FragranceNet", URL: "https://example.com/p"}
	if err := s.CreateFragrance(f, []RetailerLink{link}); err != nil {
		t.Fatalf("create: %v", err)
	}
	at := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	if err := s.RecordSuccess("l1", at, 11000, "USD"); err != nil {
		t.Fatalf("record success: %v", err)
	}
	links, _ := s.LinksForFragrance("f1")
	if len(links) != 1 || links[0].LinkStatus != "ok" || links[0].LastPriceMinor == nil || *links[0].LastPriceMinor != 11000 {
		t.Fatalf("after success: %+v", links)
	}
	if links[0].LastSuccessAt == nil || links[0].LastAttemptAt == nil {
		t.Fatalf("timestamps after success: %+v", links[0])
	}
	// A failed attempt keeps the previous price and stamps the attempt.
	later := at.Add(time.Hour)
	if err := s.RecordAttempt("l1", later, "failed"); err != nil {
		t.Fatalf("record attempt: %v", err)
	}
	links, _ = s.LinksForFragrance("f1")
	if links[0].LinkStatus != "failed" || links[0].LastPriceMinor == nil || *links[0].LastPriceMinor != 11000 {
		t.Fatalf("price must survive a failed attempt: %+v", links[0])
	}
	if links[0].LastAttemptAt == nil || !links[0].LastAttemptAt.After(*links[0].LastSuccessAt) {
		t.Fatalf("attempt must be after success: %+v", links[0])
	}
}

func TestStoreVersionGuard(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.db.Exec(`UPDATE meta SET value = ? WHERE key = 'version'`, schemaVersion+1); err != nil {
		t.Fatalf("bump version: %v", err)
	}
	_ = s.Close()
	if _, err := openSQLite(filepath.Join(filepath.Dir(s.path), "test.db")); err == nil {
		t.Fatal("expected version guard refusal, got nil error")
	}
}
