export interface DomainConfig {
  selectors: {
    price: string;
    currency?: string;
  };
}

// One selector per retailer is the authoritative price. Where a page exposes
// several prices, the selector below is the one we deliberately read; it must
// not be swapped for a different candidate without an explicit decision.
// Two retailers expose the authoritative price only in an accessibility
// node (visually-hidden / aria-hidden); those are documented exceptions, not
// an accidental fallback to unrelated page text.
//
// Remove "www" from domain keys.
export const domainConfigs: Record<string, DomainConfig> = {
  "aurafragrance.com": {
    selectors: {
      // Accessibility-only node is the authoritative price on this template.
      price: "#productPrice-product-template .visually-hidden",
      currency: "USD",
    },
  },
  "beautyhouse.com": {
    selectors: {
      price: ".h4.text-on-sale",
      currency: "USD",
    },
  },
  "camelcamelcamel.com": {
    selectors: { price: ".bgp", currency: "USD" },
  },
  "fragflex.com": {
    selectors: {
      price: ".price-custom__sale .money",
      currency: "USD",
    },
  },
  "fragrancenet.com": {
    selectors: {
      price: ".text-dark-purple",
      currency: "USD",
    },
  },
  "fragrancex.com": {
    selectors: {
      price: ".price-value",
      currency: "USD",
    },
  },
  "jomashop.com": {
    selectors: {
      price: ".now-price > span:first-child",
      currency: "USD",
    },
  },
  "perfumebox.com": {
    selectors: {
      // aria-hidden node is the authoritative price on this template.
      price: "[data-product-price] [aria-hidden='true']",
      currency: "USD",
    },
  },
};
