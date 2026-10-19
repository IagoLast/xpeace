"use client";

import Link from "next/link";
import { Leaf, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "./ui/button";

export function AppHeader({
  showAboutLink = true,
}: {
  showAboutLink?: boolean;
}) {
  const { setTheme } = useTheme();
  return (
    <header className="app-header">
      <Link href="/" className="brand" aria-label="xpeace, inicio">
        <Leaf className="size-5 text-primary" strokeWidth={1.8} />
        <span>
          xpeace<span className="text-primary">.</span>
        </span>
      </Link>
      <div className="flex items-center gap-3">
        {showAboutLink && (
          <Link
            href="/bpn"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Qué es BPN
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="dark:hidden"
          onClick={() => setTheme("dark")}
          aria-label="Activar modo oscuro"
        >
          <Moon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden dark:inline-flex"
          onClick={() => setTheme("light")}
          aria-label="Activar modo claro"
        >
          <Sun className="size-4" />
        </Button>
      </div>
    </header>
  );
}
