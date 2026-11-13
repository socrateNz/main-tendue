import { buildImportTemplate } from "@/features/imports/workbook";
import { SchoolYear } from "@/features/school-years/model";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db/mongoose";
import { XLSX_CONTENT_TYPE } from "@/lib/xlsx";

/** Modèle d'import Excel, avec la liste des années scolaires non clôturées. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Authentification requise." }, { status: 401 });
  if (!hasPermission(user.role, "data:import")) return Response.json({ error: "Accès refusé." }, { status: 403 });

  await connectDB();
  const years = await SchoolYear.find({ status: { $ne: "CLOSED" } }, { label: 1 }).sort({ startDate: -1 }).lean();
  const buffer = await buildImportTemplate(years.map((y) => y.label));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": 'attachment; filename="modele-import-main-tendue.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
