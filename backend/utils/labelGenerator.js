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


// ✅ NEW — ONE single-page label per PO Number covering ALL of that PO's boxes.
// Box numbering is continuous across POs (PO1: 1..n1, PO2: n1+1..n1+n2) and
// "OF" is the sum of all boxes. The Box line prints that PO's range:
//   1 box  → "3 OF 5"      2+ boxes → "1-2 OF 5", "3-5 OF 5"
// Same template / values / validation as every other label (buildLabelValues).
function generateMergedLabelDocxForPo(shipmentDoc, poNumber, templateFile = LABEL_TEMPLATE_FILE, qtyOverride, poSlot) {
  const counts = (poSlot && Array.isArray(poSlot.boxCounts) ? poSlot.boxCounts : []).map(Number);
  const index = Number(poSlot && poSlot.index) || 0;
  if (!counts.length || index < 0 || index >= counts.length || !counts.every((n) => Number.isInteger(n) && n >= 1)) {
    const err = new Error(`PO ${poNumber}: No. of Boxes must be a positive whole number.`);
    err.code = "MISSING_REQUIRED_FIELDS";
    err.details = [err.message];
    throw err;
  }
  const totalBoxes = counts.reduce((sum, n) => sum + n, 0);
  const firstBox = 1 + counts.slice(0, index).reduce((sum, n) => sum + n, 0);
  const lastBox = firstBox + counts[index] - 1;
  const boxLabel = firstBox === lastBox ? String(firstBox) : `${firstBox}-${lastBox}`;
  const safePo = String(poNumber).replace(/[^a-zA-Z0-9_-]/g, "");
  return {
    filename: `Label_${safePo}.docx`,
    buffer: generateLabelDocxBuffer(shipmentDoc, poNumber, boxLabel, totalBoxes, templateFile, qtyOverride),
  };
}

// ✅ NEW — ONE .docx with exactly ONE page per PO Number (PO count = page
// count). Each page is the normal single-page label from
// generateMergedLabelDocxForPo; they are stitched together with a page break
// in place of each page's trailing empty paragraph. Returns a docx Buffer.
function generateCombinedLabelDocx(shipmentDoc, poNumbers, templateFile = LABEL_TEMPLATE_FILE, quantities = [], boxCounts = []) {
  const pages = poNumbers.map((po, i) =>
    generateMergedLabelDocxForPo(shipmentDoc, po, templateFile, quantities[i], { index: i, count: poNumbers.length, boxCounts }).buffer
  );
  if (pages.length === 1) return pages[0];

  const PAGE_BREAK_P = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const bodyInner = (xml) => xml.slice(xml.indexOf("<w:body>") + 8, xml.lastIndexOf("<w:sectPr"));
  const withBreak = (inner) => {
    const m = inner.match(/<w:p\b[^>]*\/>\s*$/);
    return m ? inner.slice(0, m.index) + PAGE_BREAK_P : inner + PAGE_BREAK_P;
  };
  const baseZip = new AdmZip(pages[0]);
  const baseXml = baseZip.readAsText("word/document.xml", "utf8");
  const units = pages.map((b) => bodyInner(new AdmZip(b).readAsText("word/document.xml", "utf8")));
  const merged = units.map((u, i) => (i < units.length - 1 ? withBreak(u) : u)).join("");
  const outXml = baseXml.slice(0, baseXml.indexOf("<w:body>") + 8) + merged + baseXml.slice(baseXml.lastIndexOf("<w:sectPr"));
  baseZip.updateFile("word/document.xml", Buffer.from(outXml, "utf8"));
  return baseZip.toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────
// ✅ NEW — ONE PO = ONE PAGE.
//   Builds ONE .docx whose pages are the PO rows: page N = PO N, with every
//   box of that PO listed inside that same page. The existing label design
//   (Label.docx / TechnologyLabel.docx) is reused as-is; only the two
//   box-detail paragraphs ("No. Of Box" + "Gross Weight") are repeated once
//   per box. Number of pages = number of PO rows, never number of boxes.
//   Existing generateLabelDocxBuffer / generateLabelDocxBuffersForPo above
//   are untouched and still used when no per-PO box counts are supplied.
// ─────────────────────────────────────────────────────────────────────────
const MAX_BOXES_PER_PO_PAGE = 20; // the most box lines that stay readable on one label page

function stripParaIds(xml) {
  return xml.replace(/\sw14:(paraId|textId)="[^"]*"/g, "");
}

function boxLinePara(label, value, sz, after) {
  const rpr = (bold) => `<w:rPr>${bold ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return (
    `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2600"/></w:tabs><w:spacing w:after="${after}"/></w:pPr>` +
    `<w:r>${rpr(true)}<w:t>${escapeXmlText(label)}</w:t></w:r>` +
    `<w:r>${rpr(true)}<w:tab/><w:t xml:space="preserve">: </w:t></w:r>` +
    `<w:r>${rpr(false)}<w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p>`
  );
}

function compactBoxPara(boldText, text, sz) {
  const rpr = (bold) => `<w:rPr>${bold ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return (
    `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>` +
    `<w:r>${rpr(true)}<w:t xml:space="preserve">${escapeXmlText(boldText)}</w:t></w:r>` +
    `<w:r>${rpr(false)}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`
  );
}

// Splits `total` into `n` parts. Whole-number totals split into whole
// numbers (first boxes take the remainder, 10/3 → 4,3,3); anything else is
// split to 2 decimals with the rounding remainder on the last box. Parts
// always add back up to `total` exactly.
function splitIntoBoxes(total, n) {
  const t = Number(total) || 0;
  if (Number.isInteger(t)) {
    const base = Math.floor(t / n);
    const rem = t - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
  }
  const base = round2(t / n);
  const arr = new Array(n).fill(base);
  arr[n - 1] = round2(arr[n - 1] + (t - base * n));
  return arr;
}

// Gross weight shared out across the boxes in proportion to each box's qty.
function weightsForBoxes(boxQtys, totalWeight) {
  const sumQty = boxQtys.reduce((s, q) => s + q, 0);
  const w = boxQtys.map((q) => (sumQty > 0 ? round2((totalWeight * q) / sumQty) : round2(totalWeight / boxQtys.length)));
  const diff = round2(totalWeight - w.reduce((s, x) => s + x, 0));
  if (diff !== 0) w[w.length - 1] = round2(w[w.length - 1] + diff);
  return w;
}

// Box-detail paragraphs for one PO page.
function buildBoxDetailXml(boxes, singleBoxXml) {
  const n = boxes.length;
  const fmtGross = (kg) => `${kg.toFixed(2)} Kg / ${round2(kg * KG_TO_LBS).toFixed(2)} Lbs`;
  if (n === 1) return singleBoxXml(boxes[0]); // identical to the existing label
  if (n <= 3) {
    return boxes.map((b) => {
      let out = boxLinePara("No. Of Box", `${b.no} OF ${n}`, 21, 0);
      out += boxLinePara("Box Qty", `${b.qty} pcs`, 21, 0);
      out += boxLinePara("Gross Weight (Approx)", fmtGross(b.grossKg), 21, b.dimensions ? 0 : 120);
      if (b.dimensions) out += boxLinePara("Dimensions", b.dimensions, 21, 120);
      return out;
    }).join("");
  }
  const sz = n <= 8 ? 18 : n <= 14 ? 16 : 14;
  return boxes.map((b) => {
    const rest = ` | Qty ${b.qty} pcs | GW ${fmtGross(b.grossKg)}${b.dimensions ? ` | ${b.dimensions}` : ""}`;
    return compactBoxPara(`Box ${b.no} OF ${n}`, rest, sz);
  }).join("");
}

// entries: [{ poNumber, qty, boxes }] — qty = PO quantity, boxes = box count.
function generateCombinedLabelDocxBuffer(shipmentDoc, entries, templateFile = LABEL_TEMPLATE_FILE) {
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
  const xml = healSplitPlaceholderRuns(zip.readAsText(entry, "utf8"));

  const bodyIdx = xml.indexOf("<w:body>") + "<w:body>".length;
  const tblStart = xml.indexOf("<w:tbl>");
  const tblEnd = xml.lastIndexOf("</w:tbl>") + "</w:tbl>".length;
  if (bodyIdx < "<w:body>".length || tblStart < 0 || tblEnd < tblStart) {
    const err = new Error("Label template structure not recognised");
    err.code = "TEMPLATE_CORRUPT";
    throw err;
  }
  const head = xml.slice(0, bodyIdx);
  const tblTemplate = xml.slice(tblStart, tblEnd);
  const tail = xml.slice(tblEnd); // trailing paragraph + sectPr + closing tags

  // The two paragraphs holding {{BOX_INFO}} and the gross-weight tokens.
  const paraRe = /<w:p[ >](?:(?!<\/w:p>)[\s\S])*<\/w:p>/g;
  let boxStart = -1, boxEnd = -1, m;
  while ((m = paraRe.exec(tblTemplate)) !== null) {
    if (m[0].includes("{{BOX_INFO}}")) boxStart = m.index;
    if (m[0].includes("{{GROSS_WEIGHT_LBS}}")) boxEnd = m.index + m[0].length;
  }
  if (boxStart < 0 || boxEnd < boxStart) {
    const err = new Error("Label template box section not found");
    err.code = "TEMPLATE_CORRUPT";
    throw err;
  }
  const singleBoxTemplate = tblTemplate.slice(boxStart, boxEnd);
  const beforeBox = tblTemplate.slice(0, boxStart);
  const afterBox = tblTemplate.slice(boxEnd);

  const totalQty = Number(shipmentDoc.total_parts_count ?? shipmentDoc.total_qty) || 0;
  const totalGross = Number(shipmentDoc.total_gross_weight ?? shipmentDoc.total_gross_wt) || 0;
  // Existing box dimensions on the shipment (parts[].box_size) — used only if present.
  const dimsPart = Array.isArray(shipmentDoc.parts) ? shipmentDoc.parts.find((p) => p && p.box_size) : null;
  const dimensions = dimsPart ? String(dimsPart.box_size).trim() : "";

  const pageBreak =
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:br w:type="page"/></w:r></w:p>';

  const pages = entries.map(({ poNumber, qty, boxes }) => {
    const { values, missing } = buildLabelValues(shipmentDoc, poNumber, 1, 1, qty);
    if (missing.length > 0) {
      const err = new Error(missing.join(" "));
      err.code = "MISSING_REQUIRED_FIELDS";
      err.details = missing;
      throw err;
    }
    const poQty = Number(qty);
    const boxQtys = splitIntoBoxes(poQty, boxes);
    // PO's share of the shipment's gross weight, then shared across its boxes.
    const poGross = totalQty > 0 ? round2((totalGross * poQty) / totalQty) : totalGross;
    const boxWeights = weightsForBoxes(boxQtys, poGross);
    const boxList = boxQtys.map((q, i) => ({ no: i + 1, qty: q, grossKg: boxWeights[i], dimensions }));

    const singleBoxXml = (b) =>
      singleBoxTemplate
        .split("{{BOX_INFO}}").join(escapeXmlText(`${b.no} OF ${boxes}`))
        .split("{{GROSS_WEIGHT_KG}}").join(b.grossKg.toFixed(2))
        .split("{{GROSS_WEIGHT_LBS}}").join(round2(b.grossKg * KG_TO_LBS).toFixed(2));

    let page = beforeBox + stripParaIds(buildBoxDetailXml(boxList, singleBoxXml)) + afterBox;
    for (const token of ["PO_NUMBER", "INVOICE_NO", "ITEM_DESC", "ITEM_CODE", "QTY"]) {
      page = page.split(`{{${token}}}`).join(values[token]);
    }
    return page;
  });

  const newXml = head + pages.join(pageBreak) + tail;
  zip.updateFile("word/document.xml", Buffer.from(newXml, "utf8"));
  return zip.toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────
// ✅ NEW — ONE LABEL PER BOX, split from the shipment's own totals.
//   Shipment total qty / total gross weight are divided across the shipment's
//   total number of boxes (e.g. 400 pcs, 4 boxes → 100 pcs per box). The
//   user says how many of those boxes belong to each PO (PO1 → 3, PO2 → 1):
//   boxes are handed out in PO order, so PO1 gets boxes 1-3 and PO2 box 4.
//   Output = ONE .docx, one page (label) per box, in that order.
//   Quantity and gross weight on each label are that box's own share.
// ─────────────────────────────────────────────────────────────────────────
function planBoxLabels(shipmentDoc, entries) {
  const errors = [];
  const totalQty = Number(shipmentDoc.total_parts_count ?? shipmentDoc.total_qty) || 0;
  const totalGross = Number(shipmentDoc.total_gross_weight ?? shipmentDoc.total_gross_wt) || 0;
  const shipBoxes = Number(shipmentDoc.total_no_of_boxes) || 0;
  const entered = entries.reduce((sum, e) => sum + e.boxes, 0);
  const totalBoxes = shipBoxes > 0 ? shipBoxes : entered;
  if (entered !== totalBoxes) {
    errors.push(`Total No. of Boxes entered (${entered}) must equal the shipment's total boxes (${totalBoxes}).`);
  }
  if (totalQty <= 0) errors.push("Quantity is not available for this shipment.");
  else if (totalQty < totalBoxes) errors.push(`Shipment quantity (${totalQty}) is less than its number of boxes (${totalBoxes}).`);
  if (errors.length > 0) return { errors, boxes: [] };

  const qtys = splitIntoBoxes(totalQty, totalBoxes);
  const weights = weightsForBoxes(qtys, totalGross);
  const boxes = [];
  let n = 0;
  entries.forEach(({ poNumber, boxes: count }) => {
    for (let i = 0; i < count; i++) {
      boxes.push({ poNumber, boxNo: n + 1, totalBoxes, qty: qtys[n], grossKg: weights[n] });
      n++;
    }
  });
  return { errors, boxes };
}

// entries: [{ poNumber, boxes }] — returns one docx Buffer, one page per box.
function generateBoxLabelsDocxBuffer(shipmentDoc, entries, templateFile = LABEL_TEMPLATE_FILE, splitPages = false) { // ✅ CHANGED — splitPages added
  const { errors, boxes } = planBoxLabels(shipmentDoc, entries);
  if (errors.length > 0) {
    const err = new Error(errors.join(" "));
    err.code = "MISSING_REQUIRED_FIELDS";
    err.details = errors;
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
  const xml = healSplitPlaceholderRuns(zip.readAsText(entry, "utf8"));
  const bodyIdx = xml.indexOf("<w:body>") + "<w:body>".length;
  const tblStart = xml.indexOf("<w:tbl>");
  const tblEnd = xml.lastIndexOf("</w:tbl>") + "</w:tbl>".length;
  if (bodyIdx < "<w:body>".length || tblStart < 0 || tblEnd < tblStart) {
    const err = new Error("Label template structure not recognised");
    err.code = "TEMPLATE_CORRUPT";
    throw err;
  }
  const head = xml.slice(0, bodyIdx);
  const tblTemplate = xml.slice(tblStart, tblEnd);
  const tail = xml.slice(tblEnd);
  const pageBreak =
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:br w:type="page"/></w:r></w:p>';

  const pages = boxes.map((b) => {
    const { values, missing } = buildLabelValues(shipmentDoc, b.poNumber, b.boxNo, b.totalBoxes, String(b.qty));
    if (missing.length > 0) {
      const err = new Error(missing.join(" "));
      err.code = "MISSING_REQUIRED_FIELDS";
      err.details = missing;
      throw err;
    }
    values.BOX_INFO = escapeXmlText(`${b.boxNo} OF ${b.totalBoxes}`);
    values.GROSS_WEIGHT_KG = b.grossKg.toFixed(2);
    values.GROSS_WEIGHT_LBS = round2(b.grossKg * KG_TO_LBS).toFixed(2);
    let page = tblTemplate;
    for (const [token, value] of Object.entries(values)) page = page.split(`{{${token}}}`).join(value);
    return page;
  });
  // ✅ NEW — splitPages: one separate single-page .docx per box, instead of one combined docx.
  if (splitPages) {
    return pages.map((page, i) => {
      const z = new AdmZip(templatePath);
      z.updateFile("word/document.xml", Buffer.from(head + page + tail, "utf8"));
      return { boxNo: boxes[i].boxNo, totalBoxes: boxes[i].totalBoxes, buffer: z.toBuffer() };
    });
  }
  zip.updateFile("word/document.xml", Buffer.from(head + pages.join(pageBreak) + tail, "utf8"));
  return zip.toBuffer();
}

module.exports = {
  MAX_BOXES_PER_PO_PAGE,
  generateCombinedLabelDocxBuffer,
  planBoxLabels, // ✅ NEW
  generateBoxLabelsDocxBuffer, // ✅ NEW
  generateMergedLabelDocxForPo, // ✅ NEW
  generateCombinedLabelDocx, // ✅ NEW
  FIXED_TO_BLOCK,
  buildLabelValues,
  generateLabelDocxBuffer,
  generateLabelDocxBuffersForPo,
};
