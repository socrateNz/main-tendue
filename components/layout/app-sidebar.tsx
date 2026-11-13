"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
import { BrandLogo } from "@/components/layout/brand-logo";

export function AppSidebar({ permissions, footer }: { permissions: readonly Permission[]; footer?: React.ReactNode }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const allowed = new Set(permissions);
  // Affichage uniquement : chaque page et chaque action revérifient la permission côté serveur.
  const groups = NAVIGATION.map((group) => ({ ...group, items: group.items.filter((item) => allowed.has(item.permission) && !(item.hiddenWith && allowed.has(item.hiddenWith))) })).filter(
    (group) => group.items.length > 0,
  );

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Main Tendue"
              render={<Link href="/tableau-de-bord" />}
              className="hover:bg-transparent active:bg-transparent"
            >
              <BrandLogo size={32} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-semibold text-foreground">Main Tendue</span>
                <span className="truncate text-xs text-muted-foreground">Parrainage scolaire</span>
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
