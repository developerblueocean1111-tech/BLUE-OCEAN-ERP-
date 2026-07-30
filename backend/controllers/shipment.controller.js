const { default: mongoose } = require("mongoose");
const fs = require("fs");
const part = require("../models/part");
const shipment = require("../models/shipment");
const XLSX = require('xlsx');

function normalize(data) {
  const out = { ...data };

  // String fields that must never be converted to null — an empty string here
  // means "user left it blank this time"; null would overwrite a previously
  // saved value via Object.assign(doc, data) in updateShipment.
  const preserveStrings = new Set([
    "sb_no", "bl_no", "pol", "container_no",
    "notify_email", "email_message", "manual_desc",
    "ff", "invoice_no", "customer", "supplier_name", "enquiry_no",
  ]);

  Object.keys(out).forEach((k) => {
    if (out[k] === "" && !preserveStrings.has(k)) out[k] = null;
  });

  // Ensure sanitization handles both single properties and new array configurations
  [
    "part_qty", "net_wt", "gross_wt", "packaging_wt", "total_cost",
    "quantity", "net_wt_per_unit", "total_no_of_boxes", "gross_wt",
     "total_no_of_boxes", "total_net_weight", "total_gross_weight"
  ].forEach((f) => {
    if (out[f] !== null && out[f] !== undefined) {
      const parsed = Number(out[f]);
      out[f] = Number.isFinite(parsed) ? parsed : null;
    }
  });

  // Dates
  ["dispatch_date", "sb_date", "etd", "final_delivery_date"].forEach((d) => {
    if (out[d]) out[d] = new Date(out[d]);
  });

  return out;
}
// ✅ NEW HELPER: Merge incoming payload onto existing DB doc,
// keeping old values wherever the incoming field is blank / undefined.
function mergePreservingExisting(doc, incoming) {
  Object.keys(incoming).forEach((key) => {
    const val = incoming[key];
    // Skip parts — handled separately
    if (key === "parts") return;
    // Skip undefined
    if (val === undefined) return;
    // Skip empty string — preserve whatever is in DB
    if (val === "" || val === null) {
      // Only overwrite with null if the field was explicitly provided AND
      // it is NOT a string field that currently has a real value in DB.
      // Rule: if DB already has a non-empty value and incoming is "", keep DB.
      if (doc[key] !== undefined && doc[key] !== null && doc[key] !== "") return;
    }
    doc[key] = val;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers for the two new Dashboard features:
//   1) Part Number Analytics
//   2) ETD Date Based Shipment Search
// These do not touch any existing exported function/route above — additive
// only, as requested ("do not change existing UI and functionality").
// ──────────────────────────────────────────────────────────────────────────

// Escapes a user-supplied string so it can be safely used inside a $regex
// (prevents ReDoS / regex-injection via search boxes).
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds a case-insensitive, partial-match regex for a part number search
// term, ignoring spaces and dashes on both sides of the comparison — so
// "501 14 013", "501-14-013", and "5011 4013" all match the same part.
// Throws on an empty/whitespace-only term so callers can 400 cleanly.
function buildPartNoRegex(term) {
  const cleaned = String(term || "").trim();
  if (!cleaned) throw new Error("Empty part number search term");
  const normalized = escapeRegex(cleaned).replace(/[\s-]+/g, "[\\s-]*");
  return new RegExp(normalized, "i");
}

// Mirrors calcDeliveryStatus() in frontend/src/pages/ShipmentsList.js and
// frontend/src/pages/dashboard/useDashboardData.js EXACTLY, so a shipment's
// computed status is identical everywhere in the app. Used when we already
// have a plain JS object (e.g. a page of results after aggregation).
function computeDeliveryStatus(doc) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const etd = doc.etd ? new Date(doc.etd) : null;
  const final = doc.final_delivery_date ? new Date(doc.final_delivery_date) : null;
  if (etd) etd.setHours(0, 0, 0, 0);
  if (final) final.setHours(0, 0, 0, 0);

  if (!etd && !final) return doc.delivery_status || "IN_PROCESS";
  if (final && today >= final) return "DELIVERED";
  if (etd && today >= etd) return "IN_TRANSIT";
  return "IN_PROCESS";
}

// Same logic, expressed as a MongoDB aggregation expression so large
// collections can be grouped/counted by computed status WITHOUT pulling
// every document into Node first (needed for the ETD-search summary cards
// so they stay accurate — and fast — over large shipment datasets).
function deliveryStatusMongoExpr(now) {
  return {
    $switch: {
      branches: [
        {
          case: { $and: [{ $eq: ["$etd", null] }, { $eq: ["$final_delivery_date", null] }] },
          then: { $ifNull: ["$delivery_status", "IN_PROCESS"] },
        },
        {
          case: { $and: [{ $ne: ["$final_delivery_date", null] }, { $lte: ["$final_delivery_date", now] }] },
          then: "DELIVERED",
        },
        {
          case: { $and: [{ $ne: ["$etd", null] }, { $lte: ["$etd", now] }] },
          then: "IN_TRANSIT",
        },
      ],
      default: "IN_PROCESS",
    },
  };
}

// Whole-days between two dates (used for Transit Days / Avg Delivery Time).
function transitDays(etd, final) {
  if (!etd || !final) return null;
  const MS = 1000 * 60 * 60 * 24;
  const d = Math.round((new Date(final) - new Date(etd)) / MS);
  return d >= 0 ? d : null;
}

function sumPartsQty(parts) {
  return (Array.isArray(parts) ? parts : []).reduce((s, p) => s + (Number(p.quantity) || 0), 0);
}

function monthKey(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTH_LABELS[Number(m) - 1]} ${y}`;
}

exports.fetchDashboardSummary = async (req, res) => {
  try {
    const totalShipments = await shipment.countDocuments();

    const modeWise = await shipment.aggregate([
      { $group: { _id: "$mode", count: { $sum: 1 } } },
      { $project: { mode: "$_id", count: 1, _id: 0 } },
    ]);

    const statusWise = await shipment.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $project: { status: "$_id", count: 1, _id: 0 } },
    ]);

    res.json({ totalShipments, modeWise, statusWise });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Dashboard fetch failed" });
  }
};

exports.addShipment = async (req, res) => {
  try {
    const data = normalize(req.body);
    console.log("[addShipment] sb_no:", data.sb_no, "| sb_date:", data.sb_date, "| final_delivery_date:", data.final_delivery_date);

    if (data.part_no && data.part_desc) {
      await part.updateOne(
        { part_no: data.part_no },
        { part_desc: data.part_desc },
        { upsert: true },
      );
    }

    // Map properties into structural subdocuments so schema math hooks fire.
    // Step1 sends parts[] with keys: part_no, part_desc, part_qty, part_net_unit,
    // part_pkg_wt, part_gross, part_box_size  — normalise them to schema names.
    if (data.parts && data.parts.length > 0) {
      data.parts = data.parts.map((p) => ({
        part_no:         p.part_no        || "UNKNOWN",
        part_desc:       p.part_desc      || "",
        box_size:        p.part_box_size  || p.box_size || "",
        quantity:        Number(p.part_qty)       || 0,
        net_wt_per_unit: Number(p.part_net_unit)  || 0,
        no_of_boxes:     Number(p.part_no_of_boxes) ||0, 
        total_net_wt:    Number(p.part_total_net_wt) || 0, 
        gross_wt:        Number(p.part_gross)     || 0,
      }));
    } else {
      // Legacy flat-field fallback
      data.parts = [
        {
          part_no:         data.part_no    || "UNKNOWN",
          part_desc:       data.part_desc  || "",
          box_size:        data.box_size   || "",
          quantity:        Number(data.part_qty)    || 0,
          net_wt_per_unit: Number(data.net_wt)      || 0,
          no_of_boxes:     Number(data.part_no_of_boxes) ||0, 
          total_net_wt:    Number(data.part_total_net_wt) || 0, 
          gross_wt:        Number(data.gross_wt)    || 0,
        }
      ];
    }

    // Preserve the flat totals from Step1 so the pre-save hook can sync them
    // to total_net_weight / total_gross_weight / total_parts_count.
    if (data.total_qty      !== undefined) data.total_qty      = Number(data.total_qty);
    if (data.total_net_wt   !== undefined) data.total_net_wt   = Number(data.total_net_wt);
    if (data.total_gross_wt !== undefined) data.total_gross_wt = Number(data.total_gross_wt);
    if (data.total_no_of_boxes !== undefined) data.total_no_of_boxes = Number(data.total_no_of_boxes);
// ──────────────────────────────────────────────────────────────────
    // ✅ DUPLICATE-SAVE FIX (Task 1)
    // ----------------------------------------------------------------
    // WHY: Previously this handler ALWAYS ran shipment.create(), so every
    // click of "Save Shipment" — including accidental double-clicks or a
    // resubmit of the same form — inserted a brand-new document.
    //
    // FIX: We now treat enquiry_no (the shipment's existing unique
    // business identifier — already relied on elsewhere in this file for
    // bulk-upload de-duplication and auto-numbering) as the "does this
    // shipment already exist?" check:
    //   - If a shipment with this enquiry_no already exists → UPDATE it
    //     in place (upsert-style) instead of inserting a duplicate.
    //   - If it doesn't exist yet → insert it, exactly as before.
    //
    // We intentionally reuse the exact same `doc.save()` pattern already
    // used in updateShipment() (Object.assign + save) rather than
    // Model.findOneAndUpdate(), because the schema's pre("save") hook
    // (totals calculation) only fires on .save(), and we must not change
    // any existing calculation logic. This keeps 100% of the existing
    // business logic identical — only the insert-vs-update decision
    // changes.
    // ──────────────────────────────────────────────────────────────────
    let result;

    if (data.enquiry_no) {
      const existing = await shipment.findOne({ enquiry_no: data.enquiry_no });

      if (existing) {
        // Shipment already exists for this enquiry_no → UPDATE, don't insert.
        Object.assign(existing, data);
        result = await existing.save();
      } else {
        // First time saving this enquiry_no → normal insert.
        result = await shipment.create({
          ...data,
          status: "ACTIVE",
          delivery_status: "IN_PROCESS",
        });
      }
    } else {
      // No enquiry_no on payload (shouldn't normally happen since it's
      // auto-generated) — fall back to original create() behaviour so
      // nothing that worked before is broken.
      result = await shipment.create({
        ...data,
        status: "ACTIVE",
        delivery_status: "IN_PROCESS",
      });
    }

    res.json({ id: result._id.toString() });
  } catch (err) {
    // A duplicate-key error can still surface here if two requests race
    // each other at the exact same instant (both pass the findOne check
    // before either insert completes). The unique index on enquiry_no
    // (see models/shipment.js) guarantees the DB itself never ends up
    // with two documents for the same enquiry_no even in that case —
    // we just surface a clearer message for it instead of a generic 500.
    if (err && err.code === 11000) {
      return res.status(409).json({
        message: "A shipment with this Enquiry No already exists. Please refresh and try again.",
      });
    }
    console.error("🔥 MONGO CREATE ERROR 🔥", err);
    res.status(500).json({ message: err.message });
  }
};
exports.updateShipment = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid shipment ID" });
    }

    const data = normalize(req.body);
    console.log("[updateShipment] sb_no:", data.sb_no, "| sb_date:", data.sb_date, "| final_delivery_date:", data.final_delivery_date);
    const doc = await shipment.findById(id);
    
    if (!doc) {
      return res.status(404).json({ message: "Shipment not found" });
    }

    // If parts array is present from Step1, normalise the Step1 field names
    // (part_gross, part_net_unit, part_pkg_wt, part_box_size) → schema names.
    if (data.parts && data.parts.length > 0) {
      data.parts = data.parts.map((p, i) => {
        let existing = {};
        if (p._id && doc.parts) {
          existing = doc.parts.id(p._id) || doc.parts[i] || {};
        } else if (doc.parts && doc.parts[i]) {
          existing = doc.parts[i];
        }
        return {
          _id:             p._id             || existing._id,
          part_no:         p.part_no         || existing.part_no         || "UNKNOWN",
          part_desc:       p.part_desc       || existing.part_desc       || "",
          box_size:        p.part_box_size   || p.box_size               || existing.box_size || "",
          quantity:        Number(p.part_qty       ?? p.quantity       ?? existing.quantity)       || 0,
          net_wt_per_unit: Number(p.part_net_unit  ?? p.net_wt_per_unit ?? existing.net_wt_per_unit) || 0,
          no_of_boxes:     Number(p.part_no_of_boxes ?? p.no_of_boxes ?? existing.no_of_boxes) || 0,
          total_net_wt:    Number(p.part_total_net_wt ?? p.total_net_wt ?? existing.total_net_wt) || 0,
          gross_wt:        Number(p.part_gross     ?? p.gross_wt       ?? existing.gross_wt)      || 0,
        };
      });
    } else if (data.part_qty !== undefined || data.net_wt !== undefined || data.gross_wt !== undefined) {
      // Legacy flat-field path (no parts array sent)
      const currentPart = doc.parts && doc.parts[0] ? doc.parts[0] : {};
      data.parts = [
        {
          _id:             currentPart._id,
          part_no:         data.part_no      !== undefined ? data.part_no      : (currentPart.part_no  || "UNKNOWN"),
          part_desc:       data.part_desc    !== undefined ? data.part_desc    : (currentPart.part_desc || ""),
          box_size:        data.box_size     !== undefined ? data.box_size     : (currentPart.box_size  || ""),
          quantity:        data.part_qty     !== undefined ? Number(data.part_qty)     : (currentPart.quantity       || 0),
          net_wt_per_unit: data.net_wt       !== undefined ? Number(data.net_wt)       : (currentPart.net_wt_per_unit || 0),
          no_of_boxes:     data.part_no_of_boxes !== undefined ? Number(data.part_no_of_boxes) : (currentPart.no_of_boxes || 0),
          total_net_wt:    data.part_total_net_wt !== undefined ? Number(data.part_total_net_wt) : (currentPart.total_net_wt || 0),
          gross_wt:        data.gross_wt     !== undefined ? Number(data.gross_wt)     : (currentPart.gross_wt       || 0),
        }
      ];
    }

    // Preserve flat totals so pre-save hook can sync them
    if (data.total_qty      !== undefined) data.total_qty      = Number(data.total_qty);
    if (data.total_net_wt   !== undefined) data.total_net_wt   = Number(data.total_net_wt);
    if (data.total_gross_wt !== undefined) data.total_gross_wt = Number(data.total_gross_wt);
    if (data.total_no_of_boxes !== undefined) data.total_no_of_boxes = Number(data.total_no_of_boxes);

    Object.assign(doc, data);
    await doc.save();
    console.log("[updateShipment] saved — sb_no:", doc.sb_no, "| sb_date:", doc.sb_date, "| final_delivery_date:", doc.final_delivery_date);

    res.json({ success: true, shipment: doc });
  } catch (err) {
    console.error("UPDATE ERROR:", err);
    res.status(500).json({ message: "Update failed" });
  }
};

exports.updateDeliveryStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid shipment ID" });
    }
    await shipment.findByIdAndUpdate(req.params.id, {
      delivery_status: req.body.delivery_status,
    });
    res.json({ success: true });
  } catch (e) {
    console.log(e);
    res.status(500).json({ success: false });
  }
};

exports.updateManualDesc = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid shipment ID" });
    }
    await shipment.findByIdAndUpdate(req.params.id, {
      manual_desc: req.body.manual_desc,
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
};

exports.bulkUploadShipments = async (req, res) => {
  try {
    const incoming = req.files?.file || req.files?.files;
    const file = Array.isArray(incoming) ? incoming[0] : incoming;

    if (!file) {
      return res.status(400).json({ error: "Please upload a CSV/XLSX file" });
    }

    const filePath = file.tempFilePath || file.path;
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) return res.status(400).json({ error: "File is empty" });

    const existingShipments = await shipment.find({}, { enquiry_no: 1 }).lean();
    const existingSet = new Set(existingShipments.map(s => s.enquiry_no));
    
    const uploadBatchId = `BATCH-${Date.now()}`;
    const validDocs = [];
    const duplicates = [];

    rows.forEach((row) => {
      const normalizedRow = {};
      Object.keys(row).forEach(key => {
        const standardKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        normalizedRow[standardKey] = row[key];
      });

      const rawDoc = {
        enquiry_no: normalizedRow.enquiryno || normalizedRow.shipmentno || normalizedRow.qmrelno,
        supplier_name: normalizedRow.suppliername || normalizedRow.supplier,
        customer: normalizedRow.customername || normalizedRow.customer,
        ff: normalizedRow.ff || normalizedRow.freightforwarder,
        invoice_no: normalizedRow.invoiceno || normalizedRow.invoice,
        invoice_date:        normalizedRow.invoicedate  || normalizedRow.invoicedt,
        incoterm:            normalizedRow.incoterm     || normalizedRow.incoterms,
        mode: normalizedRow.mode || normalizedRow.shipmentmode,
        container_no:        normalizedRow.containerno  || normalizedRow.container    || normalizedRow.containernumber,
        bl_no: normalizedRow.blno || normalizedRow.billoflading,
        pol: normalizedRow.pol || normalizedRow.portofloading,
        etd:                 normalizedRow.etd || null,   // ✅ ADDED — was completely missing before
        final_delivery_date: normalizedRow.finaldelivery || normalizedRow.deliverydate || normalizedRow.eta,
        uploadBatchId
      };

      const cleanDoc = normalize(rawDoc);

      const quantity = Number(normalizedRow.qty || normalizedRow.partqty || normalizedRow.quantity) || 0;
      const netWt = Number(normalizedRow.netwt || normalizedRow.netweight) || 0;
      const noOfBoxes    = Number(normalizedRow.totalboxes  || normalizedRow.noofboxes  || normalizedRow.boxes)      || 0; // ✅ FIXED key
      const totalNetWt   = Number(normalizedRow.totalnetwt  || normalizedRow.netwt      || normalizedRow.netweight)  || 0; // ✅ FIXED key
      const totalGrossWt = Number(normalizedRow.totalgrosswt|| normalizedRow.grosswt    || normalizedRow.grossweight) || 0; // ✅ FIXED key
      const netWtPerUnit = quantity > 0 ? totalNetWt / quantity : 0;
      cleanDoc.parts = [
        {
          part_no: normalizedRow.partno || normalizedRow.partnumber || "UNKNOWN",
          part_desc: normalizedRow.partdescription || normalizedRow.partdesc || normalizedRow.description || "",
          box_size: normalizedRow.boxsize || "",
          quantity: quantity,
          net_wt_per_unit: netWtPerUnit,
          no_of_boxes: noOfBoxes,
          gross_wt: totalGrossWt
        }
      ];

      cleanDoc.total_parts_count = quantity;
      cleanDoc.total_no_of_boxes = noOfBoxes;  
      cleanDoc.total_gross_weight = totalGrossWt;
      cleanDoc.total_net_weight = totalNetWt;

      if (existingSet.has(cleanDoc.enquiry_no)) {
        duplicates.push(cleanDoc.enquiry_no);
      } else {
        validDocs.push({
          ...cleanDoc,
          status: "ACTIVE",
          delivery_status: "IN_PROCESS"
        });
        existingSet.add(cleanDoc.enquiry_no);
      }
    });

    if (validDocs.length > 0) {
      await shipment.insertMany(validDocs, { ordered: false });
    }

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({ 
      success: true, 
      inserted: validDocs.length, 
      skippedDuplicates: duplicates.length,
      batchId: uploadBatchId 
    });

  } catch (err) {
    console.error("BULK ERROR:", err);
    res.status(500).json({ error: "Bulk upload failed: " + err.message });
  }
};

exports.getEnquiryNumber = async (req, res) => {
  try {
    const shortYear = new Date().getFullYear().toString().slice(-2);
    const prefix = `QMR${shortYear}`;

    const lastRecord = await shipment
      .findOne({ enquiry_no: new RegExp(`^${prefix}`) })
      .sort({ enquiry_no: -1 });

    let seq = 5001;

    if (lastRecord && lastRecord.enquiry_no) {
      const lastSeqStr = lastRecord.enquiry_no.replace(prefix, "");
      const lastSeqNum = parseInt(lastSeqStr, 10);
      if (!isNaN(lastSeqNum)) {
        seq = lastSeqNum + 1;
      }
    }

    res.json({ enquiryNo: `${prefix}${seq}` });
  } catch (err) {
    console.error("Enquiry generation error:", err);
    res.status(500).json({ error: "Failed to generate enquiry number" });
  }
};
exports.fetchAllShipments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    // ✅ FIX — "All Entries" is a real backend mode (pageSize=all) instead of
    // relying on the frontend sending an arbitrarily large numeric limit.
    // When requested, skip/limit are omitted so the complete filtered/sorted
    // result set is returned in one query.
    const isAllEntries = req.query.pageSize === "all";
    const limit = isAllEntries ? 0 : (parseInt(req.query.pageSize) || 10);
    const skip = isAllEntries ? 0 : (page - 1) * limit;

    const matchQuery = {
      status: { $ne: "DELETED" },
    };

    if (req.query?.search) {
      matchQuery["$or"] = [
        { enquiry_no: { $regex: req.query.search, $options: "i" } },
        { supplier_name: { $regex: req.query.search, $options: "i" } },
        { customer: { $regex: req.query.search, $options: "i" } },
        { bl_no: { $regex: req.query.search, $options: "i" } },
        // ✅ NEW — added Invoice No so the search bar can also match invoice_no
        { invoice_no:    { $regex: req.query.search, $options: "i" } },
         { "parts.part_no": { $regex: req.query.search, $options: "i" } },
          { mode: { $regex: req.query.search, $options: "i" } }
      ];
    }

    // ✅ FIX — ETD Date Range / Supplier ETD Date Range must be applied as a
    // real backend query against the full collection (previously these were
    // only filtered on the frontend against whichever page happened to be
    // loaded). Dates are widened to full-day boundaries so "From"/"To" are
    // inclusive on both ends, matching the previous client-side behaviour.
    if (req.query?.etdFrom || req.query?.etdTo) {
      matchQuery.etd = {};
      if (req.query.etdFrom) {
        const from = new Date(req.query.etdFrom);
        if (!Number.isNaN(from.getTime())) {
          from.setHours(0, 0, 0, 0);
          matchQuery.etd.$gte = from;
        }
      }
      if (req.query.etdTo) {
        const to = new Date(req.query.etdTo);
        if (!Number.isNaN(to.getTime())) {
          to.setHours(23, 59, 59, 999);
          matchQuery.etd.$lte = to;
        }
      }
      if (Object.keys(matchQuery.etd).length === 0) delete matchQuery.etd;
    }

    if (req.query?.supplierEtdFrom || req.query?.supplierEtdTo) {
      matchQuery.supplier_etd = {};
      if (req.query.supplierEtdFrom) {
        const from = new Date(req.query.supplierEtdFrom);
        if (!Number.isNaN(from.getTime())) {
          from.setHours(0, 0, 0, 0);
          matchQuery.supplier_etd.$gte = from;
        }
      }
      if (req.query.supplierEtdTo) {
        const to = new Date(req.query.supplierEtdTo);
        if (!Number.isNaN(to.getTime())) {
          to.setHours(23, 59, 59, 999);
          matchQuery.supplier_etd.$lte = to;
        }
      }
      if (Object.keys(matchQuery.supplier_etd).length === 0) delete matchQuery.supplier_etd;
    }

    const total = await shipment.countDocuments(matchQuery);

    // ✅ FIX — sort is now driven by the query too (defaulting to createdAt),
    // so "Oldest → Newest" / "Newest → Oldest" on the ETD / Supplier ETD
    // columns sorts the entire matching result set before pagination is
    // applied, instead of only re-ordering the rows already on screen.
    // Supplier ETD sort takes precedence when both are supplied, matching
    // the previous frontend-only behaviour.
    let sortStage = { createdAt: -1 };
    if (req.query?.supplierEtdSort === "asc") sortStage = { supplier_etd: 1 };
    else if (req.query?.supplierEtdSort === "desc") sortStage = { supplier_etd: -1 };
    else if (req.query?.etdSort === "asc") sortStage = { etd: 1 };
    else if (req.query?.etdSort === "desc") sortStage = { etd: -1 };

    const pipeline = [
      { $match: matchQuery },
      { $sort: sortStage },
    ];
    // Only paginate when a specific page size was requested — "All Entries"
    // returns every matching record from the full, already-filtered query.
    if (!isAllEntries) {
      pipeline.push({ $skip: skip }, { $limit: limit });
    }
    pipeline.push({
      // Explicit projection forces MongoDB to return computed values for both structures
      $project: {
        _id: 1,
        ff: 1,
        invoice_no: 1,
        invoice_date: 1,
        enquiry_no: 1,
        supplier_name: 1,
        customer: 1,
        incoterm: 1,
        mode: 1,
        etd: 1,
        sb_no: 1,
        sb_date: 1,
        final_delivery_date: 1,
        bl_no: 1,
        container_no: 1,
        pol: 1,
        status: 1,
        delivery_status: 1,
        manual_desc: 1,
        parts: 1,
        createdAt: 1, // NEW — needed by the Logistics Dashboard to group real shipments by month
        total_no_of_boxes: { $ifNull: ["$total_no_of_boxes", { $ifNull: ["$total_boxes", { $ifNull: ["$part_boxes", 0] }] }] },
        total_gross_weight: { $ifNull: ["$total_gross_weight", { $ifNull: ["$total_gross_wt", { $ifNull: ["$gross_wt", 0] }] }] },
        total_net_weight: { $ifNull: ["$total_net_weight", { $ifNull: ["$total_net_wt", { $ifNull: ["$net_wt", 0] }] }] },
      }
    });

    const shipments = await shipment.aggregate(pipeline);

    res.set("x-total-count", String(total));
    return res.json(shipments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch shipments" });
  }
};

// ✅ NEW — was imported by routes.js and called by the edit-shipment wizard
// (frontend/src/wizard/Wizard.js, GET /shipment/:id fallback fetch when a
// user opens an edit link directly instead of navigating from the list)
// but was never actually implemented, so that fetch was 404-ing.
exports.getShipmentById = async (req, res) => {
  try {
    const doc = await shipment.findOne({ _id: req.params.id, status: { $ne: "DELETED" } }).lean();
    if (!doc) return res.status(404).json({ message: "Shipment not found" });
    res.json(doc);
  } catch (err) {
    console.error("Get shipment by id error:", err);
    res.status(500).json({ message: "Failed to fetch shipment" });
  }
};

exports.fetchPartAnalytics = async (req, res) => {
  try {
    const partNo = (req.params.partNo || "").trim();
    if (!partNo) return res.status(400).json({ message: "Part number is required" });

    let partNoRegex;
    try {
      partNoRegex = buildPartNoRegex(partNo);
    } catch (e) {
      return res.status(400).json({ message: "Invalid part number search term" });
    }

    // Only pull shipments that actually contain this part, and only the
    // matching part sub-documents — keeps this fast even on very large
    // shipment collections. Match is case-insensitive, partial, and ignores
    // spaces/dashes on both sides (see buildPartNoRegex above).
    let docs;
    try {
      docs = await shipment.aggregate([
        {
          $match: {
            status: { $ne: "DELETED" },
            "parts.part_no": { $regex: partNoRegex },
          },
        },
        {
          $project: {
            enquiry_no: 1,
            customer: 1,
            supplier_name: 1,
            invoice_no: 1,
            bl_no: 1,
            etd: 1,
            final_delivery_date: 1,
            status: 1,
            delivery_status: 1,
            createdAt: 1,
            parts: {
              $filter: {
                input: "$parts",
                as: "p",
                cond: { $regexMatch: { input: "$$p.part_no", regex: partNoRegex } },
              },
            },
          },
        },
      ]);
    } catch (dbErr) {
      console.error("Part analytics DB query error:", dbErr);
      return res.status(500).json({ message: "Database query failed" });
    }

    if (!docs.length) {
      // Meaningful message instead of a generic failure — matches spec:
      // "No shipment found for Part Number P04448" style messaging.
      return res.json({ partNo, found: false, message: `No shipment found for Part Number ${partNo}` });
    }

    // ── Flatten into one row per shipment (summing qty if the part
    // appears more than once inside the same shipment's parts array) ──────
    const rows = docs.map((d) => {
      const deliveryStatus = computeDeliveryStatus(d);
      const qty = sumPartsQty(d.parts);
      return {
        id: d._id,
        partNo,
        customer: d.customer || "",
        supplier: d.supplier_name || "",
        qmrel: d.enquiry_no || "",
        etd: d.etd || null,
        eta: d.final_delivery_date || null, // "ETA" mirrors the existing app's use of Final Delivery Date
        invoiceNo: d.invoice_no || "",
        blNo: d.bl_no || "",
        quantity: qty,
        shipmentStatus: d.status || "ACTIVE",
        deliveryStatus,
        transitDays: transitDays(d.etd, d.final_delivery_date),
        createdAt: d.createdAt || null,
      };
    });

    // Latest shipment first, per the Part Number Analytics spec.
    rows.sort((a, b) => new Date(b.etd || b.createdAt || 0) - new Date(a.etd || a.createdAt || 0));

    const activeRows = rows.filter((r) => r.shipmentStatus !== "CANCELLED");
    const cancelledRows = rows.filter((r) => r.shipmentStatus === "CANCELLED");

    const completedRows = activeRows.filter((r) => r.deliveryStatus === "DELIVERED");
    const inProgressRows = activeRows.filter((r) => r.deliveryStatus === "IN_TRANSIT");
    const pendingRows = activeRows.filter((r) => r.deliveryStatus === "IN_PROCESS");
    const delayedRows = activeRows.filter((r) => r.deliveryStatus === "DELAYED");

    const qtyOf = (arr) => arr.reduce((s, r) => s + r.quantity, 0);
    const totalQtyOrdered = qtyOf(activeRows);
    const completedQty = qtyOf(completedRows);
    const inProgressQty = qtyOf(inProgressRows);
    const pendingQty = qtyOf(pendingRows);
    const delayedQty = qtyOf(delayedRows);
    const totalQtyShipped = completedQty + inProgressQty; // has left the supplier
    const totalQtyPending = pendingQty + delayedQty;

    const customers = [...new Set(rows.map((r) => r.customer).filter(Boolean))];
    const suppliers = [...new Set(rows.map((r) => r.supplier).filter(Boolean))];
    const qmrelNumbers = [...new Set(rows.map((r) => r.qmrel).filter(Boolean))];

    const finalizedForSuccess = completedRows.length + delayedRows.length;
    const successRate = finalizedForSuccess > 0 ? Math.round((completedRows.length / finalizedForSuccess) * 100) : null;

    const transitSamples = completedRows.map((r) => r.transitDays).filter((d) => d != null);
    const avgDeliveryTimeDays =
      transitSamples.length > 0 ? Math.round((transitSamples.reduce((a, b) => a + b, 0) / transitSamples.length) * 10) / 10 : null;
    const totalTransitTimeDays = transitSamples.reduce((a, b) => a + b, 0);

    const percentCompleted = totalQtyOrdered > 0 ? Math.round((totalQtyShipped / totalQtyOrdered) * 100) : 0;

    // ── Timeline ──────────────────────────────────────────────────────────
    const etdDates = rows.map((r) => r.etd).filter(Boolean).map((d) => new Date(d));
    const firstShipmentDate = etdDates.length ? new Date(Math.min(...etdDates)) : null;
    const latestShipmentDate = etdDates.length ? new Date(Math.max(...etdDates)) : null;
    const upcomingEtas = activeRows
      .filter((r) => r.deliveryStatus !== "DELIVERED" && r.eta)
      .map((r) => new Date(r.eta))
      .filter((d) => d.getTime() >= Date.now());
    const expectedDeliveryDate = upcomingEtas.length ? new Date(Math.min(...upcomingEtas)) : null;

    // ── Charts (grouped by ETD month) ────────────────────────────────────
    const monthlyMap = {};
    const qtyShippedMap = {};
    const qtyPendingMap = {};
    rows.forEach((r) => {
      if (!r.etd) return;
      const k = monthKey(r.etd);
      if (!k) return;
      monthlyMap[k] = (monthlyMap[k] || 0) + 1;
      if (r.deliveryStatus === "IN_TRANSIT" || r.deliveryStatus === "DELIVERED") {
        qtyShippedMap[k] = (qtyShippedMap[k] || 0) + r.quantity;
      }
      if (r.deliveryStatus === "IN_PROCESS" || r.deliveryStatus === "DELAYED") {
        qtyPendingMap[k] = (qtyPendingMap[k] || 0) + r.quantity;
      }
    });
    const toSeries = (map, valueKey) =>
      Object.keys(map)
        .sort()
        .map((k) => ({ month: monthLabel(k), [valueKey]: map[k] }));

    const STATUS_COLORS = {
      Completed: "#065F46",
      "In Progress": "#1E40AF",
      Pending: "#92400E",
      Delayed: "#991B1B",
      Cancelled: "#64748B",
    };
    const statusPie = [
      { label: "Completed", count: completedRows.length, color: STATUS_COLORS.Completed },
      { label: "In Progress", count: inProgressRows.length, color: STATUS_COLORS["In Progress"] },
      { label: "Pending", count: pendingRows.length, color: STATUS_COLORS.Pending },
      { label: "Delayed", count: delayedRows.length, color: STATUS_COLORS.Delayed },
      { label: "Cancelled", count: cancelledRows.length, color: STATUS_COLORS.Cancelled },
    ];

    const deliveryPerformance = [
      { label: "Completed On Record", count: completedRows.length },
      { label: "Delayed", count: delayedRows.length },
    ];

    res.json({
      partNo,
      found: true,
      basicDetails: {
        partNo,
        customers,
        suppliers,
        qmrelNumbers,
        totalQuantityOrdered: totalQtyOrdered,
        totalQuantityShipped: totalQtyShipped,
        totalQuantityPending: totalQtyPending,
        shipmentsCompleted: completedRows.length,
        shipmentsInProgress: inProgressRows.length,
        shipmentsCancelled: cancelledRows.length,
        shipmentsPending: pendingRows.length,
      },
      shipmentAnalytics: {
        totalShipmentsCreated: rows.length,
        totalPartsSold: totalQtyOrdered,
        totalPartsShipped: totalQtyShipped,
        remainingQuantity: totalQtyPending,
        percentCompleted,
        successRate, // null => not enough finalized (completed+delayed) shipments yet
        avgDeliveryTimeDays, // null => no completed shipment has both ETD and Final Delivery Date
        totalTransitTimeDays,
      },
      progress: {
        totalQuantity: totalQtyOrdered,
        completedQty,
        completedPct: totalQtyOrdered > 0 ? Math.round((completedQty / totalQtyOrdered) * 100) : 0,
        inProgressQty,
        inProgressPct: totalQtyOrdered > 0 ? Math.round((inProgressQty / totalQtyOrdered) * 100) : 0,
        pendingQty: pendingQty + delayedQty,
        pendingPct: totalQtyOrdered > 0 ? Math.round(((pendingQty + delayedQty) / totalQtyOrdered) * 100) : 0,
      },
      statusSummary: {
        totalShipments: rows.length,
        totalPartsOrdered: totalQtyOrdered,
        totalPartsDelivered: completedQty,
        totalPendingQuantity: totalQtyPending,
        totalDelayedShipments: delayedRows.length,
        totalCompletedShipments: completedRows.length,
      },
      timeline: {
        firstShipmentDate,
        latestShipmentDate,
        expectedDeliveryDate, // null => no upcoming (future) delivery date among unfinished shipments
        avgShipmentDurationDays: avgDeliveryTimeDays,
      },
      charts: {
        monthlyShipments: toSeries(monthlyMap, "count"),
        quantityShipped: toSeries(qtyShippedMap, "qty"),
        quantityPending: toSeries(qtyPendingMap, "qty"),
        statusPie,
        deliveryPerformance,
      },
      history: rows,
    });
  } catch (err) {
    console.error("Part analytics error:", err);
    res.status(500).json({ message: "Database query failed" });
  }
};

// ──────────────────────────────────────────────────────────────────────────
// FEATURE 2 — ETD Date Based Shipment Search
// GET /shipment/search-by-etd
// Query params: date | fromDate/toDate, plus optional filters: customer,
// supplier, partNo, status, deliveryStatus. page/pageSize for the table;
// summary cards always reflect the FULL matched set (computed via
// aggregation, not just the current page) so they stay correct while
// paging through large result sets.
// ──────────────────────────────────────────────────────────────────────────
exports.searchShipmentsByEtd = async (req, res) => {
  try {
    const { date, fromDate, toDate, customer, supplier, partNo, status, deliveryStatus } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.pageSize) || 50, 500);
    const skip = (page - 1) * limit;

    if (!date && !fromDate && !toDate) {
      return res.status(400).json({ message: "Provide a single ETD date or a fromDate/toDate range" });
    }

    // Validate every date param BEFORE building the query — never let an
    // invalid date silently become "Invalid Date" and turn into a
    // MongoDB comparison bug (which previously caused "no records"/500s).
    for (const [label, val] of [["date", date], ["fromDate", fromDate], ["toDate", toDate]]) {
      if (val && Number.isNaN(new Date(val).getTime())) {
        return res.status(400).json({ message: `Invalid ${label}. Use a valid calendar date.` });
      }
    }
    if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
      return res.status(400).json({ message: "fromDate cannot be after toDate" });
    }

    const match = { status: { $ne: "DELETED" } };

    if (date) {
      const d0 = new Date(date);
      d0.setHours(0, 0, 0, 0);
      const d1 = new Date(date);
      d1.setHours(23, 59, 59, 999);
      match.etd = { $gte: d0, $lte: d1 };
    } else {
      match.etd = {};
      if (fromDate) {
        const f = new Date(fromDate);
        f.setHours(0, 0, 0, 0);
        match.etd.$gte = f;
      }
      if (toDate) {
        const t = new Date(toDate);
        t.setHours(23, 59, 59, 999);
        match.etd.$lte = t;
      }
    }

    if (customer) match.customer = { $regex: escapeRegex(customer.trim()), $options: "i" };
    if (supplier) match.supplier_name = { $regex: escapeRegex(supplier.trim()), $options: "i" };
    if (partNo) match["parts.part_no"] = { $regex: buildPartNoRegex(partNo) };
    if (status) match.status = status;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // deliveryStatus is a COMPUTED field, so it can't be part of the initial
    // $match — we add it via $addFields first, then optionally filter on it.
    const basePipeline = [
      { $match: match },
      {
        $addFields: {
          computedDeliveryStatus: deliveryStatusMongoExpr(now),
          computedQty: { $sum: "$parts.quantity" },
        },
      },
    ];
    if (deliveryStatus) {
      basePipeline.push({ $match: { computedDeliveryStatus: deliveryStatus } });
    }

    // ── Paginated rows (oldest ETD first, per spec) + full-set summary,
    // in a single round trip via $facet — scales to large collections
    // since only the requested page of full documents is materialized. ────
    const [result] = await shipment.aggregate([
      ...basePipeline,
      {
        $facet: {
          rows: [
            { $sort: { etd: 1, createdAt: 1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                enquiry_no: 1,
                customer: 1,
                supplier_name: 1,
                parts: 1,
                etd: 1,
                final_delivery_date: 1,
                invoice_no: 1,
                bl_no: 1,
                status: 1,
                computedDeliveryStatus: 1,
                computedQty: 1,
              },
            },
          ],
          matchedCount: [{ $count: "count" }],
          summaryByStatus: [{ $group: { _id: "$computedDeliveryStatus", count: { $sum: 1 } } }],
          summaryTotals: [
            {
              $group: {
                _id: null,
                totalShipments: { $sum: 1 },
                totalQuantity: { $sum: "$computedQty" },
                customers: { $addToSet: "$customer" },
                suppliers: { $addToSet: "$supplier_name" },
              },
            },
          ],
        },
      },
    ]);

    const totalMatched = result.matchedCount[0]?.count || 0;

    const rows = result.rows.map((d) => ({
      id: d._id,
      etd: d.etd || null,
      eta: d.final_delivery_date || null,
      qmrel: d.enquiry_no || "",
      customer: d.customer || "",
      supplier: d.supplier_name || "",
      partNos: (d.parts || []).map((p) => p.part_no).filter(Boolean),
      quantity: d.computedQty || 0,
      invoiceNo: d.invoice_no || "",
      blNo: d.bl_no || "",
      shipmentStatus: d.status || "ACTIVE",
      deliveryStatus: d.computedDeliveryStatus,
      finalDeliveryDate: d.final_delivery_date || null,
      transitDays: transitDays(d.etd, d.final_delivery_date),
    }));

    const byStatus = {};
    result.summaryByStatus.forEach((s) => { byStatus[s._id] = s.count; });
    const totals = result.summaryTotals[0] || { totalShipments: 0, totalQuantity: 0, customers: [], suppliers: [] };

    res.set("x-total-count", String(totalMatched));
    res.json({
      rows,
      page,
      pageSize: limit,
      total: totalMatched,
      summary: {
        totalShipments: totals.totalShipments,
        completedShipments: byStatus.DELIVERED || 0,
        delivered: byStatus.DELIVERED || 0,
        inTransit: byStatus.IN_TRANSIT || 0,
        pending: byStatus.IN_PROCESS || 0,
        delayed: byStatus.DELAYED || 0,
        totalQuantity: totals.totalQuantity,
        totalCustomers: (totals.customers || []).filter(Boolean).length,
        totalSuppliers: (totals.suppliers || []).filter(Boolean).length,
      },
    });
  } catch (err) {
    console.error("ETD search error:", err);
    res.status(500).json({ message: "Database query failed" });
  }
};

exports.getShipmentByBl = async (req, res) => {
  try {
    const blNo = (req.params.blNo || "").trim();
    if (!blNo) return res.status(400).json({ message: "BL number is required" });

    const records = await shipment.find({ bl_no: { $regex: `^${blNo}$`, $options: "i" } }).sort({ createdAt: 1 }).lean();
    if (!records.length) return res.status(404).json({ message: "Shipment not found" });

    const first = records[0];
    const items = records.map((row, index) => {
      const qty = Number(row.total_parts_count || row.part_qty) || 0;
      const unitPrice = Number(row.unit_price || 0);

      return {
        srNo: index + 1,
        partNo: row.parts?.[0]?.part_no || row.part_no || "",
        partName: row.parts?.[0]?.part_desc || row.part_desc || "",
        description: row.parts?.[0]?.part_desc || row.part_desc || "",
        refPartInvNo: row.parts?.[0]?.part_no || row.part_no || "",
        hsnCode: row.hsn_code || "",
        qty,
        unitPrice,
        amount: qty * unitPrice,
      };
    });

    res.json({
      billTo: {
        companyName: first.customer || "",
        address: first.address || "",
        contactNumber: first.contact_number || "",
        blNo: first.bl_no || blNo,
        recipientEmail: first.notify_email || "",
      },
      invoiceNo: first.invoice_no || "",
      invoiceDate: first.invoice_date || first.createdAt || null,
      items,
      shipmentRows: records,
    });
  } catch (err) {
    console.error("Get shipment by BL error:", err);
    res.status(500).json({ message: err.message });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// GET /shipment/:id  — fetch one shipment by MongoDB _id for the edit form
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS WAS MISSING:
//   The route file imported getShipmentById and Wizard.js called
//   GET /shipment/:id on edit, but this handler was never defined in this
//   controller. Express had no GET /:id route registered, so the call
//   either 404'd or matched the wrong route. Wizard then fell back to
//   location.state, which only contained the aggregate $project subset
//   (parts[].net_wt_per_unit and parts[].box_size were present in the DB
//   but not surfaced by the list endpoint projection — so the edit form
//   always showed 0 / empty for those fields).
//
// FIX: Return the raw Mongoose document (.lean()) so ALL stored fields —
//   including parts[].net_wt_per_unit, parts[].box_size, parts[].gross_wt,
//   parts[].no_of_boxes, supplier_etd, etc. — reach the edit form.
//   No schema, validation, or save logic is changed.
// ─────────────────────────────────────────────────────────────────────────────
exports.getShipmentById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid shipment ID" });
    }
    const doc = await shipment.findById(id).lean();
    if (!doc) {
      return res.status(404).json({ message: "Shipment not found" });
    }
    res.json(doc);
  } catch (err) {
    console.error("getShipmentById error:", err);
    res.status(500).json({ message: err.message });
  }
};
