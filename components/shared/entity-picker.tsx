"use client";

import { Check, Loader2, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type PickerValue = { id: string; label: string; description?: string };

/**
 * Sélecteur avec recherche serveur (combobox ARIA) : flèches haut/bas, Entrée, Échap.
 * `search` est une Server Action qui vérifie elle-même les permissions.
 */
export function EntityPicker({
  id,
  value,
  onChange,
  search,
  placeholder = "Rechercher…",
  emptyLabel = "Aucun résultat.",
  disabled,
  invalid,
}: {
  id: string;
  value: PickerValue | null;
  onChange: (value: PickerValue | null) => void;
  search: (q: string) => Promise<ActionResult<Array<{ id: string; label: string; description: string }>>>;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PickerValue[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function run(q: string) {
    startTransition(async () => {
      const result = await search(q);
      if (result.ok) {
        setOptions(result.data);
        setError(null);
      } else {
        setOptions([]);
        setError(result.message);
      }
      setActive(0);
    });
  }

  function onQueryChange(next: string) {
    setQuery(next);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(next), 250);
  }

  function choose(option: PickerValue) {
    onChange(option);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        run(query);
      } else setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && options[active]) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  if (value) {
    return (
      <div className={cn("flex min-h-8 items-center justify-between gap-2 rounded-lg border border-input bg-muted/30 px-2.5 py-1.5", invalid && "border-destructive")}>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.label}</p>
          {value.description ? <p className="truncate text-xs text-muted-foreground">{value.description}</p> : null}
        </div>
        {!disabled ? (
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange(null)} aria-label={`Changer (${value.label})`}>
            <X />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={container} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onQueryChange(event.target.value)}
        onFocus={() => {
          setOpen(true);
          if (options.length === 0) run(query);
        }}
        onKeyDown={onKeyDown}
        className="h-8 w-full rounded-lg border border-input bg-transparent pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
      />
      {pending ? <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden /> : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-panel"
        >
          {error ? <li className="px-2.5 py-2 text-sm text-destructive">{error}</li> : null}
          {!error && !pending && options.length === 0 ? <li className="px-2.5 py-2 text-sm text-muted-foreground">{emptyLabel}</li> : null}
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              onMouseEnter={() => setActive(index)}
              className={cn("flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5", index === active && "bg-accent")}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{option.label}</span>
                {option.description ? <span className="block truncate text-xs text-muted-foreground">{option.description}</span> : null}
              </span>
              {index === active ? <Check className="size-3.5 shrink-0 text-primary" aria-hidden /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
