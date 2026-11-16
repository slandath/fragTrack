import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { authClient } from "../auth";
import { Button } from "@/components/ui/button";

/**
 * Shared guard for authenticated pages. While the session is pending, only an
 * accessible loading state is rendered; protected children (and their queries)
 * are never mounted without a resolved session.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending, error } = authClient.useSession();

  if (isPending) {
    return (
      <div role="status" className="p-4 text-center text-sm text-muted-foreground">
        Checking your session&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="mx-auto max-w-md space-y-3 p-6 text-sm">
        <p>We could not verify your session. Please try again.</p>
        <p className="text-muted-foreground">{error.message ?? "Unknown session error"}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
