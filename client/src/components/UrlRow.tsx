import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import type { UrlRowProps } from "./types";

export default function UrlRow({ url, price, onDelete, deletePending }: UrlRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 text-sm">
      <Button
        size="sm"
        variant="outline"
        aria-label="Delete URL"
        disabled={deletePending}
        onClick={() => {
          if (window.confirm("Delete this URL?")) {
            onDelete(url.id).catch(() => {
              // Error is already logged by the onError callback on the mutation
            });
          }
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <span className="flex-1 font-medium">
        <a
          href={url.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 font-medium hover:underline"
        >
          {new URL(url.url).hostname.replace(/^www\./, "")}
        </a>
      </span>
      {price ? (
        <Badge variant="secondary">
          {price.currency === "USD" ? "$" : price.currency} {price.amount}
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">&mdash;</span>
      )}
    </div>
  );
}
