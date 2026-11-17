import type { RouterOutputs } from "../../../server/trpc/router";

// API-facing shapes come from the tRPC router, so adding a field (such as
// `scrapedAt`) cannot drift from what the server actually returns. Only
// component-only view models below stay local.
type FragranceRow = RouterOutputs["getFragrances"][number];
type PriceRow = RouterOutputs["getLatestPrices"][number];

// Narrow the API rows to the fields the UI actually renders. Picking from the
// inferred types keeps them in sync with the router without exposing
// server-only bookkeeping to components.
export type Fragrance = Pick<FragranceRow["fragrance"], "id" | "brand" | "name">;
export type RetailerUrl = Pick<NonNullable<FragranceRow["retailer_url"]>, "id" | "url">;

// tRPC serializes timestamps to strings on the wire, but callers may also
// pass real Dates (e.g. in tests). Keep both, while requiring the field.
export type PriceInfo = Omit<PriceRow, "scrapedAt"> & {
  scrapedAt: PriceRow["scrapedAt"] | Date;
};

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
  addUrlError?: { fragranceId: string; message: string } | null;
  priceStatus: "loading" | "error" | "success";
  deleteFragrancePending: boolean;
  deleteUrlPending: boolean;
}

export interface UrlRowProps {
  url: RetailerUrl;
  price: PriceInfo | undefined;
  priceStatus: "loading" | "error" | "success";
  onRequestDelete: (id: string, label: string) => void;
  deletePending: boolean;
}
