package main

import "testing"

// TestFormatPriceSymbol pins issue #39: every price cell shows the
// currency symbol prefix, never a bare number or a trailing code.
func TestFormatPriceSymbol(t *testing.T) {
	p := func(minor int64, currency string) RetailerLink {
		return RetailerLink{LastPriceMinor: &minor, LastPriceCurrency: &currency}
	}
	cases := map[string]string{
		"USD": "$110.00",
		"EUR": "€110.00",
		"GBP": "£110.00",
		"JPY": "¥110.00",
		"CAD": "CA$110.00",
	}
	for code, want := range cases {
		if got := formatPrice(p(11000, code)); got != want {
			t.Fatalf("%s: got %q, want %q", code, got, want)
		}
	}
	if got := formatPrice(p(11000, "XYZ")); got != "XYZ 110.00" {
		t.Fatalf("unknown code fallback: got %q", got)
	}
	if got := formatPrice(RetailerLink{}); got != "—" {
		t.Fatalf("missing price: got %q", got)
	}
}
