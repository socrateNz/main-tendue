import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SEX_LABELS } from "@/features/children/types";
import { amountValue, codeFromLabel, countryValue, dateValue, text } from "@/features/imports/convert";

describe("import — conversion des cellules", () => {
  it("texte : vide pour null, espaces retirés, date au format AAAA-MM-JJ", () => {
    assert.equal(text(null), "");
    assert.equal(text("  Awa "), "Awa");
    assert.equal(text(42), "42");
    assert.equal(text(new Date(Date.UTC(2014, 1, 1))), "2014-02-01");
  });

  it("dates : Excel, JJ/MM/AAAA, J/M/AAAA, AAAA-MM-JJ ; null si invalide", () => {
    assert.equal(dateValue(new Date(Date.UTC(2014, 1, 1))), "2014-02-01");
    assert.equal(dateValue("01/02/2014"), "2014-02-01");
    assert.equal(dateValue("1/2/2014"), "2014-02-01");
    assert.equal(dateValue("2014-02-01"), "2014-02-01");
    assert.equal(dateValue("31/02/2014"), null);
    assert.equal(dateValue("demain"), null);
    assert.equal(dateValue(""), null);
  });

  it("montants : entiers FCFA, espaces tolérés, NaN si invalide, null si vide", () => {
    assert.equal(amountValue(100000), 100000);
    assert.equal(amountValue("100 000"), 100000);
    assert.equal(amountValue("100 000 FCFA"), 100000);
    assert.equal(amountValue(null), null);
    assert.ok(Number.isNaN(amountValue(1500.5)));
    assert.ok(Number.isNaN(amountValue("12,5")));
    assert.ok(Number.isNaN(amountValue("-500")));
  });

  it("listes : libellé ou code, sans tenir compte des accents ni de la casse", () => {
    assert.equal(codeFromLabel("garcon", SEX_LABELS), "M");
    assert.equal(codeFromLabel("Fille", SEX_LABELS), "F");
    assert.equal(codeFromLabel("F", SEX_LABELS), "F");
    assert.equal(codeFromLabel("inconnu", SEX_LABELS), null);
    assert.equal(codeFromLabel("", SEX_LABELS), null);
  });

  it("pays : code ISO ou nom français", () => {
    assert.equal(countryValue("fr"), "FR");
    assert.equal(countryValue("France"), "FR");
    assert.equal(countryValue("Cameroun"), "CM");
    assert.equal(countryValue("Atlantide"), null);
  });
});
