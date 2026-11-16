export interface Fragrance {
  id: string;
  brand: string;
  name: string;
}

export interface RetailerUrl {
  id: string;
  url: string;
}

export interface PriceInfo {
  amountMinor: number;
  currency: string;
  scrapedAt?: string | Date;
}

export interface HeaderProps {
  userName: string;
  onSignOut: () => void;
  signOutPending: boolean;
  signOutError?: string | null;
}

export interface AddFragranceFormProps {
  supportedDomains: string[];
  onAdd: (brand: string, name: string) => Promise<void>;
  isPending: boolean;
  error?: string | null;
}

export interface FragranceCardProps {
  fragrance: Fragrance;
  urls: RetailerUrl[];
  latestPrices: Record<string, PriceInfo | undefined>;
  expandedFragranceId: string | null;
  onExpand: (id: string | null) => void;
  onRequestDeleteFragrance: (id: string, label: string) => void;
  onRequestDeleteUrl: (id: string, label: string) => void;
  onAddUrl: (fragranceId: string, url: string) => Promise<void>;
  addUrlPending: boolean;
  addUrlError?: string | null;
  deleteFragrancePending: boolean;
  deleteUrlPending: boolean;
}

export interface UrlRowProps {
  url: RetailerUrl;
  price: PriceInfo | undefined;
  onRequestDelete: (id: string, label: string) => void;
  deletePending: boolean;
}
