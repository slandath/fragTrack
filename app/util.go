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

// currencySymbol renders the prefix for a stored currency code.
// Unknown codes fall back to "CODE " so a price is never a bare number.
func currencySymbol(code string) string {
	switch code {
	case "USD":
		return "$"
	case "EUR":
		return "€"
	case "GBP":
		return "£"
	case "JPY":
		return "¥"
	case "CAD":
		return "CA$"
	case "AUD":
		return "A$"
	case "CHF":
		return "CHF "
	default:
		return code + " "
	}
}

// formatPrice renders a stored minor-units price with its currency symbol
// prefix (e.g. $110.00 for USD). Display-only; storage is untouched.
func formatPrice(l RetailerLink) string {
	if l.LastPriceMinor == nil {
		return "—"
	}
	currency := "USD"
	if l.LastPriceCurrency != nil && *l.LastPriceCurrency != "" {
		currency = *l.LastPriceCurrency
	}
	return fmt.Sprintf("%s%.2f", currencySymbol(currency), float64(*l.LastPriceMinor)/100)
}

// rowStatus renders the fixed freshness wording for one link row.
// A stored failure reason is appended so a failed/blocked row stays
// actionable ("selector missed", "http 403") instead of a bare flag.
func rowStatus(l RetailerLink) string {
	switch l.LinkStatus {
	case "ok":
		return "confirmed " + fmtTime(l.LastSuccessAt)
	case "failed":
		s := "price from " + fmtTime(l.LastSuccessAt) + ", refresh failed " + fmtTime(l.LastAttemptAt)
		if l.LastFailure != nil && *l.LastFailure != "" {
			s += ": " + *l.LastFailure
		}
		return s
	case "blocked":
		s := "price from " + fmtTime(l.LastSuccessAt) + ", blocked " + fmtTime(l.LastAttemptAt)
		if l.LastFailure != nil && *l.LastFailure != "" {
			s += ": " + *l.LastFailure
		}
		return s
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
