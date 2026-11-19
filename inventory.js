/* Local-only deck / collection parsing and quantity comparison. */
"use strict";

((root) => {
  const HEADINGS = /^(main\s*deck|deck|sideboard|creatures?|instants?|sorceries|enchantments?|artifacts?|lands?|planeswalkers?|battles?|commander|companion)\s*(?:\(\d+\))?\s*:?$/i;
  const MAX_QUANTITY = 1000000000;

  function cleanName(name) {
    return name.normalize("NFC")
      .replace(/\s+\([a-z0-9]{2,6}\)(?:\s+[\w★-]+)?(?:\s+\*[a-z]+\*)?\s*$/iu, "")
      .replace(/\s+\*(?:f|e)\*\s*$/i, "")
      .replace(/\s+/g, " ").trim();
  }

  function cardKey(name) {
    // Front-face exports match a full double-faced name without a network lookup.
    return cleanName(name).split(/\s*\/\/\s*/)[0]
      .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').toLowerCase();
  }

  function quantity(value, location) {
    const text = String(value).trim();
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > MAX_QUANTITY) {
      throw new Error(`${location}: quantity must be a whole number between 0 and ${MAX_QUANTITY.toLocaleString("en-US")}.`);
    }
    return Number(text);
  }

  function readDelimited(text, delimiter) {
    const rows = [];
    let row = [], cell = "", quoted = false, closed = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
        else if (char === '"') { quoted = false; closed = true; }
        else cell += char;
      } else if (char === delimiter || char === "\n" || char === "\r") {
        row.push(cell.trim()); cell = ""; closed = false;
        if (char !== delimiter) {
          if (char === "\r" && text[index + 1] === "\n") index++;
          if (row.some((value) => value !== "")) rows.push(row);
          row = [];
        }
      } else if (char === '"' && !cell.trim() && !closed) {
        cell = ""; quoted = true;
      } else if (closed && !/\s/.test(char)) {
        throw new Error("Malformed CSV: unexpected text after a closing quote.");
      } else if (!closed) cell += char;
    }
    if (quoted) throw new Error("Malformed CSV: a quoted field is not closed.");
    row.push(cell.trim());
    if (row.some((value) => value !== "")) rows.push(row);
    return rows;
  }

  const headerKey = (value) => value.toLowerCase().replace(/[\s_-]+/g, "");
  const NAME_HEADERS = ["name", "cardname", "card"];
  const QUANTITY_HEADERS = ["quantity", "count", "qty", "amount", "owned"];

  function parseCSV(text, delimiter, label) {
    const rows = readDelimited(text, delimiter);
    if (!rows.length) return [];
    const headers = rows.shift().map(headerKey);
    const nameIndex = headers.findIndex((name) => NAME_HEADERS.includes(name));
    const countIndex = headers.findIndex((name) => QUANTITY_HEADERS.includes(name));
    const sectionIndex = headers.findIndex((name) => ["section", "board"].includes(name));
    if (nameIndex < 0 || countIndex < 0) throw new Error(`${label}: CSV needs a Name (or Card Name) column and a Quantity, Count, or Qty column.`);
    return rows.flatMap((row, index) => {
      const location = `${label}, CSV row ${index + 2}`;
      if (row.length !== headers.length) throw new Error(`${location}: the number of columns does not match the header.`);
      const count = quantity(row[countIndex], location);
      const name = cleanName(row[nameIndex]);
      if (!name) throw new Error(`${location}: card name is empty.`);
      return count ? [{ name, quantity: count, section: sectionIndex >= 0 && /^(side|sideboard|sb)$/i.test(row[sectionIndex]) ? "Side" : "Main" }] : [];
    });
  }

  function parseList(raw, label = "List", format = "auto") {
    const text = raw.replace(/^\ufeff/, "").trim();
    if (!text) return [];
    if (text.includes("\0")) throw new Error(`${label}: choose a UTF-8 text file, not a binary file.`);
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delimiter = [",", ";", "\t"].find((candidate) => {
      // Detection only examines headers, so commas inside card names stay text.
      try {
        const header = readDelimited(firstLine, candidate)[0] || [];
        return header.some((cell) => NAME_HEADERS.includes(headerKey(cell))) && header.length > 1;
      } catch { return false; }
    });
    if (delimiter || format === "csv" || format === "tsv") {
      return parseCSV(text, delimiter || (format === "tsv" ? "\t" : ","), label);
    }
    let section = "Main";
    const cards = [];
    for (const [index, original] of text.split(/\r?\n/).entries()) {
      let line = original.trim();
      if (!line || /^(#|\/\/)/.test(line)) continue;
      const heading = HEADINGS.exec(line);
      if (heading) {
        if (/^sideboard/i.test(line)) section = "Side";
        else if (/^(main\s*deck|deck)\b/i.test(line)) section = "Main";
        continue;
      }
      if (/^(?:\(\d+\)|[$€£]\s*[\d,.]+|\d+\s+cards?\s+total)$/i.test(line)) continue;
      let rowSection = section;
      if (/^SB:\s*/i.test(line)) { rowSection = "Side"; line = line.replace(/^SB:\s*/i, ""); }
      line = line.split(/\s+[$€£]\s*\d/, 1)[0].trim();
      const match = /^(\d+)\s*x?\s+(.+)$|^(\d+)x\s*(.+)$/i.exec(line);
      if (!match && /^[+\-]?\d+(?:[.,]\d+)?(?:\s|x|$)/i.test(line)) {
        throw new Error(`${label}, line ${index + 1}: use a whole quantity followed by a card name.`);
      }
      const count = match ? quantity(match[1] || match[3], `${label}, line ${index + 1}`) : 1;
      const name = cleanName(match ? match[2] || match[4] : line);
      if (!name) throw new Error(`${label}, line ${index + 1}: card name is empty.`);
      if (count) cards.push({ name, quantity: count, section: rowSection });
    }
    return cards;
  }

  function parseDiffList(raw, label = "List") {
    // Deck diff intentionally accepts only numbered card rows. This leaves deck
    // headings, section headings, notes, and other export metadata out of the
    // comparison while reusing parseList's card-name cleanup.
    const numberedRows = raw.split(/\r?\n/).filter((line) =>
      /^\s*\d+(?:\s*x?\s+\S|x\s*\S)/i.test(line)
    ).join("\n");
    return parseList(numberedRows, label);
  }

  function addCount(map, key, count) {
    const total = (map.get(key) || 0) + count;
    if (!Number.isSafeInteger(total)) throw new Error("The combined quantities are too large.");
    map.set(key, total);
  }

  function compare(deck, collection) {
    const owned = new Map();
    for (const card of collection) addCount(owned, cardKey(card.name), card.quantity);
    const grouped = new Map();
    const neededCounts = new Map();
    // Allocate the main deck before the sideboard, even if sections were pasted out of order.
    for (const card of [...deck.filter((card) => card.section === "Main"), ...deck.filter((card) => card.section === "Side")]) {
      const key = card.section + "\n" + cardKey(card.name);
      addCount(neededCounts, key, card.quantity);
      if (!grouped.has(key)) grouped.set(key, card);
    }
    const rows = [];
    let total = 0, used = 0, missing = 0;
    const missingNames = new Set();
    for (const [groupKey, card] of grouped) {
      const key = cardKey(card.name);
      const needed = neededCounts.get(groupKey);
      const have = Math.min(needed, owned.get(key) || 0);
      const shortage = needed - have;
      owned.set(key, (owned.get(key) || 0) - have);
      rows.push({ name: card.name, section: card.section, needed, used: have, missing: shortage });
      total += needed; used += have; missing += shortage;
      if (!Number.isSafeInteger(total)) throw new Error("The combined deck quantities are too large.");
      if (shortage) missingNames.add(key);
    }
    const missingCards = new Map();
    for (const row of rows) {
      if (!row.missing) continue;
      const key = cardKey(row.name);
      const existing = missingCards.get(key);
      if (existing) existing.quantity += row.missing;
      else missingCards.set(key, { name: row.name, quantity: row.missing });
    }
    const text = [...missingCards.values()].map((card) => `${card.quantity} ${card.name}`).join("\n");
    return { rows, total, used, missing, missingNames: missingNames.size, text };
  }

  function merge(decks) {
    const cards = new Map();
    let separateTotal = 0;
    decks.forEach((deck, index) => {
      const counts = new Map();
      for (const card of deck) {
        const key = cardKey(card.name);
        addCount(counts, key, card.quantity);
        if (!cards.has(key)) cards.set(key, { name: card.name, quantity: 0, quantities: Array(decks.length).fill(0) });
      }
      for (const [key, count] of counts) {
        const card = cards.get(key);
        card.quantities[index] = count;
        card.quantity = Math.max(card.quantity, count);
        separateTotal += count;
        if (!Number.isSafeInteger(separateTotal)) throw new Error("The combined deck quantities are too large.");
      }
    });
    const rows = [...cards.values()];
    const total = rows.reduce((count, card) => count + card.quantity, 0);
    const text = rows.map((card) => `${card.quantity} ${card.name}`).join("\n");
    return { rows, total, separateTotal, text };
  }

  function diff(left, right) {
    function uniqueCards(cards) {
      const grouped = new Map();
      for (const card of cards) {
        const key = cardKey(card.name);
        const existing = grouped.get(key);
        if (existing) {
          const total = existing.quantity + card.quantity;
          if (!Number.isSafeInteger(total)) throw new Error("The combined quantities are too large.");
          existing.quantity = total;
        }
        else grouped.set(key, { name: card.name, quantity: card.quantity });
      }
      return grouped;
    }
    const leftCards = uniqueCards(left);
    const rightCards = uniqueCards(right);
    const leftOnly = [...leftCards].filter(([key]) => !rightCards.has(key)).map(([, card]) => card);
    const rightOnly = [...rightCards].filter(([key]) => !leftCards.has(key)).map(([, card]) => card);
    return {
      leftOnly,
      rightOnly,
      leftText: leftOnly.map((card) => `${card.quantity} ${card.name}`).join("\n"),
      rightText: rightOnly.map((card) => `${card.quantity} ${card.name}`).join("\n"),
    };
  }

  const api = Object.freeze({ parseList, parseDiffList, compare, cardKey, merge, diff });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DeckInventory = api;
})(globalThis);
