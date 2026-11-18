"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const { parseList, compare } = window.DeckInventory;
  const MAX_BYTES = 20 * 1024 * 1024;
  const reading = new Map();
  const versions = { deck: 0, collection: 0 };
  const formats = { deck: "auto", collection: "auto" };

  function status(text, error = false) {
    $("inventory-status").textContent = text;
    $("inventory-status").classList.toggle("error", error);
  }

  function invalidate() {
    $("inventory-results").hidden = true;
    $("inventory-output").value = "";
    $("inventory-copy").disabled = true;
    $("inventory-download").disabled = true;
    status("Lists updated. Check inventory to create a new missing list.");
  }

  for (const kind of ["deck", "collection"]) {
    const input = $(`inventory-${kind}-file`);
    const text = $(`inventory-${kind}-text`);
    const hint = $(`inventory-${kind}-file-hint`);
    reading.set(kind, 0);
    $("inventory-compare").disabled = true;
    window.DeckFiles.load(`inventory-${kind}`).then((saved) => {
      if (!saved || versions[kind]) return;
      text.value = saved.text;
      formats[kind] = /\.csv$/i.test(saved.name) ? "csv" : /\.tsv$/i.test(saved.name) ? "tsv" : "auto";
      hint.textContent = `${saved.name} · Restored saved copy`;
      window.DeckFiles.restorePicker(input, saved);
      status("Restored your saved files. Check inventory when your lists are ready.");
    }).finally(() => {
      if (reading.get(kind) === 0) reading.delete(kind);
      $("inventory-compare").disabled = reading.size > 0;
    });
    text.addEventListener("input", () => {
      versions[kind]++;
      formats[kind] = "auto";
      hint.textContent = "Using the pasted / edited list · Text or CSV";
      invalidate();
    });
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const version = ++versions[kind];
      invalidate();
      text.value = "";
      hint.textContent = `Loading ${file.name}…`;
      reading.set(kind, version);
      $("inventory-compare").disabled = true;
      try {
        if (file.size > MAX_BYTES) throw new Error("Please use a text or CSV file smaller than 20 MB.");
        const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        if (content.includes("\0")) throw new Error("This looks like a binary file. Export your list as UTF-8 text or CSV.");
        if (version !== versions[kind]) return;
        text.value = content;
        formats[kind] = /\.csv$/i.test(file.name) ? "csv" : /\.tsv$/i.test(file.name) ? "tsv" : "auto";
        hint.textContent = `${file.name} · Loaded locally`;
        status(`Loaded ${file.name}. Check inventory when both lists are ready.`);
        try { await window.DeckFiles.save(`inventory-${kind}`, file, content); }
        catch {
          if (version === versions[kind]) status(`Loaded ${file.name}, but browser storage could not remember it.`, true);
        }
      } catch (error) {
        if (version !== versions[kind]) return;
        hint.textContent = "File not loaded · Choose another text or CSV file";
        status(error instanceof TypeError ? "Cannot read this as UTF-8. Export your list as UTF-8 text or CSV." : error.message, true);
      } finally {
        if (reading.get(kind) === version) reading.delete(kind);
        $("inventory-compare").disabled = reading.size > 0;
      }
    });
  }

  $("inventory-use-rotation").addEventListener("click", () => {
    const text = $("deck-text").value;
    if (!text.trim()) { status("Add a deck in Rotation check first, or choose a deck file here.", true); return; }
    versions.deck++;
    formats.deck = "auto";
    $("inventory-deck-text").value = text;
    $("inventory-deck-file-hint").textContent = "Copied from Rotation check";
    invalidate();
  });

  $("inventory-compare").addEventListener("click", () => {
    invalidate();
    try {
      for (const kind of ["deck", "collection"]) {
        if (new TextEncoder().encode($(`inventory-${kind}-text`).value).length > MAX_BYTES) throw new Error("Please use lists smaller than 20 MB each.");
      }
      const deck = parseList($("inventory-deck-text").value, "Deck", formats.deck);
      if (!deck.length) { $("inventory-deck-text").focus(); throw new Error("No cards found in the deck. Choose a deck file or paste your cards first."); }
      const collection = parseList($("inventory-collection-text").value, "Collection", formats.collection);
      const result = compare(deck, collection);
      $("inventory-output").value = result.text;
      $("inventory-stats").replaceChildren();
      for (const [value, caption, style] of [[result.total, "Deck copies", ""], [result.used, "Owned copies used", "good"], [result.missing, "Missing copies", "bad"], [result.missingNames, "Different cards missing", ""]]) {
        const stat = document.createElement("div");
        stat.className = `stat ${style}`;
        const count = document.createElement("strong");
        count.textContent = value;
        const label = document.createElement("span");
        label.textContent = caption;
        stat.append(count, label);
        $("inventory-stats").append(stat);
      }
      const body = document.createDocumentFragment();
      for (const row of result.rows) {
        const tr = document.createElement("tr");
        for (const value of [row.name, row.section === "Main" ? "Main" : "Sideboard", row.needed, row.used, row.missing]) {
          const td = document.createElement("td");
          td.textContent = value;
          tr.append(td);
        }
        body.append(tr);
      }
      $("inventory-rows").replaceChildren(body);
      $("inventory-results").hidden = false;
      $("inventory-copy").disabled = !result.missing;
      $("inventory-download").disabled = !result.missing;
      status(result.missing ? `You need ${result.missing} more copies across ${result.missingNames} different cards. Your missing deck list is ready.` : "You own all the copies needed for this deck. Nothing is missing.");
    } catch (error) { status(error.message, true); }
  });

  $("inventory-copy").addEventListener("click", async () => {
    const output = $("inventory-output");
    const snapshot = output.value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(snapshot);
      if (output.value === snapshot) status("Missing deck list copied to clipboard.");
    } catch {
      output.focus();
      output.select();
      status("The missing list is selected. Press Ctrl+C (or ⌘C on Mac) to copy it.");
    }
  });

  $("inventory-download").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([$("inventory-output").value + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "missing-decklist.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
