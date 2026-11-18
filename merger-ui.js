"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const { parseList, merge } = window.DeckInventory;
  const store = window.DeckFiles;
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_DECKS = 100;
  let decks = [];
  let nextId = 0;
  let busy = false;
  let saveTimer;
  let revision = 0;

  function status(text, error = false) {
    $("merger-status").textContent = text;
    $("merger-status").classList.toggle("error", error);
  }

  function invalidate() {
    revision++;
    $("merger-results").hidden = true;
    $("merger-output").value = "";
    for (const id of ["merger-copy", "merger-download", "merger-inventory"]) $(id).disabled = true;
  }

  function setBusy(value) {
    busy = value;
    for (const id of ["merger-files", "merger-add", "merger-example", "merger-merge"]) $(id).disabled = value;
    $("merger-inputs").querySelectorAll("textarea, button").forEach((input) => { input.disabled = value; });
  }

  function fresh(text = "", name = "", picked = false, file = {}) {
    return { id: ++nextId, text, name, picked, type: file.type || "text/plain", lastModified: file.lastModified || Date.now() };
  }

  async function remember() {
    clearTimeout(saveTimer);
    const version = revision;
    const snapshots = decks.map(({ name, text, picked, type, lastModified }) => ({ name, text, picked, type, lastModified }));
    try { await store.saveMany("merger-decks", snapshots); }
    catch { if (version === revision) status("Your decks are loaded, but browser storage could not remember them.", true); }
  }

  function restorePicker() {
    store.restorePicker($("merger-files"), decks.filter((deck) => deck.picked));
    const picked = decks.filter((deck) => deck.picked).length;
    $("merger-file-hint").textContent = picked ? `${picked} file(s) loaded · Saved copies are remembered · Re-select files to load changes from disk` : "Text, Arena, or CSV · Add more files anytime · Last lists remembered in this browser";
  }

  function renderInputs() {
    const fragment = document.createDocumentFragment();
    decks.forEach((deck, index) => {
      const section = document.createElement("section");
      section.className = "panel input-panel merger-deck";
      const heading = document.createElement("div");
      heading.className = "section-heading";
      const label = document.createElement("label");
      label.htmlFor = `merger-deck-${deck.id}`;
      label.className = "merger-deck-title";
      label.textContent = `Deck ${index + 1}${deck.name ? ` · ${deck.name}` : ""}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button inventory-use";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove deck ${index + 1}`);
      remove.addEventListener("click", () => {
        decks = decks.filter((item) => item.id !== deck.id);
        invalidate(); renderInputs(); restorePicker(); void remember();
        status("Deck removed. Merge again to update your list.");
        $("merger-add").focus();
      });
      heading.append(label, remove);
      const textarea = document.createElement("textarea");
      textarea.id = label.htmlFor;
      textarea.spellcheck = false;
      textarea.placeholder = "Deck\n4 Negate\n20 Island\n\nSideboard\n2 Disdainful Stroke";
      textarea.value = deck.text;
      textarea.addEventListener("input", () => {
        deck.text = textarea.value;
        invalidate();
        status("Deck edited. Merge again to update your list.");
        clearTimeout(saveTimer);
        saveTimer = setTimeout(remember, 250);
      });
      section.append(heading, textarea);
      fragment.append(section);
    });
    $("merger-inputs").replaceChildren(fragment);
  }

  $("merger-files").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    if (!files.length || busy) return;
    const existing = decks.filter((deck) => deck.text.trim());
    // Replace prior selections by name, but retain same-named files within a batch.
    const slots = new Map();
    existing.forEach((deck, index) => {
      if (!deck.picked) return;
      if (!slots.has(deck.name)) slots.set(deck.name, []);
      slots.get(deck.name).push(index);
    });
    const planned = files.map((file) => ({ file, index: slots.get(file.name)?.shift() ?? -1 }));
    if (existing.length + planned.filter((item) => item.index < 0).length > MAX_DECKS) {
      status(`Please merge at most ${MAX_DECKS} decks at a time.`, true); restorePicker(); return;
    }
    setBusy(true);
    invalidate();
    status("Reading your deck lists locally…");
    const results = await Promise.allSettled(planned.map(async ({ file, index }) => {
      if (file.size > MAX_BYTES) throw new Error(`${file.name}: choose a file smaller than 20 MB.`);
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error(`${file.name}: could not read UTF-8 text.`); }
      if (text.includes("\0")) throw new Error(`${file.name}: choose a text or CSV deck list.`);
      return { deck: fresh(text, file.name, true, file), index };
    }));
    decks = existing;
    const failures = [];
    for (const result of results) {
      if (result.status === "rejected") { failures.push(result.reason.message); continue; }
      const { deck, index } = result.value;
      if (index < 0) decks.push(deck);
      else decks[index] = deck;
    }
    renderInputs(); restorePicker(); setBusy(false);
    status(failures.length ? failures.join(" ") : `Loaded ${files.length} file(s). Review your decks, then merge them.`, failures.length > 0);
    await remember();
  });

  $("merger-add").addEventListener("click", () => {
    if (decks.length >= MAX_DECKS) { status(`Please merge at most ${MAX_DECKS} decks at a time.`, true); return; }
    decks.push(fresh());
    invalidate(); renderInputs(); void remember();
    $("merger-inputs").querySelector("section:last-child textarea").focus();
    status("Paste the next deck in its own input, then merge your decks.");
  });

  $("merger-example").addEventListener("click", () => {
    decks = [fresh("Deck\n4 Llanowar Elves\n2 Negate\n20 Forest\n\nSideboard\n1 Negate", "Example A"), fresh("Deck\n2 Llanowar Elves\n4 Negate\n20 Island\n\nSideboard\n2 Disdainful Stroke", "Example B")];
    invalidate(); renderInputs(); restorePicker(); void remember();
    status("Two examples loaded. Merge to keep the highest quantity of each card.");
  });

  $("merger-merge").addEventListener("click", () => {
    invalidate();
    try {
      if (decks.length < 2) throw new Error("Add at least two decks to merge.");
      const parsed = decks.map((deck, index) => {
        const label = `Deck ${index + 1}${deck.name ? ` (${deck.name})` : ""}`;
        if (new TextEncoder().encode(deck.text).length > MAX_BYTES) throw new Error(`${label}: use a list smaller than 20 MB.`);
        const format = /\.csv$/i.test(deck.name) ? "csv" : /\.tsv$/i.test(deck.name) ? "tsv" : "auto";
        const cards = parseList(deck.text, label, format);
        if (!cards.length) throw new Error(`${label}: no cards found. Add cards or remove this empty deck.`);
        return cards;
      });
      const result = merge(parsed);
      $("merger-output").value = result.text;
      $("merger-stats").replaceChildren();
      for (const [value, caption] of [[decks.length, "Decks merged"], [result.rows.length, "Different cards"], [result.total, "Copies needed"], [result.separateTotal - result.total, "Copies shared across decks"]]) {
        const stat = document.createElement("div");
        stat.className = "stat";
        const count = document.createElement("strong");
        count.textContent = value;
        const label = document.createElement("span");
        label.textContent = caption;
        stat.append(count, label);
        $("merger-stats").append(stat);
      }
      const tr = document.createElement("tr");
      for (const title of ["Card", ...decks.map((deck, index) => `Deck ${index + 1}${deck.name ? ` · ${deck.name}` : ""}`), "Merged max"] ) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = title;
        tr.append(th);
      }
      $("merger-table-head").replaceChildren(tr);
      const body = document.createDocumentFragment();
      for (const card of result.rows) {
        const row = document.createElement("tr");
        for (const value of [card.name, ...card.quantities, card.quantity]) {
          const td = document.createElement("td");
          td.textContent = value;
          row.append(td);
        }
        body.append(row);
      }
      $("merger-rows").replaceChildren(body);
      $("merger-results").hidden = false;
      for (const id of ["merger-copy", "merger-download", "merger-inventory"]) $(id).disabled = false;
      status(`Merged ${decks.length} decks: ${result.total} copies across ${result.rows.length} different cards. Ready to build any one of your decks.`);
      void remember();
    } catch (error) { status(error.message, true); }
  });

  $("merger-copy").addEventListener("click", async () => {
    const output = $("merger-output");
    const text = output.value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (output.value === text) status("Merged deck list copied to clipboard.");
    } catch {
      output.focus(); output.select();
      status("The merged list is selected. Press Ctrl+C (or ⌘C on Mac) to copy it.");
    }
  });

  $("merger-download").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([$("merger-output").value + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "merged-decklist.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("merger-inventory").addEventListener("click", () => {
    $("inventory-deck-text").value = $("merger-output").value;
    $("inventory-deck-text").dispatchEvent(new Event("input", { bubbles: true }));
    $("inventory-tab").click();
    $("inventory-compare").focus();
  });

  setBusy(true);
  store.loadMany("merger-decks").then((saved) => {
    decks = saved.slice(0, MAX_DECKS).map((file) => fresh(file.text, file.name, file.picked === true, file));
    if (!decks.length) decks = [fresh(), fresh()];
    else status("Restored your saved decks. Review the lists, then merge them.");
    renderInputs(); restorePicker();
  }).finally(() => setBusy(false));
})();
