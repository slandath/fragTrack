import { useEffect, useState } from "react";
import { trpc } from "@/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatObservationTime } from "@/lib/price";

type KeyAction = { kind: "rotate" | "revoke"; id: string; label: string };

export default function Settings() {
  const utils = trpc.useUtils();
  const keysQuery = trpc.listApiKeys.useQuery();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealVersion, setRevealVersion] = useState(0);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [keyAction, setKeyAction] = useState<KeyAction | null>(null);

  // Never leave a one-time key available after leaving this page.
  useEffect(() => () => setRevealedKey(null), []);

  // Drop the plaintext key from the mutation cache when this page unmounts.
  const createKey = trpc.createApiKey.useMutation({
    gcTime: 0,
    onSuccess: (result) => {
      setRevealedKey(result.apiKey);
      setRevealVersion((version) => version + 1);
      setCopyStatus(null);
      void utils.listApiKeys.invalidate();
    },
  });
  const rotateKey = trpc.rotateApiKey.useMutation({
    gcTime: 0,
    onSuccess: (result) => {
      setRevealedKey(result.apiKey);
      setRevealVersion((version) => version + 1);
      setCopyStatus(null);
      setKeyAction(null);
      void utils.listApiKeys.invalidate();
    },
  });
  const revokeKey = trpc.revokeApiKey.useMutation({
    onSuccess: () => {
      setKeyAction(null);
      void utils.listApiKeys.invalidate();
    },
  });

  const keyGenerationPending = createKey.isPending || rotateKey.isPending;
  const actionPending = rotateKey.isPending || revokeKey.isPending;
  const actionError = rotateKey.error?.message ?? revokeKey.error?.message ?? null;

  async function handleCopy() {
    if (!revealedKey) return;
    const version = revealVersion;
    try {
      await navigator.clipboard.writeText(revealedKey);
      if (version === revealVersion) setCopyStatus("Copied to clipboard.");
    } catch {
      if (version === revealVersion) {
        setCopyStatus("Copy failed. Select the key and copy it manually.");
      }
    }
  }

  async function handleConfirmAction() {
    if (!keyAction) return;
    try {
      if (keyAction.kind === "rotate") {
        await rotateKey.mutateAsync({ id: keyAction.id });
      } else {
        await revokeKey.mutateAsync({ id: keyAction.id });
      }
    } catch {
      // The dialog shows the mutation error and stays open.
    }
  }

  function requestAction(action: KeyAction) {
    rotateKey.reset();
    revokeKey.reset();
    setKeyAction(action);
  }

  const actionDescription =
    keyAction?.kind === "rotate"
      ? "Rotate this key? The current key stops working immediately and a new one is shown only once. Update any scrape jobs using the old key."
      : `Revoke ${keyAction?.label ?? "this key"}? It stops working immediately and cannot be restored. Update any scrape jobs using it.`;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-xl font-semibold">Settings</h1>
        <a href="/" className="text-sm text-muted-foreground hover:underline">
          Back to fragrances
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Keys expire after 90 days. New keys are displayed only once.
            </p>
            <Button
              onClick={() => createKey.mutate({})}
              disabled={Boolean(revealedKey) || keyGenerationPending}
            >
              {createKey.isPending ? "Creating…" : "Create key"}
            </Button>
          </div>

          {revealedKey && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Store this key now. It cannot be shown again.</p>
              <div className="flex flex-wrap gap-2">
                <Input value={revealedKey} readOnly aria-label="New API key" />
                <Button type="button" onClick={handleCopy}>
                  Copy
                </Button>
              </div>
              {copyStatus && (
                <p role="status" className="text-sm text-muted-foreground">
                  {copyStatus}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRevealVersion((version) => version + 1);
                  setRevealedKey(null);
                  setCopyStatus(null);
                }}
              >
                Dismiss
              </Button>
            </div>
          )}

          {keysQuery.isPending && (
            <div className="space-y-2" role="status" aria-label="Loading API keys">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {keysQuery.isError && (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-destructive/30 p-3 text-sm"
            >
              <p className="break-words">
                Could not load API keys:{" "}
                {keysQuery.error instanceof Error ? keysQuery.error.message : "Unknown error"}
              </p>
              <Button variant="outline" size="sm" onClick={() => void keysQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}

          {keysQuery.isSuccess && (
            <div className="space-y-2">
              {keysQuery.data.map((key) => {
                const expiresAt = new Date(String(key.expiresAt));
                const expired = expiresAt.getTime() <= Date.now();
                const active = !key.revokedAt && !expired;
                return (
                  <div
                    key={key.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 text-sm">
                      <p className="break-all font-mono">ft_{key.id}_...</p>
                      <p className="text-muted-foreground">
                        {key.revokedAt
                          ? `Revoked ${formatObservationTime(key.revokedAt, "unknown")}`
                          : expired
                            ? `Expired ${formatObservationTime(expiresAt, "unknown")}`
                            : `Expires ${formatObservationTime(expiresAt, "unknown")}`}
                      </p>
                      {key.lastUsedAt && (
                        <p className="text-muted-foreground">
                          Last used {formatObservationTime(key.lastUsedAt, "unknown")}
                        </p>
                      )}
                    </div>
                    {active && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            requestAction({ kind: "rotate", id: key.id, label: key.id })
                          }
                          disabled={
                            Boolean(revealedKey) || keyGenerationPending || revokeKey.isPending
                          }
                        >
                          Rotate
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            requestAction({ kind: "revoke", id: key.id, label: key.id })
                          }
                          disabled={actionPending}
                        >
                          Revoke
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              {keysQuery.data.length === 0 && (
                <p className="text-sm text-muted-foreground">No API keys have been created.</p>
              )}
            </div>
          )}

          {createKey.error && (
            <p role="alert" className="break-words text-sm text-destructive">
              Could not create key: {createKey.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(keyAction)}
        title={keyAction?.kind === "rotate" ? "Rotate API key" : "Revoke API key"}
        description={actionDescription}
        confirmLabel={keyAction?.kind === "rotate" ? "Rotate" : "Revoke"}
        destructive={keyAction?.kind === "revoke"}
        pending={actionPending}
        error={actionError}
        onConfirm={handleConfirmAction}
        onCancel={() => setKeyAction(null)}
      />
    </div>
  );
}
