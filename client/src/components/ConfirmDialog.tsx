import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible in-app confirmation built on the native <dialog> element. Using
 * showModal gives us focus containment, Escape handling, and focus restoration
 * to the trigger without adding a component library.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  destructive = true,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      className="w-full max-w-sm rounded-xl bg-card p-5 text-sm text-card-foreground shadow-xl ring-1 ring-foreground/10 backdrop:bg-black/50"
    >
      <h2 id={titleId} className="font-heading text-base font-semibold">
        {title}
      </h2>
      <p id={descriptionId} className="mt-2 break-words text-muted-foreground">
        {description}
      </p>
      {error && (
        <p role="alert" className="mt-3 break-words text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
          disabled={pending}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
