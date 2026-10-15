const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { findShipmentByPoNumber } = require("./poLookup");
const CustomerAddressBook = require("../models/CustomerAddressBook");

// ─────────────────────────────────────────────────────────────────────────
// ✅ NEW — Packing List generation (Shipment List → "Generate Document" →
//   "Packing List"). Fully isolated from documentGenerator.js and
//   labelGenerator.js — neither is touched or imported here.
//
//   Unlike the other 6 documents, a Packing List has two tables whose row
//   count varies per shipment (one item line per part, one row per
//   pallet) — a plain fixed-template {{TOKEN}} substitution can't do that.
//   So the template (document-templates/PackingList.docx /
//   TechnologyPackingList.docx) has exactly ONE data row in each of those
//   two tables, each already tokenized. At generation time this file finds
//   that single <w:tr>...</w:tr> block (by a token unique to it), clones
//   it once per part / once per pallet with that row's own values
//   substituted in, and splices the clones in. Every other token in the
//   document (company block, customer block, totals, etc.) is a plain
//   single-value substitution exactly like the other 6 documents.
// ─────────────────────────────────────────────────────────────────────────

const TEMPLATES_DIR = path.join(__dirname, "..", "document-templates");
const TEMPLATE_FILES = {
  consulting: "PackingList.docx",
  technologies: "TechnologyPackingList.docx",
};

// Fixed exporter block — same company details already baked into the
// other Consulting/Technologies templates (EVD, SCOMET, etc.), repeated
// here as data because the Packing List's exporter block is plain
// {{TOKEN}} text, not a pre-printed letterhead like those templates.
const EXPORTER_BLOCKS = {
  consulting: {
    name: "Blue Ocean Consulting",
    lines: [
      "One HQ, 3rd Floor, Office No.301, Sr No.44 Part &",
      "45 Part,Baner Balewadi Road, Balewadi, Pune",
      "411045, Maharashtra (State Code - 27), INDIA",
      "TEL: +91 9753210294",
    ],
    signatoryName: "BLUE OCEAN CONSULTING",
  },
  technologies: {
    name: "Blue Ocean Technologies",
    lines: [
      "C-601, 24K Opula, Pimple Nilakh,",
      "Pune – 411027, Maharashtra, INDIA",
      "TEL: +91 9753210294",
      "",
    ],
    signatoryName: "BLUE OCEAN TECHNOLOGIES",
  },
};

const COUNTRY_OF_ORIGIN = "Made In India";

function escapeXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Same technique as labelGenerator.js's healSplitPlaceholderRuns — Word/
// LibreOffice can silently split one {{TOKEN}} across multiple <w:t> runs
// with identical formatting. This merges adjacent "simple" runs (nothing
// but <w:rPr> + one <w:t>) back together before token substitution, with
// no visual change, so a split token is still found as one string.
function healSplitPlaceholderRuns(xml) {
  const T_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/;
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

// Splits `text` on "\n" into multiple <w:t> runs joined by <w:br/>, so a
// multi-line address can be substituted into a single {{TOKEN}} occurrence.
function textToRunXml(text) {
  const parts = String(text ?? "").split("\n").map(escapeXmlText);
  return parts.join('</w:t></w:r><w:r><w:br/><w:t xml:space="preserve">');
}

// Finds the single <w:tr>...</w:tr> block containing `markerToken`, and
// returns { before, rowXml, after } so the caller can replace it with N
// cloned/substituted copies. Throws TEMPLATE_CORRUPT if not found exactly
// once — this is a template-authoring error, never a user-data error.
function extractTemplateRow(xml, markerToken, rowName) {
  const rowRegex = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
  let match;
  const matches = [];
  while ((match = rowRegex.exec(xml)) !== null) {
    if (match[0].includes(markerToken)) matches.push(match);
  }
  if (matches.length !== 1) {
    const err = new Error(
      `Packing List template is missing its ${rowName} row (expected exactly one row containing ${markerToken}, found ${matches.length}).`
    );
    err.code = "TEMPLATE_CORRUPT";
    throw err;
  }
  const m = matches[0];
  return {
    before: xml.slice(0, m.index),
    rowXml: m[0],
    after: xml.slice(m.index + m[0].length),
  };
}

function substituteRow(rowXml, values) {
  let out = rowXml;
  for (const [token, value] of Object.entries(values)) {
    out = out.split(`{{${token}}}`).join(textToRunXml(value));
  }
  return out;
}

// ── Pallet distribution ─────────────────────────────────────────────────
// Evenly splits `totalQty` across `palletCount` pallets. When it doesn't
// divide evenly, the first `remainder` pallets get one extra unit so every
// unit is accounted for exactly once (e.g. 100 across 3 → 34, 33, 33).
function distributeQuantity(totalQty, palletCount) {
  const n = Math.max(1, Number(palletCount) || 1);
  const total = Number(totalQty) || 0;
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(base + (i < remainder ? 1 : 0));
  }
  return result;
}

// Evenly splits a weight (float) across N pallets, 2 decimal places,
// giving any rounding remainder to the last pallet so the pallets' sum
// matches the part total exactly (not just approximately after rounding).
function distributeWeight(totalWeight, palletCount) {
  const n = Math.max(1, Number(palletCount) || 1);
  const total = Number(totalWeight) || 0;
  const base = round2(total / n);
  const result = new Array(n).fill(base);
  const sum = round2(base * n);
  const diff = round2(total - sum);
  if (diff !== 0) result[n - 1] = round2(result[n - 1] + diff);
  return result;
}

// Default (un-edited) pallet breakdown for one item line, used both to
// seed the frontend's editable preview and as a fallback if the caller
// sends a palletCount without its own pallet array.
function buildDefaultPallets(qty, grossWt, dimensions, palletCount) {
  const qtys = distributeQuantity(qty, palletCount);
  const weights = distributeWeight(grossWt, palletCount);
  return qtys.map((q, i) => ({
    qty: q,
    dimensions: dimensions || "",
    grossWt: weights[i],
  }));
}

// ── Lookup: resolve one or more PO Numbers to shipment/part/invoice data ──
// Returns { items, skipped }. `items` is one entry per (PO, part) pair —
// multiple POs and/or multiple parts on one shipment never get merged, so
// part-wise and PO-wise quantities stay correct (per spec §6). `skipped`
// lists PO Numbers that couldn't be resolved, same partial-failure pattern
// already used by generateLabelDocument/generateAllDocumentsZip.
async function lookupPackingListItems(poNumbers) {
  const items = [];
  const skipped = [];
  const shipmentCache = new Map(); // shipment._id -> consignee default (fetched once per shipment)

  for (const poNumber of poNumbers) {
    const result = await findShipmentByPoNumber(poNumber);
    if (result.notFound) {
      skipped.push({ poNumber, reason: result.reason });
      continue;
    }
    const { shipment, enquiry } = result;
    const parts = Array.isArray(shipment.parts) ? shipment.parts : [];
    if (parts.length === 0) {
      skipped.push({ poNumber, reason: "This shipment has no parts recorded." });
      continue;
    }

    let consigneeDefault = shipmentCache.get(String(shipment._id));
    if (!consigneeDefault) {
      consigneeDefault = await lookupCustomerAddress(shipment.customer || enquiry.customerName || "");
      shipmentCache.set(String(shipment._id), consigneeDefault);
    }

    for (const part of parts) {
      const qty = Number(part.quantity) || 0;
      const grossWt = Number(part.gross_wt) || 0;
      const netWt = qty * (Number(part.net_wt_per_unit) || 0);
      items.push({
        poNumber,
        shipmentId: String(shipment._id),
        enquiryNo: shipment.enquiry_no || enquiry.enquiryNumber || "",
        customer: shipment.customer || enquiry.customerName || "",
        invoiceNo: shipment.invoice_no || "",
        invoiceDate: shipment.invoice_date || "",
        pol: shipment.pol || "",
        mode: shipment.mode || "",
        containerNo: shipment.container_no || "",
        portOfDischarge: shipment.port_of_discharge || "",
        finalDestination: shipment.final_destination || "",
        partNo: part.part_no || "",
        description: part.part_desc || "",
        hsnCode: part.hsn_code || "",
        qty,
        unit: "pcs",
        netWt,
        grossWt,
        dimensions: part.box_size || "",
        suggestedPalletCount: Math.max(1, Number(part.no_of_boxes) || 1),
        consigneeDefault,
      });
    }
  }

  return { items, skipped };
}

async function lookupCustomerAddress(customerName) {
  const name = (customerName || "").trim();
  if (!name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entry = await CustomerAddressBook.findOne({
    isActive: true,
    customerName: { $regex: `^\\s*${escaped}\\s*$`, $options: "i" },
  }).lean();
  return entry || null;
}

// ── Final document generation ───────────────────────────────────────────
// `items`: [{ description, hsnCode, qty, unit, netWt, grossWt, pallets:
//   [{ qty, dimensions, grossWt }] }], already validated by the caller
//   (pallet qty sums must match item qty — see controller).
// `consignee` / `buyer`: { companyName, lines: [...], attn, phone, email }
// Returns a docx Buffer (PDF conversion happens in the controller, same as
// every other document type, via the existing convertDocxBufferToPdf).
function generatePackingListBuffer({
  category = "consulting",
  packingListNo,
  packingListDate,
  customerPoNumber,
  customerPoDate,
  pol,
  portOfDischarge,
  finalDestination,
  carrierBy,
  containerNo,
  invoiceNo,
  invoiceDate,
  consignee,
  buyer,
  exporter, // optional { name, lines: [...] } — overrides the fixed block when sent
  items,
}) {
  const templateFile = TEMPLATE_FILES[category] || TEMPLATE_FILES.consulting;
  const baseExporter = EXPORTER_BLOCKS[category] || EXPORTER_BLOCKS.consulting;
  const exporterBlock =
    exporter && String(exporter.name || "").trim()
      ? {
          ...baseExporter,
          name: String(exporter.name).trim(),
          lines: (Array.isArray(exporter.lines) ? exporter.lines : []).map((l) => String(l ?? "")),
        }
      : baseExporter;

  const templatePath = path.join(TEMPLATES_DIR, templateFile);
  if (!fs.existsSync(templatePath)) {
    const err = new Error(`Template file not found: ${templateFile}`);
    err.code = "TEMPLATE_NOT_FOUND";
    throw err;
  }

  const zip = new AdmZip(templatePath);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) {
    const err = new Error("word/document.xml missing from Packing List template");
    err.code = "TEMPLATE_CORRUPT";
    throw err;
  }

  let xml = zip.readAsText(entry, "utf8");
  xml = healSplitPlaceholderRuns(xml);

  // ── Item rows (one per part / PO line) ──
  const { before: beforeItems, rowXml: itemRowTemplate, after: afterItems } =
    extractTemplateRow(xml, "{{ITEM_DESC}}", "item");
  const itemRowsXml = items
    .map((item, idx) =>
      substituteRow(itemRowTemplate, {
        ITEM_SR_NO: String(idx + 1),
        ITEM_DESC: item.description,
        ITEM_HSN: item.hsnCode || "",
        ITEM_QTY: String(item.qty),
        ITEM_UNIT: item.unit || "pcs",
        ITEM_NET_WT: Number(item.netWt).toFixed(3),
        ITEM_GROSS_WT: Number(item.grossWt).toFixed(3),
      })
    )
    .join("");
  xml = beforeItems + itemRowsXml + afterItems;

  // ── Pallet/box rows (one per pallet, across ALL item lines, Sr.No
  //    running continuously — "No of Boxes" column resets per item line
  //    as i/N, matching the reference sample's "1/2","2/2" pattern) ──
  const { before: beforeBoxes, rowXml: boxRowTemplate, after: afterBoxes } =
    extractTemplateRow(xml, "{{BOX_DIMENSIONS}}", "pallet/box");
  let runningSrNo = 0;
  const boxRowsXml = items
    .flatMap((item) =>
      (item.pallets || []).map((pallet, i) => {
        runningSrNo += 1;
        return substituteRow(boxRowTemplate, {
          BOX_SR_NO: String(runningSrNo),
          BOX_NO: `${i + 1}/${item.pallets.length}`,
          BOX_DIMENSIONS: pallet.dimensions || "",
          BOX_QTY: String(pallet.qty),
          BOX_GROSS_WT: Number(pallet.grossWt).toFixed(2),
        });
      })
    )
    .join("");
  xml = beforeBoxes + boxRowsXml + afterBoxes;

  // ── Totals (computed from the actual item/pallet data being printed,
  //    not a separately-trusted shipment field, so the numbers on the
  //    page always agree with the rows above them) ──
  const totalBoxes = items.reduce((sum, it) => sum + (it.pallets || []).length, 0);
  const totalNetWt = items.reduce((sum, it) => sum + Number(it.netWt), 0);
  const totalGrossWt = items.reduce((sum, it) => sum + Number(it.grossWt), 0);

  const consigneeLines = buildCustomerLines(consignee);
  const buyerLines = buildCustomerLines(buyer || consignee);

  const singleValues = {
    EXPORTER_LINE1: exporterBlock.name,
    EXPORTER_LINE2: exporterBlock.lines[0] || "",
    EXPORTER_LINE3: exporterBlock.lines[1] || "",
    EXPORTER_LINE4: exporterBlock.lines[2] || "",
    EXPORTER_LINE5: exporterBlock.lines[3] || "",
    EXPORTER_LINE6: exporterBlock.lines[4] || "",
    CONSIGNEE_LINE1: consigneeLines[0] || "",
    CONSIGNEE_LINE2: consigneeLines[1] || "",
    CONSIGNEE_LINE3: consigneeLines[2] || "",
    CONSIGNEE_LINE4: consigneeLines[3] || "",
    CONSIGNEE_LINE5: consigneeLines[4] || "",
    CONSIGNEE_LINE6: consigneeLines[5] || "",
    BUYER_LINE1: buyerLines[0] || "",
    BUYER_LINE2: buyerLines[1] || "",
    BUYER_LINE3: buyerLines[2] || "",
    BUYER_LINE4: buyerLines[3] || "",
    BUYER_LINE5: buyerLines[4] || "",
    BUYER_LINE6: buyerLines[5] || "",
    PACKING_LIST_NO: packingListNo || "",
    PACKING_LIST_DATE: packingListDate || "",
    COUNTRY_OF_ORIGIN: COUNTRY_OF_ORIGIN,
    CUSTOMER_PO_NO: customerPoNumber || "",
    CUSTOMER_PO_DATE: customerPoDate || "",
    POL: pol || "",
    PORT_OF_DISCHARGE: portOfDischarge || "",
    FINAL_DELIVERY_PLACE: finalDestination || "",
    FINAL_DESTINATION: finalDestination || "",
    CARRIER_BY: carrierBy || "",
    CONTAINER_NO: containerNo || "",
    TOTAL_NO_OF_BOX: String(totalBoxes),
    TOTAL_NET_WEIGHT: totalNetWt.toFixed(3),
    TOTAL_GROSS_WEIGHT: totalGrossWt.toFixed(3),
    INVOICE_NO: invoiceNo || "",
    INVOICE_DATE: invoiceDate || "",
    SIGNATORY_COMPANY_NAME: exporterBlock.signatoryName,
  };

  for (const [token, value] of Object.entries(singleValues)) {
    xml = xml.split(`{{${token}}}`).join(textToRunXml(value));
  }

  zip.updateFile("word/document.xml", Buffer.from(xml, "utf8"));
  return zip.toBuffer();
}

// Flattens a { companyName, lines: [...], attn, phone, email } block into
// up to 6 printed lines, same shape the reference sample uses: company
// name, address line(s), Attn, Phone, Email. Never invents a value —
// blank fields are simply omitted (no empty "Attn:" line), so a customer
// with no saved address book entry just prints only what was typed in.
function buildCustomerLines(block) {
  if (!block) return [];
  const lines = [];
  if (block.companyName) lines.push(block.companyName);
  for (const line of block.lines || []) {
    if (line) lines.push(line);
  }
  if (block.attn) lines.push(`Attn: ${block.attn}`);
  if (block.phone) lines.push(`Phone: ${block.phone}`);
  if (block.email) lines.push(`E-mail :${block.email}`);
  return lines.slice(0, 6);
}

module.exports = {
  lookupPackingListItems,
  lookupCustomerAddress,
  distributeQuantity,
  distributeWeight,
  buildDefaultPallets,
  generatePackingListBuffer,
};
