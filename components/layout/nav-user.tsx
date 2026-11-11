"use client";

import { ChevronsUpDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { logoutAction } from "@/features/auth/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { initials } from "@/lib/text";

export type NavUserInfo = { name: string; email: string; roleLabel: string };

export function NavUser({ user }: { user: NavUserInfo }) {
  const { isMobile } = useSidebar();
  const [pending, startTransition] = useTransition();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" aria-label="Menu du compte" />
            }
          >
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">{user.roleLabel}</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" sideOffset={8} className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/mon-compte" />}>
              <UserRound aria-hidden />
              Mon compte
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={pending}
              onClick={() => startTransition(() => logoutAction())}
              className="text-destructive focus:text-destructive"
            >
              <LogOut aria-hidden />
              {pending ? "Déconnexion…" : "Se déconnecter"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
