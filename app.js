"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.8/full/";
  const CACHE_KEY = "deck-analyser:rotation:v1";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const MAX_FILE_SIZE = 2 * 1024 * 1024;
  let runtimePromise;
  let controller;
  let rows = [];
  let filter = "all";
  let cache = {};
  let reportDate = "";
  const today = new Date();
  $("as-of").value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) cache = saved;
  } catch { /* File URLs or private browsing can deny storage; analysis still works. */ }

  function setStatus(message, error = false) {
    $("status").textContent = message;
    $("status").classList.toggle("error", error);
  }

  function saveCache() {
    const cutoff = Date.now() - CACHE_TTL;
    for (const [key, entry] of Object.entries(cache)) {
      if (!entry || entry.at < cutoff) delete cache[key];
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* Optional. */ }
  }

  function getRuntime() {
    if (!runtimePromise) {
      runtimePromise = (async () => {
        if (typeof window.loadPyodide !== "function") {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = PYODIDE_URL + "pyodide.js";
            script.onload = resolve;
            script.onerror = () => {
              script.remove();
              reject(new Error("Could not load Python. Check your internet connection and access to cdn.jsdelivr.net, then try again."));
            };
            document.head.append(script);
          });
        }
        const py = await window.loadPyodide({ indexURL: PYODIDE_URL });
        // A separate namespace prevents the script's CLI entry point from running.
        py.runPython("rotation_scope = {'__name__': 'deck_rotation', '__file__': '/deck_rotation.py'}");
        if (typeof window.DECK_ROTATION_SOURCE !== "string") {
          throw new Error("Missing python-source.js. Keep all project files together or run python3 build.py.");
        }
        py.globals.set("rotation_source", window.DECK_ROTATION_SOURCE);
        py.runPython("exec(rotation_source, rotation_scope)");
        return py;
      })().catch((error) => {
        runtimePromise = undefined;
        throw error;
      });
    }
    return runtimePromise;
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      function abort() {
        clearTimeout(timer);
        reject(new DOMException("Stopped", "AbortError"));
      }
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  async function fetchJSON(url, signal) {
    // Only Scryfall's API is used, including pagination links from its responses.
    const parsed = new URL(url);
    if (parsed.origin !== "https://api.scryfall.com") throw new Error("Unexpected card data URL.");
    for (let attempt = 0; attempt < 4; attempt++) {
      await delay(120, signal);
      const timeout = new AbortController();
      const abort = () => timeout.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 30000);
      let response;
      let body;
      try {
        response = await fetch(url, { headers: { Accept: "application/json" }, signal: timeout.signal });
        body = await response.text();
      } catch (error) {
        signal.throwIfAborted();
        if (error.name === "AbortError") throw new Error("Scryfall timed out. Try again.");
        throw new Error("Could not reach Scryfall. Check your connection and try again.");
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
      signal.throwIfAborted();
      if (response.ok) return body;
      if (response.status === 404) throw new Error("Card not found. Check its spelling.");
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        const retry = response.headers.get("Retry-After");
        const seconds = retry !== null && /^\d+$/.test(retry) ? Number(retry) : 2 ** (attempt + 1);
        setStatus(`Scryfall is busy. Retrying in ${seconds} seconds…`);
        await delay(seconds * 1000, signal);
      } else {
        throw new Error(`Scryfall returned HTTP ${response.status}. Try again later.`);
      }
    }
  }

  function category(row) {
    return row.status === "Yes" ? "good" : row.status === "Unknown" ? "unknown" : "bad";
  }

  function render() {
    const counts = { total: 0, good: 0, bad: 0, unknown: 0 };
    for (const row of rows) {
      counts.total += row.quantity;
      counts[category(row)] += row.quantity;
    }
    $("stats").replaceChildren();
    for (const [key, label] of [["total", "Copies checked"], ["good", "Stay legal"], ["bad", "Rotate / not legal"], ["unknown", "Unknown"]]) {
      const item = document.createElement("div");
      item.className = "stat " + key;
      const value = document.createElement("strong");
      value.textContent = counts[key];
      const caption = document.createElement("span");
      caption.textContent = label;
      item.append(value, caption);
      $("stats").append(item);
    }
    const needle = $("search").value.trim().toLocaleLowerCase();
    const visible = rows.filter((row) =>
      (filter === "all" || (filter === "stays" ? category(row) === "good" : category(row) !== "good")) &&
      row.name.toLocaleLowerCase().includes(needle));
    const fragment = document.createDocumentFragment();
    const labels = { Yes: "Stays legal", "No (rotates out)": "Rotates out", "No (banned)": "Banned", "No (not Standard legal)": "Not Standard legal", Unknown: "Unknown" };
    for (const row of visible) {
      const tr = document.createElement("tr");
      for (const value of [row.name, row.section === "Side" ? "Sideboard" : "Main", row.quantity, row.edition, row.released]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      if (row.error) {
        const detail = document.createElement("div");
        detail.className = "row-error";
        detail.textContent = row.error;
        tr.firstChild.append(detail);
      }
      const cell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "badge " + category(row);
      badge.textContent = labels[row.status] || row.status;
      cell.append(badge);
      tr.append(cell);
      fragment.append(tr);
    }
    $("result-rows").replaceChildren(fragment);
    $("table-empty").hidden = visible.length !== 0;
    $("export").disabled = rows.length === 0;
  }

  function setBusy(busy) {
    for (const id of ["analyze", "deck-file", "deck-text", "as-of", "refresh", "sample"]) $(id).disabled = busy;
    $("analyze").firstChild.textContent = busy ? "Checking your deck… " : "Check rotation ";
    $("cancel").hidden = !busy;
    $("progress-area").hidden = !busy;
    $("rotation-panel").setAttribute("aria-busy", String(busy));
  }

  async function analyze() {
    if (controller) return;
    const text = $("deck-text").value;
    if (!text.trim()) { setStatus("Choose a deck list file or paste your cards first.", true); $("deck-text").focus(); return; }
    if (!$("as-of").reportValidity()) return;
    if (new TextEncoder().encode(text).length > MAX_FILE_SIZE) { setStatus("Please use a deck list smaller than 2 MB.", true); return; }
    const asOf = $("as-of").value;
    const refresh = $("refresh").checked;
    controller = new AbortController();
    const signal = controller.signal;
    let lookupError = "";
    let py;
    setBusy(true);
    $("progress").removeAttribute("value");
    setStatus("Loading Python in your browser… The first run can take a moment.");
    try {
      py = await getRuntime();
      signal.throwIfAborted();
      py.globals.set("deck_text", text);
      const cards = JSON.parse(py.runPython("__import__('json').dumps(rotation_scope['parse_deck'](deck_text))"));
      if (!cards.length) throw new Error("No cards found. Add card names with optional quantities.");
      if (cards.some(([, quantity]) => quantity < 1 || quantity > 10000)) throw new Error("Each card quantity must be between 1 and 10,000.");
      if (cards.length > 1000) throw new Error("Please check at most 1,000 different deck entries at a time.");
      rows = [];
      reportDate = asOf;
      filter = "all";
      $("search").value = "";
      updateFilters();
      $("results").hidden = false;
      $("report-meta").textContent = `January 2027 preset · Printings through ${asOf} · Analysis in progress`;
      $("progress").max = cards.length;
      $("progress").value = 0;
      render();
      const inRun = new Map();
      py.globals.set("browser_fetch_json", async (url) => {
        try { return await fetchJSON(url, signal); }
        catch (error) { lookupError = error.message; throw error; }
      });
      py.globals.set("as_of_date", asOf);
      for (let index = 0; index < cards.length; index++) {
        signal.throwIfAborted();
        const [section, quantity, name] = cards[index];
        setStatus(`Checking ${index + 1} of ${cards.length}: ${name}`);
        // Match Python's Unicode casefold for the cache and sideboard duplicates.
        py.globals.set("card_name", name);
        const normalized = py.runPython("card_name.casefold()");
        const key = asOf + "\n" + normalized;
        let result = inRun.get(normalized);
        if (!result) {
          const saved = cache[key];
          if (!refresh && saved && Number.isFinite(saved.at) && Date.now() - saved.at < CACHE_TTL &&
              Array.isArray(saved.result) && saved.result.length === 4 && saved.result.every((part) => typeof part === "string")) {
            result = { value: saved.result };
          } else {
            lookupError = "";
            try {
              const value = JSON.parse(await py.runPythonAsync("__import__('json').dumps(await rotation_scope['check_card_browser'](card_name, as_of_date, browser_fetch_json))"));
              signal.throwIfAborted();
              result = { value };
              cache[key] = { at: Date.now(), result: value };
              saveCache();
            } catch (error) {
              signal.throwIfAborted();
              result = { value: [name, "Lookup failed", "—", "Unknown"], error: lookupError || "Could not process card data. Refresh and try again." };
              console.warn(`Lookup failed for ${name}`, error);
            }
          }
          inRun.set(normalized, result);
        }
        const [canonicalName, edition, released, status] = result.value;
        rows.push({ section, quantity, name: canonicalName, edition, released, status, error: result.error || "" });
        $("progress").value = index + 1;
        render();
        await delay(0, signal);
      }
      const unknown = rows.filter((row) => row.status === "Unknown").length;
      setStatus(unknown ? `Checked ${cards.length} entries. ${unknown} lookup(s) failed; see Unknown rows and retry.` : `Done. Checked ${cards.length} deck entries. Your report is ready.`, unknown > 0);
      $("report-meta").textContent = `January 2027 preset · Printings through ${asOf} · ${unknown ? "Completed with lookup errors" : "Complete"}`;
    } catch (error) {
      if (signal.aborted) {
        setStatus(`Stopped. ${rows.length} completed entries are available in the report.`);
        if (!$("results").hidden) $("report-meta").textContent = `January 2027 preset · Printings through ${reportDate} · Stopped — partial results`;
      } else {
        setStatus(error.message || "Unable to check this deck. Please try again.", true);
        console.error(error);
      }
    } finally {
      if (py) {
        for (const name of ["deck_text", "card_name", "browser_fetch_json", "as_of_date"]) py.globals.delete(name);
      }
      controller = undefined;
      setBusy(false);
    }
  }

  let fileReadSequence = 0;
  window.DeckFiles.load("rotation-deck").then((saved) => {
    if (!saved || fileReadSequence || $("deck-text").value || controller) return;
    $("deck-text").value = saved.text;
    $("file-label").textContent = saved.name;
    $("file-hint").textContent = "Restored saved copy · re-select to load changes from disk";
    window.DeckFiles.restorePicker($("deck-file"), saved);
    setStatus(`Restored ${saved.name}. Click Check rotation to analyze it.`);
  });

  async function readFile(file) {
    if (!file || controller) return;
    const sequence = ++fileReadSequence;
    if (file.size > MAX_FILE_SIZE) { setStatus("Please choose a text deck list smaller than 2 MB.", true); return; }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (sequence !== fileReadSequence || controller) return;
      if (text.includes("\0")) throw new Error("This looks like a binary file. Choose a UTF-8 text deck list.");
      $("deck-text").value = text;
      $("file-label").textContent = file.name;
      $("file-hint").textContent = "Loaded locally · choose another file to replace";
      window.DeckFiles.restorePicker($("deck-file"), { name: file.name, text, type: file.type, lastModified: file.lastModified });
      setStatus(`Loaded ${file.name}. Click Check rotation to analyze it.`);
      try { await window.DeckFiles.save("rotation-deck", file, text); }
      catch {
        if (sequence === fileReadSequence) setStatus(`Loaded ${file.name}, but browser storage could not remember it.`, true);
      }
    } catch (error) {
      setStatus(error instanceof TypeError ? "Cannot read this as UTF-8 text. Export your deck as a text file." : error.message, true);
    }
  }

  function updateFilters() {
    document.querySelectorAll("[data-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.filter === filter)));
  }
  $("analyze").addEventListener("click", analyze);
  $("cancel").addEventListener("click", () => { controller?.abort(); setStatus("Stopping… Completed entries will remain available."); });
  $("deck-file").addEventListener("change", (event) => { void readFile(event.target.files[0]); });
  $("deck-text").addEventListener("input", () => { fileReadSequence++; $("file-label").textContent = "Choose a deck list"; $("file-hint").textContent = "or drop a text file here"; });
  $("dropzone").addEventListener("dragover", (event) => { event.preventDefault(); if (!controller) $("dropzone").classList.add("dragover"); });
  $("dropzone").addEventListener("dragleave", () => $("dropzone").classList.remove("dragover"));
  $("dropzone").addEventListener("drop", (event) => { event.preventDefault(); $("dropzone").classList.remove("dragover"); void readFile(event.dataTransfer.files[0]); });
  $("sample").addEventListener("click", () => {
    fileReadSequence++;
    $("deck-text").value = "Deck\n4 Llanowar Elves (FDN) 227\n4 Lightning Strike\n16 Forest\n\nSideboard\n2 Negate\n";
    $("file-label").textContent = "Example deck loaded";
    $("file-hint").textContent = "Choose a file to replace the example";
    setStatus("Example loaded. Click Check rotation to look up these cards.");
  });
  $("search").addEventListener("input", render);
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { filter = button.dataset.filter; updateFilters(); render(); }));
  $("export").addEventListener("click", () => {
    const csvCell = (value) => {
      let text = String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const data = [["Deck", "Qty", "Card", "Latest paper edition", "Released", "Post rotation", "Error", "Printings through", "Rotation preset"],
      ...rows.map((row) => [row.section, row.quantity, row.name, row.edition, row.released, row.status, row.error, reportDate, "January 2027"])];
    const url = URL.createObjectURL(new Blob(["\ufeff" + data.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rotation-report-${reportDate}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function activateTab(active) {
    for (const tab of tabs) {
      const selected = tab === active;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(tab.getAttribute("aria-controls")).hidden = !selected;
    }
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      activateTab(tabs[next]);
      tabs[next].focus();
    });
  }
})();
