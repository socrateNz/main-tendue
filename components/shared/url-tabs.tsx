"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Onglets dont l'onglet actif est reflété dans l'URL (`?onglet=`) : lien partageable, retour arrière
 * fonctionnel. Le contenu de chaque onglet est rendu côté serveur et transmis en props.
 */
export function UrlTabs({
  tabs,
  defaultTab,
}: {
  tabs: Array<{ value: string; label: string; count?: number; content: React.ReactNode }>;
  defaultTab: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initial = searchParams.get("onglet");
  const [value, setValue] = useState(tabs.some((tab) => tab.value === initial) ? (initial as string) : defaultTab);

  function onValueChange(next: unknown) {
    if (typeof next !== "string") return;
    setValue(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === defaultTab) params.delete("onglet");
    else params.set("onglet", next);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }

  return (
    <Tabs value={value} onValueChange={onValueChange} className="gap-4">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <TabsList variant="line" className="w-max min-w-full justify-start border-b">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-none px-3">
              {tab.label}
              {tab.count !== undefined ? (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">{tab.count}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
