import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardAction } from "@/components/ui/card";
import { Plus, Globe, Trash2 } from "lucide-react";
import UrlRow from "./UrlRow";
import type { FragranceCardProps } from "./types";

export default function FragranceCard({
  fragrance,
  urls,
  latestPrices,
  expandedFragranceId,
  onExpand,
  onDeleteFragrance,
  onDeleteUrl,
  onAddUrl,
  addUrlPending,
  deleteFragrancePending,
  deleteUrlPending,
}: FragranceCardProps) {
  const [newUrl, setNewUrl] = useState("");

  const isExpanded = expandedFragranceId === fragrance.id;

  async function handleAddUrl() {
    try {
      await onAddUrl(fragrance.id, newUrl);
      setNewUrl("");
    } catch {
      // Error is already logged by the onError callback on the mutation
    }
  }

  const sortedUrls = [...urls].sort((a, b) => {
    const pa = latestPrices[a.id];
    const pb = latestPrices[b.id];
    const aPrice = pa ? parseFloat(pa.amount) : Infinity;
    const bPrice = pb ? parseFloat(pb.amount) : Infinity;
    return aPrice - bPrice;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {fragrance.brand} &mdash; {fragrance.name}
        </CardTitle>
        <CardAction>
          <Button size="sm" aria-label="Add retailer URL" onClick={() => onExpand(fragrance.id)}>
            <Plus className="h-4 w-4" />
            <Globe className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            className="ml-2"
            aria-label="Delete fragrance"
            disabled={deleteFragrancePending}
            onClick={() => {
              if (window.confirm("Delete this fragrance and all its URLs?"))
                onDeleteFragrance(fragrance.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        {urls.length === 0 && (
          <p className="text-sm text-muted-foreground">No URLs tracked yet.</p>
        )}
        {sortedUrls.map((url) => (
          <UrlRow
            key={url.id}
            url={url}
            price={latestPrices[url.id]}
            onDelete={onDeleteUrl}
            deletePending={deleteUrlPending}
          />
        ))}
        {isExpanded && (
          <div className="flex gap-2 pt-1">
            <Input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="Product URL"
            />
            <Button size="sm" onClick={handleAddUrl} disabled={addUrlPending}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onExpand(null)}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
