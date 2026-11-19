"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseList, parseDiffList, compare, cardKey, diff } = require("../inventory.js");
const check = (deck, collection) => compare(parseList(deck, "Deck"), parseList(collection, "Collection"));

test("consumes shared owned quantities once across duplicate lines, printings, and sideboard", () => {
  const report = check("Deck\n2 Negate (FDN) 710\n2 NEGATE\nSideboard\n2 Negate", "1 Negate (M20) 69\n2 negate (FDN) 710 *F*");
  assert.equal(report.text, "3 Negate");
  assert.deepEqual([report.total, report.used, report.missing, report.missingNames], [6, 3, 3, 1]);
  assert.deepEqual(report.rows.map((row) => row.used), [3, 0]);
});

test("allocates main deck first when a sideboard appears earlier in the input", () => {
  assert.equal(check("Sideboard\n2 Negate\nDeck\n4 Negate", "5 Negate").text, "1 Negate");
});

test("recognizes text formats, headings, prices, BOM, and SB prefixes", () => {
  const deck = "\ufeffDeck\n# note\n// note\nCreatures (3)\n(3)\n2x Llanowar Elves (FDN) 227\n1xLlanowar Elves\n$2.10\n3 cards total\nLands:\nForest $0.05\nSB: 2 Negate";
  const report = check(deck, "3 Llanowar Elves\nForest\nNegate");
  assert.equal(report.text, "1 Negate");
  assert.equal(report.total, 6);
});

test("matches front face names, curly apostrophes, whitespace, and different editions", () => {
  assert.equal(cardKey(" Fable  of the Mirror-Breaker // Reflection of Kiki-Jiki (NEO) 141 *F*"), cardKey("fable of the mirror-breaker"));
  const report = check("2 Sheoldred’s Edict\n1 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki", "2 Sheoldred's Edict (ONE) 108\n1 Fable of the Mirror-Breaker");
  assert.equal(report.missing, 0);
  assert.equal(report.text, "");
});

test("parses ManaBox CSV with commas, escaped quotes, multiline fields, and duplicate printings", () => {
  const csv = '\ufeffBinder Name,Name,Set code,Quantity,Foil\r\n"Trade, binder","Thalia, Guardian of Thraben",DKA,1,normal\r\n"Another ""binder""\nsecond line","Thalia, Guardian of Thraben",VOW,2,foil\r\nMain,Negate,FDN,0,normal\r\n';
  const report = compare(parseList("4 Thalia, Guardian of Thraben\n1 Negate"), parseList(csv));
  assert.equal(report.text, "1 Thalia, Guardian of Thraben\n1 Negate");
  assert.equal(report.used, 3);
});

test("supports semicolon and TSV headers and optional sideboard column", () => {
  const deck = parseList('Card Name;Count;Section\n"Lightning Strike";4;Main\nNegate;2;Sideboard');
  const collection = parseList("Quantity\tName\n3\tLightning Strike\n1\tNegate");
  assert.equal(compare(deck, collection).text, "1 Lightning Strike\n1 Negate");
});

test("an empty collection needs the whole deck; surplus does not add missing cards", () => {
  assert.equal(check("Deck\n4 Forest\nSideboard\n1 Negate", "").text, "4 Forest\n1 Negate");
  const report = check("2 Forest", "20 Forest\n10 Island");
  assert.equal(report.text, "");
  assert.equal(report.used, 2);
});

test("rejects malformed quantities, CSV, and binary input instead of miscounting", () => {
  for (const text of ["-2 Negate", "1.5 Negate", "1000000001 Negate", "4"]) {
    assert.throws(() => parseList(text), /quantity|whole/);
  }
  assert.throws(() => parseList('Name,Quantity\n"Negate,2'), /not closed/);
  assert.throws(() => parseList("Name,Quantity\nNegate,nope"), /quantity/);
  assert.throws(() => parseList("Name,Quantity\nNegate,2,extra"), /columns/);
  assert.throws(() => parseList("Wrong,Headers\nNegate,2", "Collection", "csv"), /CSV needs/);
  assert.throws(() => parseList("Negate\0"), /binary/);
});

test("missing output combines sections and round-trips without headings or duplicate card lines", () => {
  const result = check("4 Negate\n3 Thalia, Guardian of Thraben\nSideboard\n2 Negate", "1 Negate");
  assert.equal(result.text, "5 Negate\n3 Thalia, Guardian of Thraben");
  assert.equal(compare(parseList(result.text), []).text, result.text);
});

test("deck diff returns only card names absent from the other list", () => {
  const result = diff(
    parseList("Deck\n2 Negate (FDN) 710\nSideboard\n1 Negate\n4 Llanowar Elves"),
    parseList("3 negate\n4 Lightning Strike")
  );
  assert.equal(result.leftText, "4 Llanowar Elves");
  assert.equal(result.rightText, "4 Lightning Strike");
  assert.deepEqual(result.leftOnly, [{ name: "Llanowar Elves", quantity: 4 }]);
});

test("deck diff parsing ignores unnumbered rows and cleans printing details", () => {
  const cards = parseDiffList("\nDeck\nNotes: copied from Arena\n4 Negate (FDN) 710 *F*\nSideboard\n2x Lightning Strike (DMU) 137\n3 cards total\n");
  assert.deepEqual(cards, [
    { name: "Negate", quantity: 4, section: "Main" },
    { name: "Lightning Strike", quantity: 2, section: "Main" },
  ]);
});
