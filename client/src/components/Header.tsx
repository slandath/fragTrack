import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeaderProps } from "./types";

export default function Header({ userName, onSignOut, signOutPending, signOutError }: HeaderProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-xl font-semibold">Frag Tracker</h1>
        <div className="flex items-center gap-3">
          <a href="/settings" className="text-sm text-muted-foreground hover:underline">
            Settings
          </a>
          <span className="max-w-32 truncate text-sm text-muted-foreground" title={userName}>
            {userName || "Account"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSignOut}
            disabled={signOutPending}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
      {signOutError && (
        <p role="alert" className="break-words text-sm text-destructive">
          Sign out failed: {signOutError}
        </p>
      )}
    </div>
  );
}
