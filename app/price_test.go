package main

import (
	"os"
	"path/filepath"
	"testing"
)

var fixtureExpectations = map[string]int64{
	"aurafragrance.com.html":   5499,
	"beautyhouse.com.html":     2999,
	"camelcamelcamel.com.html": 12000,
	"fragflex.com.html":        8850,
	"fragrancenet.com.html":    11000,
	"fragrancex.com.html":      9525,
	"jomashop.com.html":        19900,
	"perfumebox.com.html":      7500,
}

// TestAllRetailersHaveFixtures pins the ported config: every configured
// retailer must have a fixture whose price its selector extracts.
func TestAllRetailersHaveFixtures(t *testing.T) {
	for _, cfg := range retailerConfigs {
		name := cfg.Domain + ".html"
		body, err := os.ReadFile(filepath.Join("fixtures", name))
		if err != nil {
			t.Fatalf("retailer %s (%s): missing fixture %s: %v", cfg.Name, cfg.Domain, name, err)
		}
		minor, currency, err := parseRetailerPrice(body, cfg)
		if err != nil {
			t.Fatalf("retailer %s: %v", cfg.Name, err)
		}
		want := fixtureExpectations[name]
		if minor != want {
			t.Fatalf("retailer %s: got %d minor units, want %d", cfg.Name, minor, want)
		}
		if currency != cfg.Currency {
			t.Fatalf("retailer %s: currency %q, want %q", cfg.Name, currency, cfg.Currency)
		}
	}
}

func fixtureNameFor(cfg RetailerConfig) string {
	for name := range fixtureExpectations {
		if cfg.Domain == domainFromFixture(name) {
			return name
		}
	}
	return ""
}

func domainFromFixture(name string) string {
	return name[:len(name)-len(".html")]
}
