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
  "www.beautyhouse.com": {
    selectors: {
      price: ".h4 text-on-sale > span:first-child",
      currency: "USD",
    },
  },
  "www.fragflex.com": {
    selectors: {
      price:
        "price-item price-custom-item price-item--sale price-item--last  price-custom-product-page   sale-price",
      currency: "",
    },
  },
  "www.perfumebox.com": {
    selectors: {
      price: "product__price on-sale",
      currency: "USD",
    },
  },
  "www.fragrancex.com": {
    selectors: {
      price: ".price-value",
      currency: "USD",
    },
  },
};
