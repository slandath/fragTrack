import type { HeaderProps } from "./types";

export default function Header({ userName }: HeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="font-heading text-xl font-semibold">Frag Tracker</h1>
      <div className="flex items-center gap-4">
        <a href="/settings" className="text-sm text-muted-foreground hover:underline">
          Settings
        </a>
        <span className="text-sm text-muted-foreground">{userName}</span>
      </div>
    </div>
  );
}
