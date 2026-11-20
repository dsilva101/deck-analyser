"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const store = window.DeckFiles;
  const MAX_BYTES = 20 * 1024 * 1024;
  const MARKER = "magic the gathering singles";
  const ROW = /^\s*(\d+)\s*x\s+(.+?)\s*$/i;
  const VERSION_SUFFIX = /\s+\(V\.\d+\)$/i;
  let currentFile = null;

  function status(text, error = false) {
    $("cardmarket-status").textContent = text;
    $("cardmarket-status").classList.toggle("error", error);
  }

  function invalidate() {
    $("cardmarket-results").hidden = true;
    $("cardmarket-output").value = "";
    for (const id of ["cardmarket-copy", "cardmarket-download", "cardmarket-inventory"]) $(id).disabled = true;
  }

  function parseOrders(text) {
    const orders = [];
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.toLocaleLowerCase().includes(MARKER)) {
        current = new Map(); orders.push(current); continue;
      }
      if (!current) continue;
      const match = ROW.exec(line);
      if (!match) continue;
      const name = match[2].replace(VERSION_SUFFIX, "").trim();
      current.set(name, (current.get(name) || 0) + Number(match[1]));
    }
    return orders.filter((order) => order.size);
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
    try { await store.save("cardmarket-orders", currentFile, $("cardmarket-text").value); }
    catch { status("Orders loaded, but browser storage could not remember them.", true); }
  }

  function restorePicker(file) {
    if (file) store.restorePicker($("cardmarket-file"), file);
  }

  $("cardmarket-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    invalidate();
    if (file.size > MAX_BYTES) { status("Please choose an orders file smaller than 20 MB.", true); return; }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (text.includes("\0")) throw new Error("Choose a UTF-8 text file, not a binary file.");
      currentFile = file;
      $("cardmarket-text").value = text;
      $("cardmarket-file-hint").textContent = `${file.name} loaded · Re-select it to load changes from disk`;
      status("Orders loaded. Consolidate them when you are ready.");
      await remember();
    } catch (error) { status(error.message || "Could not read that file as UTF-8 text.", true); }
  });

  $("cardmarket-text").addEventListener("input", () => {
    invalidate();
    if ($("cardmarket-text").value.trim()) status("Orders updated. Consolidate them to refresh the deck list.");
    if (currentFile) void remember();
  });

  $("cardmarket-consolidate").addEventListener("click", () => {
    invalidate();
    try {
      const input = $("cardmarket-text").value;
      if (new TextEncoder().encode(input).length > MAX_BYTES) throw new Error("Please use an orders list smaller than 20 MB.");
      const result = consolidatedList(input);
      if (!result.rows.length) throw new Error("No Cardmarket card rows found. Include the “Magic the Gathering Singles” heading and its quantity rows.");
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
    if (!saved) return;
    currentFile = saved;
    $("cardmarket-text").value = saved.text;
    $("cardmarket-file-hint").textContent = `${saved.name} restored from this browser · Re-select it to load changes from disk`;
    restorePicker(saved);
    status("Restored your saved Cardmarket orders. Consolidate them when you are ready.");
  });
})();
