import { useEffect, useState } from "react";
import { authClient } from "../auth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardDescription, CardContent } from "@/components/ui/card";

export default function Login() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) navigate("/", { replace: true });
  }, [session, navigate]);

  async function handleSignIn() {
    setError(null);
    const result = await authClient.signIn.social({ provider: "github" });
    if (result.error) setError(result.error.message ?? "Sign in failed");
  }

  if (isPending) {
    return <div role="status">Checking your session&hellip;</div>;
  }
  if (session) return null;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <h1 className="font-heading text-base leading-snug font-medium">Frag Tracker</h1>
          <CardDescription>Sign in to track your fragrances</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button variant="outline" className="w-full" onClick={handleSignIn}>
            Sign in with GitHub
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
