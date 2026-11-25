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
  let currentFiles = [];
  let inputChanged = false;

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

  function pastedLists(text) {
    // A selected file is always one list. For pasted input, a blank line marks
    // the next list so repeated lines inside a list can still be added first.
    return text.split(/(?:\r?\n){2,}/).filter((list) => list.trim());
  }

  function consolidate(lists) {
    const cards = new Map();
    let entries = 0;
    for (const list of lists) {
      const listCards = new Map();
      for (const line of list.split(/\r?\n/)) {
        const match = ROW.exec(line);
        if (!match) continue;
        const name = cleanCardName(match[2]);
        // Price rows and bare totals are not card rows because they lack a name.
        if (!name || /^[€$£©]|^(cards?|articles?|wants?\s*lists?|copyright)\b/i.test(name)) continue;
        const key = name.toLocaleLowerCase();
        const card = listCards.get(key) || { name, quantity: 0 };
        const quantity = Number(match[1]);
        if (!Number.isSafeInteger(quantity) || quantity + card.quantity > Number.MAX_SAFE_INTEGER) throw new Error("Wanted quantities are too large.");
        card.quantity += quantity;
        listCards.set(key, card);
        entries++;
      }
      for (const [key, card] of listCards) {
        const existing = cards.get(key);
        if (!existing || card.quantity > existing.quantity) cards.set(key, card);
      }
    }
    const rows = [...cards.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { entries, rows, text: rows.map((card) => `${card.quantity} ${card.name}`).join("\n") };
  }

  async function remember() {
    if (!currentFiles.length) return;
    try { await store.saveMany("wants-lists", currentFiles); }
    catch { status("Wants lists loaded, but browser storage could not remember them.", true); }
  }

  $("wants-list-file").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    if (!files.length) return;
    inputChanged = true;
    invalidate();
    try {
      const loaded = await Promise.all(files.map(async (file) => {
        if (file.size > MAX_BYTES) throw new Error(`${file.name}: choose a wants-list file smaller than 20 MB.`);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        if (text.includes("\0")) throw new Error(`${file.name}: choose a UTF-8 text file, not a binary file.`);
        return { name: file.name, type: file.type || "text/plain", lastModified: file.lastModified, text };
      }));
      currentFiles = loaded;
      $("wants-list-text").value = loaded.map((file) => file.text).join("\n\n");
      $("wants-list-file-hint").textContent = `${loaded.length} file(s) loaded · Re-select files to load changes from disk`;
      status("Wants lists loaded. Consolidate them when you are ready.");
      await remember();
    } catch (error) { status(error.message || "Could not read that file as UTF-8 text.", true); }
  });

  $("wants-list-text").addEventListener("input", () => {
    inputChanged = true;
    invalidate();
    if ($("wants-list-text").value.trim()) status("Wants lists updated. Consolidate them to refresh the list.");
    currentFiles = [];
  });

  $("wants-list-consolidate").addEventListener("click", () => {
    invalidate();
    try {
      const input = $("wants-list-text").value;
      if (new TextEncoder().encode(input).length > MAX_BYTES) throw new Error("Please use wants lists smaller than 20 MB.");
      const lists = currentFiles.length ? currentFiles.map((file) => file.text) : pastedLists(input);
      const result = consolidate(lists);
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
      status(`Kept the maximum from ${lists.length} list(s): ${result.entries} card rows into ${result.rows.length} card names (${copies} total copies).`);
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

  Promise.all([store.loadMany("wants-lists"), store.load("wants-lists")]).then(([saved, legacy]) => {
    // Versions before multi-file support stored one snapshot under this key.
    if (!saved.length && legacy) saved = [legacy];
    // Never let the asynchronous restore replace files or text just chosen by
    // the user while it was still loading.
    if (!saved.length || inputChanged) return;
    currentFiles = saved;
    $("wants-list-text").value = saved.map((file) => file.text).join("\n\n");
    $("wants-list-file-hint").textContent = `${saved.length} file(s) restored from this browser · Re-select files to load changes from disk`;
    try { store.restorePicker($("wants-list-file"), saved); } catch { /* The restored text remains usable. */ }
    status("Restored your saved wants lists. Consolidate them when you are ready.");
  });
})();
