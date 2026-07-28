import { authClient } from "../auth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function Login() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  if (isPending) return null;
  if (session) {
    navigate("/", { replace: true });
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Frag Tracker</CardTitle>
          <CardDescription>Sign in to track your fragrances</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => authClient.signIn.social({ provider: "github" })}
          >
            Sign in with GitHub
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
