import { trpc } from "@/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useState } from "react";

export default function Settings() {
  const utils = trpc.useUtils();
  const { data: keys } = trpc.listApiKeys.useQuery();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const createKey = trpc.createApiKey.useMutation({
    onSuccess: (result) => {
      setRevealedKey(result.apiKey);
      void utils.listApiKeys.invalidate();
    },
  });
  const rotateKey = trpc.rotateApiKey.useMutation({
    onSuccess: (result) => {
      setRevealedKey(result.apiKey);
      void utils.listApiKeys.invalidate();
    },
  });
  const revokeKey = trpc.revokeApiKey.useMutation({
    onSuccess: () => void utils.listApiKeys.invalidate(),
  });

  const mutationError = createKey.error ?? rotateKey.error ?? revokeKey.error;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex items-center justify-between">
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
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Keys expire after 90 days. New keys are displayed only once.
            </p>
            <Button onClick={() => createKey.mutate({})} disabled={createKey.isPending}>
              Create key
            </Button>
          </div>

          {revealedKey && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Store this key now. It cannot be shown again.</p>
              <div className="flex gap-2">
                <Input value={revealedKey} readOnly />
                <Button onClick={() => navigator.clipboard.writeText(revealedKey)}>Copy</Button>
              </div>
              <Button variant="outline" size="sm" onClick={() => setRevealedKey(null)}>
                Dismiss
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {keys?.map((key) => {
              const expired = new Date(String(key.expiresAt)).getTime() <= Date.now();
              const active = !key.revokedAt && !expired;
              return (
                <div key={key.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-mono">ft_{key.id}_...</p>
                    <p className="text-muted-foreground">
                      {key.revokedAt
                        ? "Revoked"
                        : expired
                          ? "Expired"
                          : `Expires ${new Date(String(key.expiresAt)).toLocaleDateString()}`}
                    </p>
                    {key.lastUsedAt && (
                      <p className="text-muted-foreground">
                        Last used {new Date(String(key.lastUsedAt)).toLocaleString()}
                      </p>
                    )}
                  </div>
                  {active && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => rotateKey.mutate({ id: key.id })}
                        disabled={rotateKey.isPending || revokeKey.isPending}
                      >
                        Rotate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => revokeKey.mutate({ id: key.id })}
                        disabled={rotateKey.isPending || revokeKey.isPending}
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {keys?.length === 0 && (
              <p className="text-sm text-muted-foreground">No API keys have been created.</p>
            )}
          </div>

          {mutationError && <p className="text-sm text-destructive">{mutationError.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
