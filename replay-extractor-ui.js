"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
  const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
  let replay = null;

  function status(message, error = false) {
    $("replay-extractor-status").textContent = message;
    $("replay-extractor-status").classList.toggle("error", error);
  }

  function outputName(fileName) {
    return /\.esreplay$/i.test(fileName)
      ? fileName.replace(/\.esreplay$/i, ".jsonl")
      : `${fileName}.jsonl`;
  }

  function setBusy(busy) {
    $("replay-extractor-file").disabled = busy;
    $("replay-extractor-download").disabled = busy;
    $("replay-extractor-panel").setAttribute("aria-busy", String(busy));
    $("replay-extractor-download").firstChild.textContent = busy ? "Extracting… " : "Extract JSONL ";
  }

  async function decompress(file) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot decompress gzip files. Use a current Chrome, Edge, Firefox, or Safari browser.");
    }
    const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
    const bytes = await new Response(stream).arrayBuffer();
    if (bytes.byteLength > MAX_EXTRACTED_BYTES) {
      throw new Error("The extracted replay is larger than 100 MB.");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function validateJsonl(text) {
    let records = 0;
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) {
        if (index === lines.length - 1) continue;
        throw new Error(`The extracted file has a blank record on line ${index + 1}.`);
      }
      try { JSON.parse(line); }
      catch { throw new Error(`The extracted file is not valid JSONL (line ${index + 1}).`); }
      records++;
    }
    if (!records) throw new Error("The extracted replay contains no JSON records.");
    return records;
  }

  function renderStats(file, text, records) {
    $("replay-extractor-stats").replaceChildren();
    for (const [value, label] of [
      [records.toLocaleString(), "JSONL records"],
      [`${(file.size / 1024).toFixed(1)} KB`, "Compressed replay"],
      [`${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`, "Extracted JSONL"],
    ]) {
      const stat = document.createElement("div"); stat.className = "stat";
      const number = document.createElement("strong"); number.textContent = value;
      const caption = document.createElement("span"); caption.textContent = label;
      stat.append(number, caption); $("replay-extractor-stats").append(stat);
    }
    $("replay-extractor-results").hidden = false;
  }

  $("replay-extractor-file").addEventListener("change", (event) => {
    replay = event.target.files[0] || null;
    $("replay-extractor-results").hidden = true;
    if (!replay) { status("Choose an .esreplay file to extract it."); return; }
    if (replay.size > MAX_COMPRESSED_BYTES) {
      replay = null;
      status("Please choose a replay smaller than 25 MB.", true);
      return;
    }
    $("replay-extractor-file-hint").textContent = `${event.target.files[0].name} selected · Extracted locally when you download`;
    status("Replay selected. Extract JSONL when you are ready.");
  });

  $("replay-extractor-download").addEventListener("click", async () => {
    if (!replay) { status("Choose an .esreplay file first.", true); return; }
    setBusy(true);
    try {
      const text = await decompress(replay);
      const records = validateJsonl(text);
      const url = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = outputName(replay.name); link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      renderStats(replay, text, records);
      status(`Extracted ${records.toLocaleString()} JSONL records. Your download is ready.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not extract that replay.";
      const gzipFailure = message === "Failed to fetch" || /gzip|header|compression/i.test(message);
      status(gzipFailure ? "This is not a readable gzip-compressed .esreplay file." : message, true);
    } finally { setBusy(false); }
  });
})();
