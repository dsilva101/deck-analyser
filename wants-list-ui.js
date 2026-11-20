"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const store = window.DeckFiles;
  const MAX_BYTES = 20 * 1024 * 1024;
  const ROW = /^\s*(\d+)\s*x?\s+(.+?)\s*$/i;
  const VERSION_SUFFIX = /\s+\(V\.\d+\)$/i;
  // Wants-list exports often append a printing preference such as "(any)",
  // "(MH3) 199", or "[Modern Horizons 3]".  Consolidation is by card, not
  // printing, so omit that metadata from both the output and the grouping key.
  const PRINTING_SUFFIX = /\s+(?:\([^()]+\)(?:\s+[\w★-]+)?(?:\s+\*[a-z]+\*)?|\[[^\]]+\])\s*$/iu;
  let currentFile = null;

  function status(text, error = false) {
    $("wants-list-status").textContent = text;
    $("wants-list-status").classList.toggle("error", error);
  }

  function invalidate() {
    $("wants-list-results").hidden = true;
    $("wants-list-output").value = "";
    for (const id of ["wants-list-copy", "wants-list-download", "wants-list-inventory"]) $(id).disabled = true;
  }

  function cleanCardName(name) {
    // Marketplace table exports put availability/condition columns after the
    // card name, separated by tabs (for example: "Card Name\tAny\t...").
    let cleaned = name.split("\t", 1)[0].replace(VERSION_SUFFIX, "").trim();
    while (PRINTING_SUFFIX.test(cleaned)) cleaned = cleaned.replace(PRINTING_SUFFIX, "").trim();
    return cleaned;
  }

  function consolidate(text) {
    const cards = new Map();
    let entries = 0;
    for (const line of text.split(/\r?\n/)) {
      const match = ROW.exec(line);
      if (!match) continue;
      const name = cleanCardName(match[2]);
      // Price rows and bare totals are not card rows because they lack a name.
      if (!name || /^[€$£©]|^(cards?|articles?|wants?\s*lists?|copyright)\b/i.test(name)) continue;
      const key = name.toLocaleLowerCase();
      const card = cards.get(key) || { name, quantity: 0 };
      card.quantity += Number(match[1]);
      cards.set(key, card);
      entries++;
    }
    const rows = [...cards.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { entries, rows, text: rows.map((card) => `${card.quantity} ${card.name}`).join("\n") };
  }

  async function remember() {
    if (!currentFile) return;
    try { await store.save("wants-lists", currentFile, $("wants-list-text").value); }
    catch { status("Wants lists loaded, but browser storage could not remember them.", true); }
  }

  $("wants-list-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    invalidate();
    if (file.size > MAX_BYTES) { status("Please choose a wants-list file smaller than 20 MB.", true); return; }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (text.includes("\0")) throw new Error("Choose a UTF-8 text file, not a binary file.");
      currentFile = file;
      $("wants-list-text").value = text;
      $("wants-list-file-hint").textContent = `${file.name} loaded · Re-select it to load changes from disk`;
      status("Wants lists loaded. Consolidate them when you are ready.");
      await remember();
    } catch (error) { status(error.message || "Could not read that file as UTF-8 text.", true); }
  });

  $("wants-list-text").addEventListener("input", () => {
    invalidate();
    if ($("wants-list-text").value.trim()) status("Wants lists updated. Consolidate them to refresh the list.");
    if (currentFile) void remember();
  });

  $("wants-list-consolidate").addEventListener("click", () => {
    invalidate();
    try {
      const input = $("wants-list-text").value;
      if (new TextEncoder().encode(input).length > MAX_BYTES) throw new Error("Please use wants lists smaller than 20 MB.");
      const result = consolidate(input);
      if (!result.rows.length) throw new Error("No card rows found. Use lines such as ‘4x Psychic Frog’ or ‘4 Psychic Frog’.");
      $("wants-list-output").value = result.text;
      $("wants-list-stats").replaceChildren();
      const copies = result.rows.reduce((total, card) => total + card.quantity, 0);
      for (const [value, label] of [[result.entries, "Card rows found"], [result.rows.length, "Different cards"], [copies, "Total wanted copies"]]) {
        const stat = document.createElement("div"); stat.className = "stat";
        const number = document.createElement("strong"); number.textContent = value;
        const caption = document.createElement("span"); caption.textContent = label;
        stat.append(number, caption); $("wants-list-stats").append(stat);
      }
      $("wants-list-results").hidden = false;
      for (const id of ["wants-list-copy", "wants-list-download", "wants-list-inventory"]) $(id).disabled = false;
      status(`Consolidated ${result.entries} card rows into ${result.rows.length} card names (${copies} total copies).`);
      void remember();
    } catch (error) { status(error.message, true); }
  });

  $("wants-list-copy").addEventListener("click", async () => {
    const output = $("wants-list-output");
    try { await navigator.clipboard.writeText(output.value); status("Consolidated wants list copied to clipboard."); }
    catch { output.focus(); output.select(); status("The wants list is selected. Press Ctrl+C (or ⌘C on Mac) to copy it."); }
  });

  $("wants-list-download").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([$("wants-list-output").value + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "consolidated-wants-list.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("wants-list-inventory").addEventListener("click", () => {
    $("inventory-deck-text").value = $("wants-list-output").value;
    $("inventory-deck-text").dispatchEvent(new Event("input", { bubbles: true }));
    $("inventory-tab").click(); $("inventory-compare").focus();
  });

  store.load("wants-lists").then((saved) => {
    if (!saved) return;
    currentFile = saved;
    $("wants-list-text").value = saved.text;
    $("wants-list-file-hint").textContent = `${saved.name} restored from this browser · Re-select it to load changes from disk`;
    try { store.restorePicker($("wants-list-file"), saved); } catch { /* The restored text remains usable. */ }
    status("Restored your saved wants lists. Consolidate them when you are ready.");
  });
})();
