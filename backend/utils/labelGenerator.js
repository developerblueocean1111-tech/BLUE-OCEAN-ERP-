const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

// ─────────────────────────────────────────────────────────────────────────
// ✅ NEW — Label Document Generation (Shipment List → "Generate Document" →
//   "Label Document"). Additive-only, isolated from documentGenerator.js —
//   the existing 5 documents and their template/logic are not touched.
//
//   Uses the exact same technique already used for the other 5 documents:
//   the template is a real .docx with {{PLACEHOLDER}} tokens sitting in
//   word/document.xml, filled by a plain text substitution so all original
//   formatting (border box, bold labels, spacing) survives untouched.
// ─────────────────────────────────────────────────────────────────────────

const TEMPLATES_DIR = path.join(__dirname, "..", "document-templates");
const LABEL_TEMPLATE_FILE = "Label.docx";

const KG_TO_LBS = 2.20462;

// Fixed sender/recipient block — hardcoded per spec, never fetched or
// editable. Not written to the Shipment List or database.
const FIXED_TO_BLOCK = {
  company: "FECON LLC",
  line1: "3460 Grant Drive,",
  line2: "Lebanon, Ohio, 45036",
  attn: "Attn: Roman Bunce",
};

function escapeXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Word can silently split a single {{TOKEN}} placeholder across two or
// more separate <w:t> runs (this happened to Label.docx's {{INVOICE_NO}} —
// autocorrect/spellcheck broke it into "{{" / "INVOICE" / "_NO}}" runs). A
// plain-text search for "{{TOKEN}}" then never matches, even though it
// reads as one token on the page, so it prints literally instead of being
// filled in.
//
// This walks every <w:t> in the document and merges any run of them that
// share identical formatting (<w:rPr>) and sit directly next to each other
// (no other run in between) into the first one's <w:t>, deleting the rest.
// Because the merged runs already look identical on the page (same
// formatting), this never changes anything visually — it only heals split
// placeholders so the token substitution below can find them as one
// string. Runs with non-text content (e.g. <w:tab/>) are never deleted,
// only absorbed INTO — they keep their tab, just gain the merged text.
function healSplitPlaceholderRuns(xml) {
  const T_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/; // (?:\s...) so <w:tab/> never matches here
  const runRegex = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  const runs = [];
  let m;
  while ((m = runRegex.exec(xml)) !== null) {
    runs.push({ start: m.index, end: m.index + m[0].length, inner: m[1], full: m[0] });
  }

  function classify(inner) {
    const rPrMatch = inner.match(/^<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[1] : "";
    const rest = rPrMatch ? inner.slice(rPrMatch[0].length) : inner;
    const tMatch = rest.match(T_RE);
    // "Simple" = nothing but rPr + one <w:t> — only these are safe to
    // delete and fold into a preceding run.
    const isSimple = !!tMatch && rest.trim() === tMatch[0].trim();
    return { rPr, hasT: !!tMatch, isSimple, text: tMatch ? tMatch[1] : null };
  }

  const edits = [];
  let i = 0;
  while (i < runs.length) {
    const cur = classify(runs[i].inner);
    if (!cur.hasT) { i++; continue; }

    let j = i + 1;
    let mergedText = cur.text;
    let lastEnd = runs[i].end;
    let absorbedAny = false;
    while (j < runs.length && runs[j].start === lastEnd) {
      const nxt = classify(runs[j].inner);
      if (!nxt.isSimple || nxt.rPr !== cur.rPr) break;
      mergedText += nxt.text;
      lastEnd = runs[j].end;
      absorbedAny = true;
      j++;
    }

    if (absorbedAny) {
      const spliced = runs[i].full.replace(T_RE, (whole) =>
        whole.slice(0, whole.indexOf(">") + 1) + mergedText + "</w:t>"
      );
      edits.push({ start: runs[i].start, end: lastEnd, replacement: spliced });
      i = j;
    } else {
      i++;
    }
  }

  let result = xml;
  for (let k = edits.length - 1; k >= 0; k--) {
    const e = edits[k];
    result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
  }
  return result;
}

// Builds the content for the {{TOKEN}}: value map for ONE box of ONE shipment/PO.
// Returns { values, missing }. `missing` lists required fields that are
// absent on the shipment so the caller can refuse to generate a label with
// blank/invented data (per spec §17) instead of silently continuing.
function buildLabelValues(shipmentDoc, poNumber, boxNumber, totalBoxes, qtyOverride) { // ✅ CHANGED — qtyOverride added
  const missing = [];
  const values = {};

  values.PO_NUMBER = escapeXmlText(poNumber);

  // Reference No.: the Label.docx template's actual placeholder for this
  // field is {{INVOICE_NO}} (not {{REFERENCE_NO}}) — matching it here fixes
  // the field printing literally as "{{INVOICE_NO}}" on the label. Uses the
  // shipment's real Invoice Number, falling back to the PO Number if this
  // shipment has no invoice number yet.
  const referenceNo = shipmentDoc.invoice_no || poNumber;
  values.INVOICE_NO = escapeXmlText(referenceNo);

  // Item Description: shipment-level manual override (manual_desc) takes
  // precedence — same precedent as documentGenerator.js's PART_DESC, which
  // also falls back to the first part's part_desc. Mirrors that exact
  // fallback order so behavior is consistent across all 6 documents.
  const firstPart = Array.isArray(shipmentDoc.parts) && shipmentDoc.parts.length > 0
    ? shipmentDoc.parts[0]
    : null;
  const itemDesc = shipmentDoc.manual_desc || (firstPart && firstPart.part_desc) || "";
  if (!itemDesc) missing.push("Item Description is not available for this shipment.");
  values.ITEM_DESC = escapeXmlText(itemDesc);

  const itemCode = (firstPart && firstPart.part_no) || "";
  values.ITEM_CODE = escapeXmlText(itemCode);

  // Quantity: use the shipment's own computed total (pre-save hook sums
  // parts[].quantity into total_parts_count), same source of truth the
  // Shipment List itself displays — not recalculated here.
  const qty = shipmentDoc.total_parts_count ?? shipmentDoc.total_qty ?? null;
  if (qtyOverride !== undefined && qtyOverride !== null && String(qtyOverride).trim() !== "") {
    // ✅ NEW — user-entered quantity for this PO wins over the shipment total
    values.QTY = escapeXmlText(String(qtyOverride).trim());
  } else if (qty === null || qty === undefined || qty === "") {
    missing.push("Quantity is not available for this shipment.");
    values.QTY = "";
  } else {
    values.QTY = escapeXmlText(qty);
  }

  values.BOX_INFO = escapeXmlText(`${boxNumber} OF ${totalBoxes}`);

  const grossKg = shipmentDoc.total_gross_weight ?? shipmentDoc.total_gross_wt ?? null;
  if (grossKg === null || grossKg === undefined || grossKg === "") {
    missing.push("Gross Weight is not available for this shipment.");
    values.GROSS_WEIGHT_KG = "";
    values.GROSS_WEIGHT_LBS = "";
  } else {
    const kg = Number(grossKg);
    values.GROSS_WEIGHT_KG = kg.toFixed(2);
    values.GROSS_WEIGHT_LBS = round2(kg * KG_TO_LBS).toFixed(2);
  }

  return { values, missing };
}

// Fills a Label template (Label.docx by default) for one box. Returns a
// docx Buffer. templateFile is optional — every existing call site keeps
// using LABEL_TEMPLATE_FILE ("Label.docx") exactly as before; passing a
// different filename (e.g. "TechnologyLabel.docx") is additive.
function generateLabelDocxBuffer(shipmentDoc, poNumber, boxNumber, totalBoxes, templateFile = LABEL_TEMPLATE_FILE, qtyOverride) { // ✅ CHANGED — qtyOverride added
  const { values, missing } = buildLabelValues(shipmentDoc, poNumber, boxNumber, totalBoxes, qtyOverride); // ✅ CHANGED
  if (missing.length > 0) {
    const err = new Error(missing.join(" "));
    err.code = "MISSING_REQUIRED_FIELDS";
    err.details = missing;
    throw err;
  }

  const templatePath = path.join(TEMPLATES_DIR, templateFile);
  if (!fs.existsSync(templatePath)) {
    const err = new Error(`Label template file not found: ${templateFile}`);
    err.code = "TEMPLATE_NOT_FOUND";
    throw err;
  }

  const zip = new AdmZip(templatePath);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) {
    const err = new Error("word/document.xml missing from Label template");
    err.code = "TEMPLATE_CORRUPT";
    throw err;
  }

  let xml = zip.readAsText(entry, "utf8");
  xml = healSplitPlaceholderRuns(xml); // ✅ NEW — repair any Word-split {{TOKEN}}s first
  for (const [token, value] of Object.entries(values)) {
    xml = xml.split(`{{${token}}}`).join(value);
  }

  zip.updateFile("word/document.xml", Buffer.from(xml, "utf8"));
  return zip.toBuffer();
}

// ✅ NEW — when several PO Numbers are labelled together, the shipment's
// physical boxes (1..total) are shared out between them: each PO gets one
// consecutive block of boxes, block sizes differ by at most 1 (extras go to
// the earliest POs), and every box belongs to exactly one PO. Returns the
// first/last box number (and size) for PO #index. (Used only when the
// Packing List's own box counts per PO were not supplied.)
function boxRangeForPo(totalBoxes, index, count) {
  const base = Math.floor(totalBoxes / count);
  const extra = totalBoxes % count;
  const size = base + (index < extra ? 1 : 0);
  const first = index * base + Math.min(index, extra) + 1;
  return { first, last: first + size - 1, size };
}

// One shipment can span multiple boxes (total_number_of_boxes). Per the
//reference label  samples provided, each physical box gets its own label
// ("1 OF 4", "2 OF 4", ...) with identical shipment data and only BOX_INFO
// changing. Returns an array of { filename, buffer } — length 1 when the
// shipment has a single box (or the field isn't set, defaults to 1).
// templateFile is optional, same default/behaviour as above.
//
// ✅ NEW — poSlot is optional: { index, count, boxCounts }.
//   • index / count  = this PO's position among the PO Numbers being labelled.
//   • boxCounts      = boxes per PO exactly as entered in the Packing List
//                      (one number per PO, same order). When given, the
//                      labels use the Packing List's box numbering: PO 1 gets
//                      boxes 1..n1, PO 2 the next n2, … and the "OF" total is
//                      the Packing List's total number of boxes.
//   • without boxCounts and count > 1 → the shipment's boxes are shared out
//     evenly between the POs (boxRangeForPo above).
//   • omitted, or count <= 1 without boxCounts → every box, exactly as before.
function generateLabelDocxBuffersForPo(shipmentDoc, poNumber, templateFile = LABEL_TEMPLATE_FILE, qtyOverride, poSlot) { // ✅ CHANGED — qtyOverride, poSlot added
  let totalBoxes = Math.max(1, Number(shipmentDoc.total_no_of_boxes) || 1);
  const safePo = String(poNumber).replace(/[^a-zA-Z0-9_-]/g, "");

  let firstBox = 1;
  let lastBox = totalBoxes;

  const index = poSlot ? Number(poSlot.index) || 0 : 0;
  const count = poSlot ? Number(poSlot.count) || 0 : 0;
  const counts = poSlot && Array.isArray(poSlot.boxCounts) ? poSlot.boxCounts.map(Number) : null;
  const countsUsable =
    !!counts &&
    counts.length === count &&
    index >= 0 && index < counts.length &&
    counts.every((n) => Number.isInteger(n) && n >= 0) &&
    counts.reduce((s, n) => s + n, 0) >= 1;

  if (countsUsable) {
    // Packing List's own box numbers for this PO.
    totalBoxes = counts.reduce((s, n) => s + n, 0);
    const mine = counts[index];
    if (mine < 1) {
      const err = new Error(`PO ${poNumber} has no boxes in the Packing List.`);
      err.code = "MISSING_REQUIRED_FIELDS";
      err.details = [err.message];
      throw err;
    }
    firstBox = 1 + counts.slice(0, index).reduce((s, n) => s + n, 0);
    lastBox = firstBox + mine - 1;
  } else if (poSlot && count > 1) {
    const range = boxRangeForPo(totalBoxes, index, count);
    if (range.size < 1) {
      // More PO Numbers than boxes: this PO has no physical box of its own.
      // Reported through the same error shape as other missing-data cases so
      // the existing "PO Numbers were skipped" handling shows the reason.
      const err = new Error(
        `Only ${totalBoxes} box${totalBoxes === 1 ? "" : "es"} for ${count} PO Numbers — PO ${poNumber} has no box of its own.`
      );
      err.code = "MISSING_REQUIRED_FIELDS";
      err.details = [err.message];
      throw err;
    }
    firstBox = range.first;
    lastBox = range.last;
  }

  const results = [];
  for (let boxNumber = firstBox; boxNumber <= lastBox; boxNumber++) {
    const buffer = generateLabelDocxBuffer(shipmentDoc, poNumber, boxNumber, totalBoxes, templateFile, qtyOverride); // ✅ CHANGED
    const filename = totalBoxes > 1
      ? `Label_${safePo}_Box${boxNumber}of${totalBoxes}.docx`
      : `Label_${safePo}.docx`;
    results.push({ filename, buffer });
  }
  return results;
}

module.exports = {
  FIXED_TO_BLOCK,
  buildLabelValues,
  generateLabelDocxBuffer,
  generateLabelDocxBuffersForPo,
};
