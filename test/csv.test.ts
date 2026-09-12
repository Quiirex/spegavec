import { describe, expect, it } from "vitest";
import { toCsv } from "../src/core/csv.js";

describe("toCsv", () => {
  it("zapiše glavo in vrstice, prazne celice za null", () => {
    const csv = toCsv(["a", "b"], [["x", 1], [null, 2.5]]);
    expect(csv).toBe("\ufeffa,b\nx,1\n,2.5\n");
  });

  it("narekuje celice z vejico, narekovaji ali novo vrstico", () => {
    const csv = toCsv(["t"], [['on je rekel "hej", pa šel'], ["dve\nvrstici"]]);
    expect(csv).toBe('\ufefft\n"on je rekel ""hej"", pa šel"\n"dve\nvrstici"\n');
  });
});
