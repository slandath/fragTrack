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
	"fragflex.com.html":        3752,
	"fragrancenet.com.html":    11000,
	"fragrancex.com.html":      9525,
	"jomashop.com.html":        19900,
	"perfumebox.com.html":      3525,
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

// TestFragFlexPicksMainPriceNotSticky pins the live markup shape:
// the sticky-menu block ($0.99 Flex Care) precedes the <main> PDP
// price ($37.52). The selector must return the <main> price.
func TestFragFlexPicksMainPriceNotSticky(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("fixtures", "fragflex.com.html"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	cfg, _ := retailerByName("FragFlex")
	minor, _, err := parseRetailerPrice(body, cfg)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if minor != 3752 {
		t.Fatalf("got %d minor units, want 3752 (main PDP price, not sticky $0.99)", minor)
	}
}

// TestAmbiguousMultiPriceRejected proves the parser never confirms a
// wrong-but-plausible amount from text holding two prices.
func TestAmbiguousMultiPriceRejected(t *testing.T) {
	cfg := RetailerConfig{Name: "T", Domain: "t.com", PriceSelector: ".money", Currency: "USD"}
	body := []byte(`<html><body><span class="money">$0.99 $37.52</span></body></html>`)
	if _, _, err := parseRetailerPrice(body, cfg); err == nil {
		t.Fatal("expected error for multi-price text, got nil")
	}
	body2 := []byte(`<html><body><span class="money">Sale price $35.25 Regular price $87.00</span></body></html>`)
	if _, _, err := parseRetailerPrice(body2, cfg); err == nil {
		t.Fatal("expected error for sale+regular text, got nil")
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
