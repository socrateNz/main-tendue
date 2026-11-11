import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toCsv } from "@/lib/csv";

describe("export CSV (Excel)", () => {
  it("ajoute le BOM, utilise « ; » et échappe guillemets et séparateurs", () => {
    const csv = toCsv(["Nom", "Montant"], [["Dupont; Claire", 100000], ['Le "Club"', null]]);
    assert.equal(csv, '\uFEFFNom;Montant\r\n"Dupont; Claire";100000\r\n"Le ""Club""";\r\n');
  });

  it("neutralise les cellules interprétables comme des formules", () => {
    const csv = toCsv(["x"], [["=HYPERLINK(\"http://x\")"], ["+1"], ["-2"], ["@cmd"]]);
    assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));
    assert.ok(csv.includes("'+1") && csv.includes("'-2") && csv.includes("'@cmd"));
  });

  it("laisse les nombres négatifs numériques intacts", () => {
    assert.ok(toCsv(["solde"], [[-5000]]).includes("\r\n-5000\r\n"));
  });
});
