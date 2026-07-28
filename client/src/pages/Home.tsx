import { authClient } from "../auth";
import { trpc } from "@/trpc";
import { useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import Header from "@/components/Header";
import AddFragranceForm from "@/components/AddFragranceForm";
import FragranceCard from "@/components/FragranceCard";
import type { RetailerUrl, PriceInfo } from "@/components/types";

export default function Home() {
  // Session check — redirects to /login if not authenticated
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  // Fetch all fragrance rows, supported retailer domains, and latest prices
  const { data: rows, isPending: loadingFrags, refetch } = trpc.getFragrances.useQuery();
  const { data: supportedDomains } = trpc.getSupportedDomains.useQuery();
  const { data: priceRows } = trpc.getLatestPrices.useQuery();

  // Mutations that refetch fragrance data on success to keep UI in sync
  const addFragrance = trpc.addFragrance.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => console.error("addFragrance failed:", err),
  });
  const addRetailerUrl = trpc.addRetailerUrl.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => console.error("addRetailerUrl failed:", err),
  });
  const deleteUrl = trpc.deleteRetailerUrl.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => console.error("deleteRetailerUrl failed:", err),
  });
  const deleteFrag = trpc.deleteFragrance.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => console.error("deleteFragrance failed:", err),
  });

  // Tracks which fragrance card's add-URL form is open (null = none)
  const [expandedFragId, setExpandedFragId] = useState<string | null>(null);

  // Groups price rows by retailerUrlId, keeping only the first (latest) entry per URL
  const latestPrices = useMemo(() => {
    const map: Record<string, PriceInfo> = {};
    for (const p of priceRows ?? []) {
      if (!map[p.retailerUrlId]) map[p.retailerUrlId] = p;
    }
    return map;
  }, [priceRows]);

  // Groups the raw join rows into fragrance objects with their URL lists
  const fragrances = useMemo(() => {
    if (!rows) return {};
    const map: Record<
      string,
      {
        id: string;
        name: string;
        brand: string;
        urls: RetailerUrl[];
      }
    > = {};
    for (const row of rows) {
      const f = row.fragrance;
      if (!map[f.id]) map[f.id] = { id: f.id, name: f.name, brand: f.brand, urls: [] };
      if (row.retailer_url) map[f.id].urls.push(row.retailer_url);
    }
    return map;
  }, [rows]);

  // Creates a new fragrance entry from the AddFragranceForm
  async function handleAddFragrance(brand: string, name: string) {
    await addFragrance.mutateAsync({ name, brand });
  }

  // Adds a new retailer URL to a fragrance, then closes the add-URL form
  async function handleAddUrl(fragranceId: string, url: string) {
    await addRetailerUrl.mutateAsync({ fragranceId, url });
    setExpandedFragId(null);
  }

  // Deletes a single retailer URL (confirmation handled by UrlRow)
  async function handleDeleteUrl(id: string) {
    await deleteUrl.mutateAsync({ id });
  }

  // Deletes an entire fragrance and its URLs (confirmation handled by FragranceCard)
  async function handleDeleteFragrance(id: string) {
    await deleteFrag.mutateAsync({ id });
  }

  if (isPending) return <div>Loading...</div>;
  if (!session) {
    navigate("/login");
    return null;
  }

  const fragList = Object.values(fragrances);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <Header userName={session.user?.name ?? ""} />

      <AddFragranceForm
        supportedDomains={supportedDomains ?? []}
        onAdd={handleAddFragrance}
        isPending={addFragrance.isPending}
      />

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
        <FragranceCard
          key={frag.id}
          fragrance={frag}
          urls={frag.urls}
          latestPrices={latestPrices}
          expandedFragranceId={expandedFragId}
          onExpand={setExpandedFragId}
          onDeleteFragrance={handleDeleteFragrance}
          onDeleteUrl={handleDeleteUrl}
          onAddUrl={handleAddUrl}
          addUrlPending={addRetailerUrl.isPending}
          deleteFragrancePending={deleteFrag.isPending}
          deleteUrlPending={deleteUrl.isPending}
        />
      ))}
    </div>
  );
}
