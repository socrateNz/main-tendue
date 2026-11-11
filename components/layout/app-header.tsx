"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { segmentLabel } from "@/lib/navigation";

/**
 * En-tête collant : bouton de repli de la sidebar et fil d'Ariane déduit de l'URL.
 * Les identifiants techniques (ObjectId) ne sont pas affichés : la page de détail affiche le nom.
 */
export function AppHeader({ actions }: { actions?: React.ReactNode }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments
    .map((segment, index) => ({
      href: `/${segments.slice(0, index + 1).join("/")}`,
      label: segmentLabel(segment) ?? (/^[a-f0-9]{24}$/i.test(segment) ? "Détail" : decodeURIComponent(segment)),
    }));

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 rounded-t-xl border-b bg-card/85 px-4 backdrop-blur supports-backdrop-filter:bg-card/70 md:px-6">
      <SidebarTrigger className="-ml-1.5 text-muted-foreground" aria-label="Afficher ou masquer la navigation" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <Fragment key={crumb.href}>
                {index > 0 ? <BreadcrumbSeparator className="hidden sm:block" /> : null}
                <BreadcrumbItem className={last ? "min-w-0" : "hidden sm:inline-flex"}>
                  {last ? (
                    <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link href={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
