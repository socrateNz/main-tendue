"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

import { formatXaf } from "@/lib/money";

/**
 * Graphiques du tableau de bord (méthode dataviz) :
 * - une seule teinte (le bleu principal, validé : contraste ≥ 3:1 sur la surface) — l'identité est
 *   portée par l'axe et les étiquettes, jamais par la couleur seule ;
 * - barres ≤ 24 px, extrémité de données arrondie à 4 px, base carrée ;
 * - grille et axes discrets (trait fin plein) ; infobulle au survol ; valeurs en encre de texte.
 */

const BAR = "var(--color-chart-1)";
const GRID = "var(--color-border)";
const INK_MUTED = "var(--color-muted-foreground)";
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

function ChartTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0].value ?? 0);
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-panel">
      <p className="font-medium text-foreground">{String(label ?? payload[0].payload?.name ?? "")}</p>
      <p className="text-muted-foreground tabular-nums">{formatXaf(value)}</p>
    </div>
  );
}

/** Répartition des encaissements de l'année : contributions, dons, avances (barres horizontales). */
export function InflowsChart({ data }: { data: Array<{ name: string; amount: number }> }) {
  const total = data.reduce((sum, d) => sum + d.amount, 0);
  return (
    <figure className="space-y-2">
      <div className="h-44" role="img" aria-label={`Répartition des encaissements : ${data.map((d) => `${d.name} ${formatXaf(d.amount)}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, bottom: 4, left: 8 }} barCategoryGap={12}>
            <CartesianGrid horizontal={false} stroke={GRID} strokeWidth={1} />
            <XAxis type="number" hide domain={[0, Math.max(1, ...data.map((d) => d.amount))]} />
            <YAxis type="category" dataKey="name" width={104} tickLine={false} axisLine={false} tick={{ fill: INK_MUTED, fontSize: 12 }} />
            <Tooltip cursor={{ fill: "var(--color-muted)", opacity: 0.5 }} content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} />} />
            <Bar dataKey="amount" fill={BAR} maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="amount" position="right" formatter={(value) => formatXaf(Number(value))} style={{ fill: "var(--color-foreground)", fontSize: 12, fontVariantNumeric: "tabular-nums" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-muted-foreground">Total encaissé : {formatXaf(total)}</figcaption>
    </figure>
  );
}

/** Évolution mensuelle des dépenses de l'année (colonnes). */
export function ExpensesChart({ data }: { data: Array<{ month: string; label: string; amount: number }> }) {
  return (
    <div className="h-56" role="img" aria-label={`Dépenses mensuelles : ${data.map((d) => `${d.label} ${formatXaf(d.amount)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: INK_MUTED, fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: INK_MUTED, fontSize: 12 }} tickFormatter={(value) => compact.format(Number(value))} />
          <Tooltip cursor={{ fill: "var(--color-muted)", opacity: 0.5 }} content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} />} />
          <Bar dataKey="amount" name="Dépenses" fill={BAR} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
