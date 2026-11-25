package main

import "time"

const schemaVersion = 1

type Fragrance struct {
	ID     string
	Brand  string
	Name   string
	SizeMl int
	Owned  bool
}

type RetailerLink struct {
	ID                string
	FragranceID       string
	Retailer          string
	URL               string
	LastPriceMinor    *int64
	LastPriceCurrency *string
	LastSuccessAt     *time.Time
	LastAttemptAt     *time.Time
	LinkStatus        string // ok | failed | blocked | never-checked
}

func (l RetailerLink) StateLabel() string {
	switch l.LinkStatus {
	case "ok":
		return "confirmed"
	case "failed":
		return "refresh failed"
	case "blocked":
		return "blocked"
	default:
		return "no check yet"
	}
}
