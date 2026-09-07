const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

// ─────────────────────────────────────────────────────────────────────────
// Document Generation (Logistics → Shipment List → "Generate Document.")
// ─────────────────────────────────────────────────────────────────────────
// Templates live in backend/document-templates/*.docx. Each template's
// word/document.xml already contains {{PLACEHOLDER}} tokens in place of the
// original sample values, so generation is a plain text substitution on
// document.xml inside the zip — no XML restructuring, so all original
// formatting (fonts, superscripts, bold, images, headers/footers) survives
// untouched. Nothing else in the zip (styles, media, rels) is modified.
// ─────────────────────────────────────────────────────────────────────────

const TEMPLATES_DIR = path.join(__dirname, "..", "document-templates");

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ordinalSuffix(day) {
  const d = Number(day);
  if (d % 10 === 1 && d !== 11) return "st";
  if (d % 10 === 2 && d !== 12) return "nd";
  if (d % 10 === 3 && d !== 13) return "rd";
  return "th";
}

// Shipment.invoice_date is stored as a plain String — normally an
// HTML <input type="date"> value ("YYYY-MM-DD"), but we fall back to
// native Date parsing for any other format already sitting in the DB.
// Returns null (never today's date) if the value is missing/unparseable.
function parseInvoiceDate(rawValue) {
  if (!rawValue || typeof rawValue !== "string" || !rawValue.trim()) return null;

  const isoMatch = rawValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  let year, monthIdx, day;
  if (isoMatch) {
    year = Number(isoMatch[1]);
    monthIdx = Number(isoMatch[2]) - 1;
    day = Number(isoMatch[3]);
  } else {
    const d = new Date(rawValue);
    if (isNaN(d.getTime())) return null;
    year = d.getFullYear();
    monthIdx = d.getMonth();
    day = d.getDate();
  }
  if (!year || monthIdx < 0 || monthIdx > 11 || !day) return null;

  const month = MONTHS[monthIdx];
  const suffix = ordinalSuffix(day);
  return {
    day: String(day),
    suffix,
    month,
    year: String(year),
    monthYear: `${month} ${year}`,
  };
}

// Escape text being inserted into a <w:t> node. Only &, <, > need escaping
// inside XML text content (quotes are already literal " chars in <w:t>text).
function escapeXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ✅ NEW — sb_date is stored as a real Mongoose Date (unlike invoice_date,
// which is a String), so it needs its own parser. Returns the same
// {day, suffix, month, year, monthYear} shape as parseInvoiceDate so it can
// feed the same superscript-ordinal placeholder pattern used elsewhere.
// Returns null (never today's date, never undefined/null in output) when
// the value is missing/unparseable.
function parseGenericDate(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  const d = new Date(rawValue);
  if (isNaN(d.getTime())) return null;
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return {
    day: String(day),
    suffix: ordinalSuffix(day),
    month,
    year: String(year),
    monthYear: `${month} ${year}`,
  };
}


// `auto` fields are always derived from the shipment record.
// `editable` fields are seeded from the shipment (where noted) but can be
// overridden by the user before download; if neither the shipment nor the
// user supplies a value, they render blank rather than a fake placeholder.
const DOCUMENT_TYPES = {
  evd: {
    label: "Export Value Declaration (EVD)",
    file: "EVD.docx",
    editableFields: [],
  },
  end_use_letter: {
    label: "End Use Letter",
    file: "EndUseLetter.docx",
    editableFields: ["part_desc", "end_user", "sector"],
  },
  scomet: {
    label: "SCOMET Declaration",
    file: "SCOMET.docx",
    editableFields: ["part_desc", "end_user"],
  },
  authority_letter: {
    label: "Authority Letter",
    file: "AuthorityLetter.docx",
    editableFields: [],
  },
  cargo_security_declaration: {
    label: "Cargo Security Declaration",
    file: "CargoSecurityDeclaration.docx",
    editableFields: ["hawb", "mawb", "ff", "mode"],
  },
};

function getDocumentTypeMeta(docType) {
  return DOCUMENT_TYPES[docType] || null;
}

// Builds the {{PLACEHOLDER}}: value map for a given doc type + shipment +
// user-edited field overrides. Returns { values, missing } where `missing`
// lists which *required automatic* fields (invoice number/date) are absent
// so the caller can surface a clear error instead of inserting blanks.
function buildPlaceholderValues(docType, shipmentDoc, editableOverrides = {}) {
  const meta = getDocumentTypeMeta(docType);
  if (!meta) throw new Error(`Unknown document type: ${docType}`);

  const missing = [];
  const values = {};

  const invoiceNo = shipmentDoc.invoice_no ? String(shipmentDoc.invoice_no).trim() : "";
  if (!invoiceNo) missing.push("Invoice Number is missing for this shipment.");
  values.INVOICE_NO = escapeXmlText(invoiceNo);

  const date = parseInvoiceDate(shipmentDoc.invoice_date);
  if (!date) {
    missing.push("Invoice Date is missing for this shipment.");
    values.INVOICE_DAY = "";
    values.INVOICE_SUFFIX = "";
    values.INVOICE_MONTH = "";
    values.INVOICE_YEAR = "";
    values.INVOICE_MONTH_YEAR = "";
  } else {
    values.INVOICE_DAY = date.day;
    values.INVOICE_SUFFIX = date.suffix;
    values.INVOICE_MONTH = date.month;
    values.INVOICE_YEAR = date.year;
    values.INVOICE_MONTH_YEAR = date.monthYear;
  }

  if (docType === "cargo_security_declaration") {
    const mode = shipmentDoc.mode ? String(shipmentDoc.mode).trim() : "";
    // Template wording is "Sea shipment" / "Sea transportation"; substitute
    // the actual mode (Sea/Air/Road/Rail) — default to "Sea" wording only
    // when a mode genuinely isn't set is NOT done here: leave literal mode
    // text blank-safe by falling back to the stored mode value as-is.
    values.MODE = escapeXmlText(mode || "Sea");
    // ✅ NEW — FF (Freight Forwarder) replaces the previously hard-coded
    // "Expeditors" in this template too (same pattern as Authority Letter).
    values.FF = escapeXmlText(shipmentDoc.ff || "");
  }

  // ✅ NEW — EVD: SB Number + SB Date (AUTO , additive only), populated into
  // the template's existing "Shipping Bill No. & Date :-" field. Existing
  // Invoice Number/Date fetching above is untouched. Blank (not
  // "undefined"/"null") when the shipment doesn't have these values yet —
  // never blocks generation the way missing Invoice No./Date does.
  if (docType === "evd") {
    values.SB_NO = escapeXmlText(shipmentDoc.sb_no || "");
    const sbDate = parseGenericDate(shipmentDoc.sb_date);
    values.SB_DAY = sbDate ? sbDate.day : "";
    values.SB_SUFFIX = sbDate ? sbDate.suffix : "";
    values.SB_MONTH_YEAR = sbDate ? sbDate.monthYear : "";
  }

  // ✅ NEW — Authority Letter: FF (Freight Forwarder) replaces the previously
  // hard-coded "Expeditors International (India) Pvt Ltd" in the template.
  // Existing Invoice Number/Date fetching above is untouched.
  if (docType === "authority_letter") {
    values.FF = escapeXmlText(shipmentDoc.ff || "");
  }

  // Editable fields: shipment-derived default, overridable by the user.
  // Never invented — blank when neither source has a value.
  if (meta.editableFields.includes("part_desc")) {
    const firstPart = Array.isArray(shipmentDoc.parts) && shipmentDoc.parts.length > 0
      ? shipmentDoc.parts[0]
      : null;
    const fallback = firstPart && firstPart.part_desc ? firstPart.part_desc : "";
    const val = editableOverrides.part_desc !== undefined ? editableOverrides.part_desc : fallback;
    values.PART_DESC = escapeXmlText(val);
  }

  if (meta.editableFields.includes("end_user")) {
    const val = editableOverrides.end_user !== undefined ? editableOverrides.end_user : "";
    values.END_USER = escapeXmlText(val);
  }

  // ✅ NEW — Sector (End Use Letter only). Shipment-derived default,
  // overridable by the user, blank when neither source has a value —
  // matches the same pattern as the other editable fields above.
  if (meta.editableFields.includes("sector")) {
    const fallback = shipmentDoc.sector || "";
    const val = editableOverrides.sector !== undefined ? editableOverrides.sector : fallback;
    values.SECTOR = escapeXmlText(val);
  }

  if (meta.editableFields.includes("hawb")) {
    const fallback = shipmentDoc.hawb || "";
    const val = editableOverrides.hawb !== undefined ? editableOverrides.hawb : fallback;
    values.HAWB = escapeXmlText(val);
  }

  if (meta.editableFields.includes("mawb")) {
    const fallback = shipmentDoc.mawb || "";
    const val = editableOverrides.mawb !== undefined ? editableOverrides.mawb : fallback;
    values.MAWB = escapeXmlText(val);
  }

  return { values, missing };
}

// Reads the given doc type's template, substitutes every {{TOKEN}} in
// word/document.xml with its resolved value, and returns a docx Buffer.
function generateDocumentBuffer(docType, shipmentDoc, editableOverrides = {}) {
  const meta = getDocumentTypeMeta(docType);
  if (!meta) throw new Error(`Unknown document type: ${docType}`);

  const { values, missing } = buildPlaceholderValues(docType, shipmentDoc, editableOverrides);
  if (missing.length > 0) {
    const err = new Error(missing.join(" "));
    err.code = "MISSING_REQUIRED_FIELDS";
    err.details = missing;
    throw err;
  }

  const templatePath = path.join(TEMPLATES_DIR, meta.file);
  if (!fs.existsSync(templatePath)) {
    const err = new Error(`Template file not found: ${meta.file}`);
    err.code = "TEMPLATE_NOT_FOUND";
    throw err;
  }

  const zip = new AdmZip(templatePath);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) {
    const err = new Error("word/document.xml missing from template");
    err.code = "TEMPLATE_CORRUPT";
    throw err;
  }

  let xml = zip.readAsText(entry, "utf8");
  for (const [token, value] of Object.entries(values)) {
    xml = xml.split(`{{${token}}}`).join(value);
  }

  zip.updateFile("word/document.xml", Buffer.from(xml, "utf8"));
  return zip.toBuffer();
}

// Preview (no download): resolved values + which fields are still editable,
// so the frontend can render an edit form before the user downloads.
function previewDocumentFields(docType, shipmentDoc, editableOverrides = {}) {
  const meta = getDocumentTypeMeta(docType);
  if (!meta) throw new Error(`Unknown document type: ${docType}`);
  const { values, missing } = buildPlaceholderValues(docType, shipmentDoc, editableOverrides);

  const editable = {};
  if (meta.editableFields.includes("part_desc")) editable.part_desc = values.PART_DESC || "";
  if (meta.editableFields.includes("end_user")) editable.end_user = values.END_USER || "";
  if (meta.editableFields.includes("sector")) editable.sector = values.SECTOR || "";
  if (meta.editableFields.includes("hawb")) editable.hawb = values.HAWB || "";
  if (meta.editableFields.includes("mawb")) editable.mawb = values.MAWB || "";

  return {
    docType,
    label: meta.label,
    invoice_no: shipmentDoc.invoice_no || "",
    invoice_date: shipmentDoc.invoice_date || "",
    mode: shipmentDoc.mode || "",
    // ✅ NEW — additive display-only fields, only populated for the doc
    // types that use them; undefined (omitted) for the other 4 doc types.
    sb_no: docType === "evd" ? (shipmentDoc.sb_no || "") : undefined,
    sb_date: docType === "evd" ? (shipmentDoc.sb_date || "") : undefined,
    ff: docType === "authority_letter" ? (shipmentDoc.ff || "") : undefined,
    editableFields: meta.editableFields,
    editable,
    missing,
  };
}

module.exports = {
  DOCUMENT_TYPES,
  getDocumentTypeMeta,
  generateDocumentBuffer,
  previewDocumentFields,
};
