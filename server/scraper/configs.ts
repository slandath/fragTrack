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
};
