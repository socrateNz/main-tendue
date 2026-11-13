"use client";

import { Laptop, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/layout/theme-provider";
import { THEMES, THEME_LABELS, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS: Record<Theme, typeof Sun> = { system: Laptop, light: Sun, dark: Moon };

/** Sélecteur de thème segmenté (Système / Clair / Sombre), accessible au clavier. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Thème de l'interface" className={cn("inline-flex w-full items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}>
      {THEMES.map((value) => {
        const Icon = ICONS[value];
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {THEME_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
