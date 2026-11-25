"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const store = window.DeckFiles;
  const MAX_BYTES = 20 * 1024 * 1024;
  // Cardmarket purchase-confirmation email item rows include printing, rarity,
  // language, condition, and price, or truncate long item descriptions with
  // "..." before the price. Matching these shapes avoids treating email
  // headers, totals, shipment IDs, or arbitrary text files as cards.
  const FULL_ROW = /^\s*(\d+)x\s+(.+?)\s+\(([^()]+(?:\([^()]*\)[^()]*)*)\)\s+-\s+[A-Z]\s+-\s+.+?\s+-\s+(?:NM|EX|GD|LP|PL|PO|MT)(?:\s+-\s+.+?)?\s+\d[\d.,]*\s+EUR\s*$/iu;
  const TRUNCATED_ROW = /^\s*(\d+)x\s+(.+?)(?:\.{3}|…)\s+\d[\d.,]*\s+EUR\s*$/iu;
  const TRUNCATED_AFTER_SET = /^(.+?)\s+\([^()]+(?:\([^()]*\)[^()]*)*\)\s*(?:-\s*.*)?$/u;
  const VERSION_SUFFIX = /\s+\(V\.\d+\)$/i;
  let currentFile = null;
  let sourceText = "";
  let inputChanged = false;

  function status(text, error = false) {
    $("cardmarket-status").textContent = text;
    $("cardmarket-status").classList.toggle("error", error);
  }

  function invalidate() {
    $("cardmarket-results").hidden = true;
    $("cardmarket-output").value = "";
    for (const id of ["cardmarket-copy", "cardmarket-download", "cardmarket-inventory"]) $(id).disabled = true;
  }

  function stripTruncatedSet(body) {
    const afterSet = TRUNCATED_AFTER_SET.exec(body);
    if (afterSet) return afterSet[1];
    let depth = 0;
    let setStart = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "(") {
        if (depth === 0) setStart = i;
        depth++;
      } else if (body[i] === ")" && depth > 0) {
        depth--;
        if (depth === 0) setStart = -1;
      }
    }
    if (depth > 0 && setStart > 0 && /\s/.test(body[setStart - 1])) {
      return body.slice(0, setStart).trim();
    }
    return null;
  }

  function parseOrderRow(line) {
    const full = FULL_ROW.exec(line);
    if (full) {
      return { quantity: Number(full[1]), name: full[2].trim().replace(VERSION_SUFFIX, "").trim() };
    }
    const truncated = TRUNCATED_ROW.exec(line);
    if (!truncated) return null;
    const rawName = stripTruncatedSet(truncated[2]);
    if (!rawName) return null;
    return { quantity: Number(truncated[1]), name: rawName.trim().replace(VERSION_SUFFIX, "").trim() };
  }

  function parseOrders(text) {
    const orders = [];
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      if (/^Contents:\s*$/i.test(line)) {
        current = new Map(); orders.push(current); continue;
      }
      if (!current) continue;
      if (/^Total\s+\d/i.test(line) || /^-{10,}\s*$/.test(line)) {
        current = null; continue;
      }
      const row = parseOrderRow(line);
      if (!row || !row.name || !row.quantity) continue;
      current.set(row.name, (current.get(row.name) || 0) + row.quantity);
    }
    return orders.filter((order) => order.size);
  }

  function isPurchaseConfirmation(text) {
    return /Shipment details:/i.test(text) && parseOrders(text).length > 0;
  }

  function consolidatedList(text) {
    const cards = new Map();
    const orders = parseOrders(text);
    for (const order of orders) for (const [name, quantity] of order) {
      const key = name.toLocaleLowerCase();
      const card = cards.get(key) || { name, quantity: 0 };
      card.quantity += quantity;
      cards.set(key, card);
    }
    const rows = [...cards.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { orders: orders.length, rows, text: rows.map((card) => `${card.quantity} ${card.name}`).join("\n") };
  }

  async function remember() {
    if (!currentFile) return;
    try { await store.save("cardmarket-orders", currentFile, sourceText); }
    catch { status("Purchase email loaded, but browser storage could not remember it.", true); }
  }

  function restorePicker(file) {
    if (file) store.restorePicker($("cardmarket-file"), file);
  }

  $("cardmarket-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    inputChanged = true;
    invalidate();
    currentFile = null;
    sourceText = "";
    if (file.size > MAX_BYTES) { status("Please choose an orders file smaller than 20 MB.", true); return; }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (text.includes("\0")) throw new Error("Choose a UTF-8 text file, not a binary file.");
      if (!isPurchaseConfirmation(text)) throw new Error("Choose a Cardmarket purchase-confirmation email export containing shipment item rows.");
      currentFile = file;
      sourceText = text;
      $("cardmarket-file-hint").textContent = `${file.name} loaded · Re-select it to load changes from disk`;
      status("Purchase email loaded. Consolidate it when you are ready.");
      await remember();
    } catch (error) { status(error.message || "Could not read that file as UTF-8 text.", true); }
  });

  $("cardmarket-consolidate").addEventListener("click", () => {
    invalidate();
    try {
      const input = sourceText;
      if (!input) throw new Error("Choose a Cardmarket purchase-confirmation email export first.");
      if (new TextEncoder().encode(input).length > MAX_BYTES) throw new Error("Please use a purchase email smaller than 20 MB.");
      if (!isPurchaseConfirmation(input)) throw new Error("Choose a Cardmarket purchase-confirmation email export containing shipment item rows.");
      const result = consolidatedList(input);
      if (!result.rows.length) throw new Error("No Cardmarket shipment item rows found in that file.");
      $("cardmarket-output").value = result.text;
      $("cardmarket-stats").replaceChildren();
      const copies = result.rows.reduce((total, card) => total + card.quantity, 0);
      for (const [value, label] of [[result.orders, "Orders found"], [result.rows.length, "Different cards"], [copies, "Total copies"]]) {
        const stat = document.createElement("div"); stat.className = "stat";
        const number = document.createElement("strong"); number.textContent = value;
        const caption = document.createElement("span"); caption.textContent = label;
        stat.append(number, caption); $("cardmarket-stats").append(stat);
      }
      $("cardmarket-results").hidden = false;
      for (const id of ["cardmarket-copy", "cardmarket-download", "cardmarket-inventory"]) $(id).disabled = false;
      status(`Consolidated ${result.orders} order${result.orders === 1 ? "" : "s"}: ${copies} copies across ${result.rows.length} card names.`);
      void remember();
    } catch (error) { status(error.message, true); }
  });

  $("cardmarket-copy").addEventListener("click", async () => {
    const output = $("cardmarket-output");
    try { await navigator.clipboard.writeText(output.value); status("Consolidated deck list copied to clipboard."); }
    catch { output.focus(); output.select(); status("The deck list is selected. Press Ctrl+C (or ⌘C on Mac) to copy it."); }
  });

  $("cardmarket-download").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([$("cardmarket-output").value + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "cardmarket-decklist.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("cardmarket-inventory").addEventListener("click", () => {
    $("inventory-deck-text").value = $("cardmarket-output").value;
    $("inventory-deck-text").dispatchEvent(new Event("input", { bubbles: true }));
    $("inventory-tab").click(); $("inventory-compare").focus();
  });

  store.load("cardmarket-orders").then((saved) => {
    if (!saved || inputChanged) return;
    currentFile = saved;
    sourceText = saved.text;
    $("cardmarket-file-hint").textContent = `${saved.name} restored from this browser · Re-select it to load changes from disk`;
    restorePicker(saved);
    status("Restored your saved purchase email. Consolidate it when you are ready.");
  });
})();
