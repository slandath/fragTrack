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
  amount: string;
  currency: string;
}

export interface HeaderProps {
  userName: string;
}

export interface AddFragranceFormProps {
  supportedDomains: string[];
  onAdd: (brand: string, name: string) => Promise<void>;
  isPending: boolean;
}

export interface FragranceCardProps {
  fragrance: Fragrance;
  urls: RetailerUrl[];
  latestPrices: Record<string, PriceInfo | undefined>;
  expandedFragranceId: string | null;
  onExpand: (id: string | null) => void;
  onDeleteFragrance: (id: string) => Promise<void>;
  onDeleteUrl: (id: string) => Promise<void>;
  onAddUrl: (fragranceId: string, url: string) => Promise<void>;
  addUrlPending: boolean;
  deleteFragrancePending: boolean;
  deleteUrlPending: boolean;
}

export interface UrlRowProps {
  url: RetailerUrl;
  price: PriceInfo | undefined;
  onDelete: (id: string) => Promise<void>;
  deletePending: boolean;
}
