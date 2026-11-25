package main

import (
	"crypto/rand"
	"fmt"
	"os"
	"strconv"
	"time"
)

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("id-%d", os.Getpid())
	}
	return fmt.Sprintf("%x", b[:])
}

func atoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

// formatPrice renders a stored minor-units price with its currency.
func formatPrice(l RetailerLink) string {
	if l.LastPriceMinor == nil {
		return "—"
	}
	currency := "USD"
	if l.LastPriceCurrency != nil && *l.LastPriceCurrency != "" {
		currency = *l.LastPriceCurrency
	}
	return fmt.Sprintf("%s %.2f", currency, float64(*l.LastPriceMinor)/100)
}

// rowStatus renders the fixed freshness wording for one link row.
func rowStatus(l RetailerLink) string {
	switch l.LinkStatus {
	case "ok":
		return "confirmed " + fmtTime(l.LastSuccessAt)
	case "failed":
		return "price from " + fmtTime(l.LastSuccessAt) + ", refresh failed " + fmtTime(l.LastAttemptAt)
	case "blocked":
		return "price from " + fmtTime(l.LastSuccessAt) + ", blocked " + fmtTime(l.LastAttemptAt)
	default:
		return "no check yet"
	}
}

func fmtTime(t *time.Time) string {
	if t == nil {
		return "never"
	}
	return t.Format("2006-01-02 15:04")
}

// envOr returns the environment value or the default.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
