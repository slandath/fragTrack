import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AddFragranceFormProps } from "./types";

export default function AddFragranceForm({ supportedDomains, onAdd }: AddFragranceFormProps) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");

  async function handleSubmit() {
    await onAdd(brand, name);
    setName("");
    setBrand("");
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Track Fragrance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Button onClick={handleSubmit}>Track</Button>
        </div>
        {supportedDomains.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-6">
            <span className="text-xs text-muted-foreground">Retailers:</span>
            {[...supportedDomains].sort().map((d) => (
              <Badge key={d} variant="outline" className="text-xs">
                {d.replace(/^www\./, "")}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
