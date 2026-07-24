import { trpc } from "@/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function Settings() {
  const { data } = trpc.getUserApiKey.useQuery();

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
          <CardTitle>API Key</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input value={data?.apiKey ?? ""} readOnly />
          <Button onClick={() => navigator.clipboard.writeText(data?.apiKey ?? "")}>Copy</Button>
        </CardContent>
      </Card>
    </div>
  );
}
