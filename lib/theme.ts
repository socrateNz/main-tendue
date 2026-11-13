/**
 * Thème clair / sombre — par défaut celui du système.
 *
 * Le choix est stocké dans le navigateur (localStorage, valeur non sensible). Un script exécuté
 * avant l'affichage (THEME_INIT_SCRIPT) applique la classe `dark` sur <html> pour éviter tout
 * flash de thème au chargement.
 */

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_STORAGE_KEY = "theme";

export const THEME_LABELS: Record<Theme, string> = { system: "Système", light: "Clair", dark: "Sombre" };

/** Script autonome (aucune dépendance), injecté dans <head> : doit rester minimal et sans erreur. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||((t!=="light")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

export function readStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}
