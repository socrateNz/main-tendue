import { buildReport } from "@/features/reports/queries";
import { REPORT_META, REPORT_TYPES, type ReportType } from "@/features/reports/types";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { toXlsx, XLSX_CONTENT_TYPE } from "@/lib/xlsx";

/** Export Excel (.xlsx) d'un rapport : mêmes permissions et mêmes calculs que la page. */
export async function GET(request: Request, { params }: RouteContext<"/api/rapports/[type]">) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Authentification requise." }, { status: 401 });
  const { type } = await params;
  if (!(REPORT_TYPES as readonly string[]).includes(type)) return Response.json({ error: "Rapport inconnu." }, { status: 404 });
  const reportType = type as ReportType;
  if (!hasPermission(user.role, REPORT_META[reportType].permission)) return Response.json({ error: "Accès refusé." }, { status: 403 });

  const yearId = new URL(request.url).searchParams.get("annee");
  const report = await buildReport(reportType, yearId, { withFinance: hasPermission(user.role, "reports:finance") });
  if (!report) return Response.json({ error: "Rapport indisponible pour cette année." }, { status: 404 });

  const rows = report.rows.map((row) => report.columns.map((column) => row[column.key] ?? null));
  if (report.totals) rows.push(report.columns.map((column) => report.totals?.[column.key] ?? null));
  const buffer = await toXlsx(
    report.title,
    report.columns.map((c) => ({ label: c.kind === "money" ? `${c.label} (FCFA)` : c.kind === "percent" ? `${c.label} (%)` : c.label, kind: c.kind })),
    rows,
    { title: report.title, totalsRow: Boolean(report.totals) },
  );
  const filename = `${reportType}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
