package main

import (
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/andybalholm/cascadia"
	"golang.org/x/net/html"
)

var pricePattern = regexp.MustCompile(`\d[\d,]*(\.\d{1,2})?`)

// parseRetailerPrice extracts the authoritative price from a retailer page.
// Returns minor units (cents) and the retailer-configured currency.
func parseRetailerPrice(body []byte, cfg RetailerConfig) (int64, string, error) {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return 0, "", fmt.Errorf("parse html: %w", err)
	}
	sel, err := cascadia.Compile(cfg.PriceSelector)
	if err != nil {
		return 0, "", fmt.Errorf("parse selector %q: %w", cfg.PriceSelector, err)
	}
	matches := sel.MatchAll(doc)
	if len(matches) == 0 {
		return 0, "", fmt.Errorf("no element matching %q", cfg.PriceSelector)
	}
	node := matches[0]
	text := strings.TrimSpace(nodeText(node))
	match := pricePattern.FindString(text)
	if match == "" {
		return 0, "", fmt.Errorf("no price in %q", text)
	}
	clean := strings.ReplaceAll(match, ",", "")
	var dollars float64
	if _, err := fmt.Sscanf(clean, "%f", &dollars); err != nil {
		return 0, "", fmt.Errorf("parse price %q: %w", clean, err)
	}
	minor := int64(math.Round(dollars * 100))
	if cfg.Currency == "" {
		return minor, "USD", nil
	}
	return minor, cfg.Currency, nil
}

func nodeText(n *html.Node) string {
	var b strings.Builder
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			b.WriteString(c.Data)
		}
		if c.Type == html.ElementNode {
			b.WriteString(nodeText(c))
		}
	}
	return b.String()
}
