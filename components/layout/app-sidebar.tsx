"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Permission } from "@/lib/auth/permissions";
import { NAVIGATION } from "@/lib/navigation";

export function AppSidebar({ permissions, footer }: { permissions: readonly Permission[]; footer?: React.ReactNode }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const allowed = new Set(permissions);
  // Affichage uniquement : chaque page et chaque action revérifient la permission côté serveur.
  const groups = NAVIGATION.map((group) => ({ ...group, items: group.items.filter((item) => allowed.has(item.permission)) })).filter(
    (group) => group.items.length > 0,
  );

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Parrainage scolaire"
              render={<Link href="/tableau-de-bord" />}
              className="hover:bg-transparent active:bg-transparent"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <GraduationCap className="size-4" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-semibold text-foreground">Parrainage scolaire</span>
                <span className="truncate text-xs text-muted-foreground">Espace de gestion</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

                if (!item.available) {
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        disabled
                        aria-disabled
                        tooltip={`${item.title} — bientôt disponible`}
                        className="cursor-not-allowed opacity-50"
                      >
                        <Icon aria-hidden />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                      <SidebarMenuBadge className="text-[10px] font-normal text-muted-foreground">Bientôt</SidebarMenuBadge>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      render={
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          onClick={() => isMobile && setOpenMobile(false)}
                        />
                      }
                    >
                      <Icon aria-hidden />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
      <SidebarRail />
    </Sidebar>
  );
}
