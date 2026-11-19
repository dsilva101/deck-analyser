"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const { parseDiffList, diff } = window.DeckInventory;
  const MAX_BYTES = 20 * 1024 * 1024;

  function status(text, error = false) {
    $("diff-status").textContent = text;
    $("diff-status").classList.toggle("error", error);
  }

  function invalidate() {
    $("diff-results").hidden = true;
    $("diff-left-output").value = "";
    $("diff-right-output").value = "";
  }

  $("diff-compare").addEventListener("click", () => {
    invalidate();
    try {
      const leftText = $("diff-left-text").value;
      const rightText = $("diff-right-text").value;
      if (new TextEncoder().encode(leftText).length > MAX_BYTES || new TextEncoder().encode(rightText).length > MAX_BYTES) {
        throw new Error("Please use lists smaller than 20 MB each.");
      }
      const left = parseDiffList(leftText, "Left deck");
      const right = parseDiffList(rightText, "Right deck");
      if (!left.length) { $("diff-left-text").focus(); throw new Error("No cards found in the left deck. Paste a deck list first."); }
      if (!right.length) { $("diff-right-text").focus(); throw new Error("No cards found in the right deck. Paste a deck list first."); }
      const result = diff(left, right);
      $("diff-left-output").value = result.leftText;
      $("diff-right-output").value = result.rightText;
      $("diff-left-count").textContent = result.leftOnly.length;
      $("diff-right-count").textContent = result.rightOnly.length;
      $("diff-results").hidden = false;
      status(`Found ${result.leftOnly.length} card name(s) only on the left and ${result.rightOnly.length} only on the right.`);
    } catch (error) { status(error.message, true); }
  });

  for (const id of ["diff-left-text", "diff-right-text"]) {
    $(id).addEventListener("input", () => {
      if (!$("diff-results").hidden) {
        invalidate();
        status("Lists updated. Compare decks again to refresh the differences.");
      }
    });
  }
})();
