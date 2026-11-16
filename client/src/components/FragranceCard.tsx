import { useEffect, useId, useRef, useState, type FormEvent } from "react";
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
  onRequestDeleteFragrance,
  onRequestDeleteUrl,
  onAddUrl,
  addUrlPending,
  addUrlError,
  priceStatus,
  deleteFragrancePending,
  deleteUrlPending,
}: FragranceCardProps) {
  const [newUrl, setNewUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  // Identifies the current editor session so a superseded request cannot
  // close the editor the user is now using.
  const editorGeneration = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const errorId = useId();

  const isExpanded = expandedFragranceId === fragrance.id;

  useEffect(() => {
    if (isExpanded) inputRef.current?.focus();
  }, [isExpanded]);

  function closeForm() {
    editorGeneration.current++;
    setNewUrl("");
    setUrlError(null);
    setErrorDismissed(false);
    onExpand(null);
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  async function handleAddUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newUrl.trim();
    if (!trimmed) {
      setUrlError("Enter a product URL.");
      return;
    }
    const generation = editorGeneration.current;
    setUrlError(null);
    setErrorDismissed(false);
    try {
      await onAddUrl(fragrance.id, trimmed);
      if (generation === editorGeneration.current) closeForm();
    } catch {
      // The mutation error is displayed below; keep the input for correction.
    }
  }

  const sortedUrls = [...urls].sort((a, b) => {
    const pa = latestPrices[a.id];
    const pb = latestPrices[b.id];
    const aPrice = pa ? pa.amountMinor : Infinity;
    const bPrice = pb ? pb.amountMinor : Infinity;
    return aPrice - bPrice;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="break-words">
          {fragrance.brand} &mdash; {fragrance.name}
        </CardTitle>
        <CardAction>
          <Button
            ref={addButtonRef}
            size="sm"
            aria-label={`Add retailer URL for ${fragrance.name}`}
            aria-expanded={isExpanded}
            onClick={() => {
              if (isExpanded) closeForm();
              else onExpand(fragrance.id);
            }}
          >
            <Plus className="h-4 w-4" />
            <Globe className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            className="ml-2"
            aria-label={`Delete ${fragrance.name}`}
            disabled={deleteFragrancePending}
            onClick={() =>
              onRequestDeleteFragrance(fragrance.id, `${fragrance.brand} — ${fragrance.name}`)
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        {urls.length === 0 && <p className="text-sm text-muted-foreground">No URLs tracked yet.</p>}
        {sortedUrls.map((url) => (
          <UrlRow
            key={url.id}
            url={url}
            price={latestPrices[url.id]}
            priceStatus={priceStatus}
            onRequestDelete={onRequestDeleteUrl}
            deletePending={deleteUrlPending}
          />
        ))}
        {isExpanded && (
          <form onSubmit={handleAddUrl} noValidate className="space-y-1 pt-1">
            <label htmlFor={inputId} className="text-xs font-medium">
              Product URL
            </label>
            <div className="flex gap-2">
              <Input
                id={inputId}
                ref={inputRef}
                type="url"
                value={newUrl}
                onChange={(event) => {
                  setNewUrl(event.target.value);
                  setErrorDismissed(true);
                }}
                placeholder="https://retailer.example/product"
                required
                maxLength={2048}
                inputMode="url"
                autoComplete="url"
                aria-invalid={Boolean(urlError)}
                aria-describedby={urlError ? errorId : undefined}
              />
              <Button type="submit" size="sm" disabled={addUrlPending}>
                {addUrlPending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={closeForm}>
                Cancel
              </Button>
            </div>
            {urlError && (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {urlError}
              </p>
            )}
            {addUrlError?.fragranceId === fragrance.id && !errorDismissed && (
              <p role="alert" className="break-words text-xs text-destructive">
                Could not add URL: {addUrlError.message}
              </p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
