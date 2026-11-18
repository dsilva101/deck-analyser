"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseList, merge, compare } = require("../inventory.js");
const combine = (...decks) => merge(decks.map((text) => parseList(text)));

test("takes maximum quantities, retaining cards unique to any input", () => {
  const result = combine("2 Negate\n20 Island", "4 Negate\n3 Forest", "3 Negate\n2 Forest\n1 Plains");
  assert.equal(result.text, "4 Negate\n20 Island\n3 Forest\n1 Plains");
  assert.equal(result.total, 28);
  assert.equal(result.separateTotal, 35);
  assert.deepEqual(result.rows[0].quantities, [2, 4, 3]);
});

test("adds duplicate lines and main plus sideboard within each deck before taking max", () => {
  const result = combine("Deck\n2 Negate (FDN) 710\n2 NEGATE\nSideboard\n1 Negate", "Deck\n2 Negate\nSideboard\n4 Negate");
  assert.equal(result.text, "6 Negate");
  assert.deepEqual(result.rows[0].quantities, [5, 6]);
});

test("merging a duplicate deck does not increase quantities", () => {
  const deck = "Deck\n4 Negate\n3 Forest\nSideboard\n1 Disdainful Stroke";
  assert.equal(combine(deck, deck, deck).text, "4 Negate\n3 Forest\n1 Disdainful Stroke");
});

test("matches printings, foils, Unicode apostrophes, double-faced exports and CSV", () => {
  const result = combine("1 Sheoldred’s Edict (ONE) 108 *F*\n2 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki", "Name,Quantity\nSheoldred's Edict,3\nFable of the Mirror-Breaker,1");
  assert.equal(result.rows.length, 2);
  assert.equal(result.total, 5);
  assert.equal(result.rows[0].quantity, 3);
});

test("the merged pool supplies every deck; lowering any required card breaks that guarantee", () => {
  const decks = ["2 Negate\n3 Forest", "Deck\n3 Negate\nSideboard\n2 Negate\n1 Plains", "4 Forest\n2 Island"].map((text) => parseList(text));
  const result = merge(decks);
  const pool = parseList(result.text);
  for (const deck of decks) assert.equal(compare(deck, pool).missing, 0);
  for (let index = 0; index < pool.length; index++) {
    const smaller = pool.map((card, position) => ({ ...card, quantity: card.quantity - Number(position === index) }));
    assert.ok(decks.some((deck) => compare(deck, smaller).missing > 0));
  }
});
