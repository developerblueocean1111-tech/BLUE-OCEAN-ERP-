// ─────────────────────────────────────────────────────────────────────────
// ✅ NEW — PO Number → Shipment lookup (Label Document feature only)
//
// WHY THIS FILE EXISTS:
//   The Shipment collection has no "PO Number" field of its own. The PO
//   Number lives on the Enquiry record instead — either at
//   Enquiry.poDetails.poNumber (single-supplier enquiries) or inside
//   Enquiry.partSuppliers[].suppliers[].poNumber (multi-supplier enquiries).
//   Enquiry and Shipment are linked by the business identifier
//   enquiry_no === Enquiry.enquiryNumber.
//
//   This file only READS from the existing Enquiry/Shipment collections.
//   It does not create, modify, or duplicate any record, and it does not
//   touch any existing route, controller, or query already in the app.
// ─────────────────────────────────────────────────────────────────────────
const Enquiry = require("../models/Enquiry");
const Shipment = require("../models/shipment");

// Strips whitespace/punctuation and lowercases, so "PS-00001247",
// "ps 00001247", and "PS00001247" are all treated as the same PO Number.
// Also handles PO Numbers stored as a Number instead of a String (e.g. by
// a bulk-import/migration script bypassing the Mongoose schema cast) —
// String(anything) normalizes fine either way.
function normalizePo(value) {
  return String(value ?? "").replace(/[\s\-_./]/g, "").toLowerCase();
}

// Finds the Shipment that a given PO Number belongs to.
// Returns { enquiry, shipment } on success.
// Returns { notFound: true, reason } when the PO Number itself doesn't
// exist, or when it exists on an Enquiry that has no matching Shipment yet
// (e.g. shipment not created for that PO yet) — the caller surfaces the
// existing "PO Number not found." message either way, per spec.
async function findShipmentByPoNumber(poNumberRaw) {
  const poNumber = String(poNumberRaw || "").trim();
  if (!poNumber) {
    return { notFound: true, reason: "PO Number is required." };
  }
  const target = normalizePo(poNumber);

  // Fast path: exact (case-insensitive, whitespace-tolerant) regex match —
  // works whenever the field is actually stored as a String, which is the
  // Mongoose schema type and covers the vast majority of records.
  const escaped = poNumber.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = { $regex: `^\\s*${escaped}\\s*$`, $options: "i" };

  let enquiry = await Enquiry.findOne({
    $or: [
      { "poDetails.poNumber": exact },
      { "partSuppliers.suppliers.poNumber": exact },
    ],
  }).lean();

  // Fallback path: only runs if the fast path found nothing. Covers PO
  // Numbers that don't line up as a plain-string exact match — different
  // separators/formatting, or a value stored as a Number by a script that
  // bypassed the schema's String cast (Mongo's $regex only matches string
  // BSON values, so those rows are invisible to the fast path above).
  // Normalizes both sides (strip whitespace/punctuation, lowercase) and
  // compares in application code. Scoped to records that actually have a
  // PO Number set, so this stays cheap even as a fallback.
  if (!enquiry) {
    const candidates = await Enquiry.find({
      $or: [
        { "poDetails.poNumber": { $exists: true, $ne: "" } },
        { "partSuppliers.suppliers.poNumber": { $exists: true, $ne: "" } },
      ],
    }).lean();

    enquiry = candidates.find((e) => {
      if (normalizePo(e.poDetails?.poNumber) === target) return true;
      return (e.partSuppliers || []).some((ps) =>
        (ps.suppliers || []).some((s) => normalizePo(s.poNumber) === target)
      );
    }) || null;
  }

  if (!enquiry) {
    return { notFound: true, reason: "PO Number not found." };
  }

  const shipment = await Shipment.findOne({ enquiry_no: enquiry.enquiryNumber }).lean();
  if (!shipment) {
    return {
      notFound: true,
      reason: `PO Number not found. (Matched enquiry ${enquiry.enquiryNumber}, but no shipment exists for it yet.)`,
    };
  }

  return { enquiry, shipment };
}

module.exports = { findShipmentByPoNumber };
