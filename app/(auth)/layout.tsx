import { GraduationCap } from "lucide-react";

/** Pages hors espace de gestion (connexion, changement de mot de passe obligatoire). */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Fond discret : grille et halo bleu, purement décoratifs. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] mask-[radial-gradient(ellipse_60%_50%_at_50%_40%,#000_40%,transparent_100%)] bg-size-[32px_32px] opacity-60"
      />
      <div aria-hidden className="pointer-events-none absolute top-[-10%] left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight">Parrainage scolaire</p>
            <p className="text-sm text-muted-foreground">Espace de gestion de l&apos;organisation</p>
          </div>
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Accès réservé aux membres autorisés. Toute connexion est journalisée.
        </p>
      </div>
    </div>
  );
}
