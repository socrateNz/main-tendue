import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectImageType } from "@/lib/cloudinary";

describe("contrôle des images téléversées", () => {
  it("reconnaît JPEG, PNG et WebP par leur contenu", () => {
    assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
    assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
    assert.equal(detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])), "image/webp");
  });

  it("refuse un fichier déguisé (script renommé en .jpg, SVG, PDF)", () => {
    assert.equal(detectImageType(Buffer.from("<script>alert(1)</script>")), null);
    assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(detectImageType(Buffer.from("%PDF-1.7")), null);
  });
});
