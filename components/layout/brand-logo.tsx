import Image from "next/image";

import { cn } from "@/lib/utils";

/** Logo « Main Tendue » (fichier public/main-tendue-logo.png). */
export function BrandLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/main-tendue-logo.png"
      alt="Main Tendue"
      width={size}
      height={size}
      priority
      className={cn("shrink-0 rounded-lg bg-white object-contain ring-1 ring-border", className)}
    />
  );
}
