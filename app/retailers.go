package main

// RetailerConfig is selector knowledge, kept as code. Ported from
// server/scraper/configs.ts domainConfigs. One selector per retailer is
// the authoritative price; the exceptions noted below are deliberate,
// not accidental fallbacks to unrelated page text.
type RetailerConfig struct {
	Name          string // display name stored in retailer_links.retailer
	Domain        string // key, "www" removed
	PriceSelector string
	Currency      string
}

// retailerConfigs is the default set: all eight retailers carried over
// from the previous implementation. A refresh only visits retailers
// with pasted URLs; a config entry alone causes no network traffic.
var retailerConfigs = []RetailerConfig{
	{
		Name:          "Aura Fragrance",
		Domain:        "aurafragrance.com",
		PriceSelector: "#productPrice-product-template .visually-hidden",
		Currency:      "USD",
	},
	{
		Name:          "Beauty House",
		Domain:        "beautyhouse.com",
		PriceSelector: ".h4.text-on-sale",
		Currency:      "USD",
	},
	{
		Name:          "CamelCamelCamel",
		Domain:        "camelcamelcamel.com",
		PriceSelector: ".bgp",
		Currency:      "USD",
	},
	{
		Name:   "FragFlex",
		Domain: "fragflex.com",
		// <main>-scoped: the sticky-menu block ($0.99 Flex Care) also
		// matches `.price-custom__sale .money` and precedes the PDP price
		// in DOM order. The authoritative node is the <main> PDP price.
		PriceSelector: "main .price-custom__sale .money",
		Currency:      "USD",
	},
	{
		Name:          "FragranceNet",
		Domain:        "fragrancenet.com",
		PriceSelector: ".text-dark-purple",
		Currency:      "USD",
	},
	{
		Name:          "FragranceX",
		Domain:        "fragrancex.com",
		PriceSelector: ".price-value",
		Currency:      "USD",
	},
	{
		Name:          "Jomashop",
		Domain:        "jomashop.com",
		PriceSelector: ".now-price > span:first-child",
		Currency:      "USD",
	},
	{
		Name:   "Perfume Box",
		Domain: "perfumebox.com",
		// Current template renders the sale price in
		// `.pb-pdp__price-current--sale`; the old `[data-product-price]`
		// attribute no longer exists on live pages.
		PriceSelector: ".pb-pdp__price-current",
		Currency:      "USD",
	},
}

func retailerDomainForName(name string) string {
	if r, ok := retailerByName(name); ok {
		return r.Domain
	}
	return name
}

func retailerByName(name string) (RetailerConfig, bool) {
	for _, r := range retailerConfigs {
		if r.Name == name {
			return r, true
		}
	}
	return RetailerConfig{}, false
}
