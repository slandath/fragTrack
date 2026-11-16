import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "../auth";
import { trpc } from "@/trpc";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import Header from "@/components/Header";
import AddFragranceForm from "@/components/AddFragranceForm";
import FragranceCard from "@/components/FragranceCard";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { RetailerUrl, PriceInfo } from "@/components/types";

type DeleteTarget = { kind: "fragrance" | "url"; id: string; label: string };

function QueryError({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: unknown;
  onRetry: () => void;
}) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <div role="alert" className="space-y-2 rounded-md border border-destructive/30 p-3 text-sm">
      <p className="break-words">
        Could not load {label}: {message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();

  const fragrancesQuery = trpc.getFragrances.useQuery();
  const domainsQuery = trpc.getSupportedDomains.useQuery();
  const pricesQuery = trpc.getLatestPrices.useQuery();

  const addFragrance = trpc.addFragrance.useMutation({
    onSuccess: () => fragrancesQuery.refetch(),
    onError: (error) => console.error("addFragrance failed:", error),
  });
  const addRetailerUrl = trpc.addRetailerUrl.useMutation({
    onSuccess: () => fragrancesQuery.refetch(),
    onError: (error) => console.error("addRetailerUrl failed:", error),
  });
  const deleteUrl = trpc.deleteRetailerUrl.useMutation({
    onSuccess: () => fragrancesQuery.refetch(),
    onError: (error) => console.error("deleteRetailerUrl failed:", error),
  });
  const deleteFrag = trpc.deleteFragrance.useMutation({
    onSuccess: () => fragrancesQuery.refetch(),
    onError: (error) => console.error("deleteFragrance failed:", error),
  });

  const [expandedFragId, setExpandedFragId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const latestPrices = useMemo(() => {
    const map: Record<string, PriceInfo> = {};
    for (const price of pricesQuery.data ?? []) {
      if (!map[price.retailerUrlId]) map[price.retailerUrlId] = price;
    }
    return map;
  }, [pricesQuery.data]);

  const fragrances = useMemo(() => {
    const map: Record<string, { id: string; name: string; brand: string; urls: RetailerUrl[] }> =
      {};
    for (const row of fragrancesQuery.data ?? []) {
      const fragrance = row.fragrance;
      if (!map[fragrance.id]) {
        map[fragrance.id] = {
          id: fragrance.id,
          name: fragrance.name,
          brand: fragrance.brand,
          urls: [],
        };
      }
      if (row.retailer_url) map[fragrance.id].urls.push(row.retailer_url);
    }
    return map;
  }, [fragrancesQuery.data]);

  const fragList = Object.values(fragrances);
  const deletePending = deleteFrag.isPending || deleteUrl.isPending;
  const deleteError = deleteFrag.error?.message ?? deleteUrl.error?.message ?? null;
  const priceStatus = pricesQuery.isPending ? "loading" : pricesQuery.isError ? "error" : "success";
  const addUrlError =
    addRetailerUrl.error && addRetailerUrl.variables
      ? {
          fragranceId: addRetailerUrl.variables.fragranceId,
          message: addRetailerUrl.error.message,
        }
      : null;

  async function handleAddFragrance(brand: string, name: string) {
    await addFragrance.mutateAsync({ name, brand });
  }

  async function handleAddUrl(fragranceId: string, url: string) {
    await addRetailerUrl.mutateAsync({ fragranceId, url });
  }

  function requestDelete(target: DeleteTarget) {
    deleteFrag.reset();
    deleteUrl.reset();
    setDeleteTarget(target);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "fragrance") {
        await deleteFrag.mutateAsync({ id: deleteTarget.id });
      } else {
        await deleteUrl.mutateAsync({ id: deleteTarget.id });
      }
      setDeleteTarget(null);
    } catch {
      // Mutation error is shown in the dialog; keep it open for the operator.
    }
  }

  async function handleSignOut() {
    setSignOutPending(true);
    setSignOutError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? "Sign out failed");
      navigate("/login", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign out failed";
      setSignOutError(message);
      console.error("signOut failed:", error);
    } finally {
      setSignOutPending(false);
    }
  }

  const confirmationDescription =
    deleteTarget?.kind === "fragrance"
      ? `Delete "${deleteTarget.label}"? Its retailer URLs and all recorded price history will also be removed. This cannot be undone.`
      : `Delete the retailer URL for ${deleteTarget?.label ?? ""}? Its recorded price history will also be removed. This cannot be undone.`;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <Header
        userName={session?.user?.name ?? ""}
        onSignOut={handleSignOut}
        signOutPending={signOutPending}
        signOutError={signOutError}
      />

      <AddFragranceForm
        supportedDomains={domainsQuery.data ?? []}
        onAdd={handleAddFragrance}
        isPending={addFragrance.isPending}
        error={addFragrance.error?.message ?? null}
      />
      {domainsQuery.isError && (
        <QueryError
          label="supported domains"
          error={domainsQuery.error}
          onRetry={() => void domainsQuery.refetch()}
        />
      )}

      <Separator />

      {pricesQuery.isError && (
        <QueryError
          label="latest prices"
          error={pricesQuery.error}
          onRetry={() => void pricesQuery.refetch()}
        />
      )}
      {fragrancesQuery.isError && (
        <QueryError
          label="fragrances"
          error={fragrancesQuery.error}
          onRetry={() => void fragrancesQuery.refetch()}
        />
      )}

      {fragrancesQuery.isPending && (
        <div className="space-y-3" role="status" aria-label="Loading fragrances">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {fragrancesQuery.isSuccess && fragList.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          No fragrances yet. Add one above.
        </p>
      )}

      {fragList.map((fragrance) => (
        <FragranceCard
          key={fragrance.id}
          fragrance={fragrance}
          urls={fragrance.urls}
          latestPrices={latestPrices}
          expandedFragranceId={expandedFragId}
          onExpand={setExpandedFragId}
          onRequestDeleteFragrance={(id, label) => requestDelete({ kind: "fragrance", id, label })}
          onRequestDeleteUrl={(id, label) => requestDelete({ kind: "url", id, label })}
          onAddUrl={handleAddUrl}
          addUrlPending={addRetailerUrl.isPending}
          addUrlError={addUrlError}
          priceStatus={priceStatus}
          deleteFragrancePending={deleteFrag.isPending}
          deleteUrlPending={deleteUrl.isPending}
        />
      ))}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === "fragrance" ? "Delete fragrance" : "Delete retailer URL"}
        description={confirmationDescription}
        pending={deletePending}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
