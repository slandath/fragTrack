import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatObservationTime, formatPrice, getPriceFreshness } from "@/lib/price";
import type { UrlRowProps } from "./types";

export default function UrlRow({
  url,
  price,
  priceStatus,
  onRequestDelete,
  deletePending,
}: UrlRowProps) {
  let hostname = url.url;
  try {
    hostname = new URL(url.url).hostname.replace(/^www\./, "");
  } catch {
    // Keep the stored value visible if it is not parseable.
  }

  const freshness = price ? getPriceFreshness(price.scrapedAt) : "never";
  const scrapedAt = price?.scrapedAt;
  const dateTime =
    scrapedAt == null ? undefined : scrapedAt instanceof Date ? scrapedAt.toISOString() : scrapedAt;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2 text-sm">
      <Button
        size="sm"
        variant="outline"
        aria-label={`Delete URL for ${hostname}`}
        disabled={deletePending}
        onClick={() => onRequestDelete(url.id, hostname)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <span className="min-w-0 flex-1">
        <a
          href={url.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all font-medium hover:underline"
        >
          {hostname}
        </a>
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {price ? (
          <>
            <Badge
              variant={freshness === "stale" ? "outline" : "secondary"}
              className="whitespace-nowrap"
            >
              {formatPrice(price.amountMinor, price.currency)}
            </Badge>
            {dateTime ? (
              <span className="text-xs text-muted-foreground">
                <time dateTime={dateTime}>{formatObservationTime(scrapedAt!)}</time>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Observation time unknown</span>
            )}
            {freshness === "stale" && (
              <Badge variant="destructive" className="whitespace-nowrap">
                <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                Stale
              </Badge>
            )}
          </>
        ) : priceStatus === "success" ? (
          <span className="text-xs text-muted-foreground">Never scraped</span>
        ) : priceStatus === "loading" ? (
          <span role="status" className="text-xs text-muted-foreground">
            Checking price&hellip;
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Price unavailable</span>
        )}
      </div>
    </div>
  );
}
