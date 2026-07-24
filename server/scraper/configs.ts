export interface DomainConfig {
  selectors: {
    price: string;
    currency?: string;
  };
}

export const domainConfigs: Record<string, DomainConfig> = {
  "www.jomashop.com": {
    selectors: {
      price: ".now-price > span:first-child",
      currency: "USD",
    },
  },
  "beautyhouse.com": {
    selectors: {
      price: ".h4.text-on-sale",
      currency: "USD",
    },
  },
  "fragflex.com": {
    selectors: {
      price: ".price-custom__sale .money",
      currency: "USD",
    },
  },
  "perfumebox.com": {
    selectors: {
      price: "[data-product-price] [aria-hidden='true']",
      currency: "USD",
    },
  },
  "www.fragrancex.com": {
    selectors: {
      price: ".price-value",
      currency: "USD",
    },
  },
  "aurafragrance.com": {
    selectors: {
      price: "#productPrice-product-template .visually-hidden",
      currency: "USD",
    },
  },
  "fragrancenet.com": {
    selectors: {
      price: ".text-dark-purple",
      currency: "USD",
    },
  },
};
