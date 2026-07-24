import { authClient } from "../auth";
import { trpc } from "@/trpc";
import { useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardAction } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  const { data: rows, isPending: loadingFrags, refetch } = trpc.getFragrances.useQuery();
  const { data: priceRows } = trpc.getLatestPrices.useQuery();
  const addFragrance = trpc.addFragrance.useMutation({ onSuccess: () => refetch() });
  const addRetailerUrl = trpc.addRetailerUrl.useMutation({ onSuccess: () => refetch() });

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [expandedFragId, setExpandedFragId] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");

  const latestPrices = useMemo(() => {
    const map: Record<string, { amount: string; currency: string }> = {};
    for (const p of priceRows ?? []) {
      if (!map[p.retailerUrlId]) map[p.retailerUrlId] = p;
    }
    return map;
  }, [priceRows]);

  const fragrances = useMemo(() => {
    if (!rows) return {};
    const map: Record<
      string,
      {
        id: string;
        name: string;
        brand: string;
        urls: NonNullable<(typeof rows)[number]["retailer_url"]>[];
      }
    > = {};
    for (const row of rows) {
      const f = row.fragrance;
      if (!map[f.id]) map[f.id] = { id: f.id, name: f.name, brand: f.brand, urls: [] };
      if (row.retailer_url) map[f.id].urls.push(row.retailer_url);
    }
    return map;
  }, [rows]);

  async function handleAddFragrance() {
    await addFragrance.mutateAsync({ name, brand });
    setName("");
    setBrand("");
  }

  async function handleAddUrl(fragranceId: string) {
    await addRetailerUrl.mutateAsync({ fragranceId, url: newUrl });
    setNewUrl("");
    setExpandedFragId(null);
  }

  if (isPending) return <div>Loading...</div>;
  if (!session) {
    navigate("/login");
    return null;
  }

  const fragList = Object.values(fragrances);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-semibold">fragTrack</h1>
        <div className="flex items-center gap-4">
          <a href="/settings" className="text-sm text-muted-foreground hover:underline">
            Settings
          </a>
          <span className="text-sm text-muted-foreground">{session.user?.name}</span>
        </div>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Add Fragrance</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Button onClick={handleAddFragrance}>Add</Button>
        </CardContent>
      </Card>

      <Separator />

      {loadingFrags && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {!loadingFrags && fragList.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          No fragrances yet. Add one above.
        </p>
      )}

      {fragList.map((frag) => (
        <Card key={frag.id}>
          <CardHeader>
            <CardTitle>
              {frag.brand} — {frag.name}
            </CardTitle>
            <CardAction>
              <Button size="sm" variant="outline" onClick={() => setExpandedFragId(frag.id)}>
                + Add URL
              </Button>
            </CardAction>
          </CardHeader>

          <CardContent className="space-y-2">
            {frag.urls.length === 0 && (
              <p className="text-sm text-muted-foreground">No URLs tracked yet.</p>
            )}

            {frag.urls.map((url) => (
              <div
                key={url.id}
                className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 text-sm"
              >
                <span className="flex-1 font-medium">
                  {new URL(url.url).hostname.replace(/^www\./, "")}
                </span>

                {latestPrices[url.id] ? (
                  <Badge variant="secondary">
                    {latestPrices[url.id].currency === "USD" ? "$" : latestPrices[url.id].currency}{" "}
                    {latestPrices[url.id].amount}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            ))}

            {expandedFragId === frag.id && (
              <div className="flex gap-2 pt-1">
                <Input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="Product URL"
                />
                <Button size="sm" onClick={() => handleAddUrl(frag.id)}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setExpandedFragId(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
