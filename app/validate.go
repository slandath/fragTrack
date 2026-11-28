package main

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Validation bounds for issue #40: millilitres must be positive and sane.
const (
	minSizeMl = 1
	maxSizeMl = 9999
)

// validateSize parses a millilitre field strictly: empty, non-numeric,
// zero, negative, and absurd values are all invalid.
func validateSize(raw string) (int, bool) {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < minSizeMl || n > maxSizeMl {
		return 0, false
	}
	return n, true
}

// validateRetailerURL requires a well-formed http/https URL with a host
// and no userinfo (credentials). Blank is allowed (means "skip").
func validateRetailerURL(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", true
	}
	if strings.ContainsAny(trimmed, " \t\n\r") {
		return "", false
	}
	u, err := url.Parse(trimmed)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
		return "", false
	}
	return trimmed, true
}

// validateFragranceForm checks brand, name, size, and every known retailer
// URL field. Unknown form fields are ignored. Returns the parsed size,
// cleaned links, and one field-level message per problem.
func validateFragranceForm(r *http.Request) (sizeMl int, links []RetailerLink, errs []string) {
	if strings.TrimSpace(r.FormValue("brand")) == "" {
		errs = append(errs, "brand: must not be empty")
	}
	if strings.TrimSpace(r.FormValue("name")) == "" {
		errs = append(errs, "name: must not be empty")
	}
	n, ok := validateSize(r.FormValue("size_ml"))
	if !ok {
		errs = append(errs, "size_ml: must be between 1 and 9999 ml")
	} else {
		sizeMl = n
	}
	for _, cfg := range retailerConfigs {
		field := "url_" + cfg.Domain
		raw := r.FormValue(field)
		if strings.TrimSpace(raw) == "" {
			continue
		}
		clean, ok := validateRetailerURL(raw)
		if !ok {
			errs = append(errs, field+": must be a valid http(s) URL")
			continue
		}
		links = append(links, RetailerLink{ID: newID(), Retailer: cfg.Name, URL: clean})
	}
	return sizeMl, links, errs
}
