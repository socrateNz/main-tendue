"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Impression du rapport (le navigateur propose « Enregistrer en PDF »). */
export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer aria-hidden />
      PDF / Imprimer
    </Button>
  );
}
