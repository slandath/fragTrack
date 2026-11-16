import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AddFragranceFormProps } from "./types";

export default function AddFragranceForm({
  supportedDomains,
  onAdd,
  isPending,
  error,
}: AddFragranceFormProps) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ brand?: string; name?: string }>({});
  const brandId = useId();
  const nameId = useId();
  const brandErrorId = useId();
  const nameErrorId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedBrand = brand.trim();
    const trimmedName = name.trim();
    const errors: { brand?: string; name?: string } = {};
    if (!trimmedBrand) errors.brand = "Enter a brand.";
    if (!trimmedName) errors.name = "Enter a name.";
    setFieldErrors(errors);
    if (errors.brand || errors.name) return;

    try {
      await onAdd(trimmedBrand, trimmedName);
      setName("");
      setBrand("");
    } catch {
      // The mutation error is shown in the alert below; keep the input so the
      // user can correct it and retry.
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Track Fragrance</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
        >
          <div className="flex-1 space-y-1">
            <label htmlFor={brandId} className="text-xs font-medium">
              Brand
            </label>
            <Input
              id={brandId}
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              required
              maxLength={100}
              autoComplete="organization"
              placeholder="Brand"
              aria-invalid={Boolean(fieldErrors.brand)}
              aria-describedby={fieldErrors.brand ? brandErrorId : undefined}
            />
            {fieldErrors.brand && (
              <p id={brandErrorId} role="alert" className="text-xs text-destructive">
                {fieldErrors.brand}
              </p>
            )}
          </div>
          <div className="flex-1 space-y-1">
            <label htmlFor={nameId} className="text-xs font-medium">
              Name
            </label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
              autoComplete="off"
              placeholder="Name"
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? nameErrorId : undefined}
            />
            {fieldErrors.name && (
              <p id={nameErrorId} role="alert" className="text-xs text-destructive">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Adding…" : "Track"}
          </Button>
        </form>

        {error && (
          <p role="alert" className="mt-2 break-words text-sm text-destructive">
            Could not add fragrance: {error}
          </p>
        )}

        {supportedDomains.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-6">
            <span className="text-xs text-muted-foreground">Retailers:</span>
            {[...supportedDomains].sort().map((domain) => (
              <Badge key={domain} variant="outline" className="text-xs">
                {domain.replace(/^www\./, "")}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
