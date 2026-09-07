const Enquiry = require("../models/Enquiry");

// Generate next enquiry number
// Updated function in enquiry.controller.js
// Updated function in enquiry.controller.js
async function generateEnquiryNumber() {
  // Get last two digits of the year (e.g., 2026 -> 26)
  const year = new Date().getFullYear().toString().slice(-2); 
  const prefix = `ENQ-${year}-`;

  // Find the latest record for THIS specific year prefix
  const last = await Enquiry.findOne({ enquiryNumber: { $regex: `^${prefix}` } })
    .sort({ enquiryNumber: -1 })
    .lean();

  let nextNum = 1;
  if (last) {
    const parts = last.enquiryNumber.split("-");
    // parts[2] corresponds to 'XXX' in ENQ-YY-XXX
    nextNum = parseInt(parts[2], 10) + 1;
  }
  
  // Format to 3 digits (e.g., 001)
  return `${prefix}${String(nextNum).padStart(3, "0")}`;
}

// Normalize the poDetails block coming from the client so a bad/empty date
// string never silently fails to cast and drops the whole sub-object.
function normalizePoDetails(pd) {
  if (!pd || typeof pd !== "object") return { supplierName: "", poNumber: "", dateOfIssue: null };
  const rawDate = pd.dateOfIssue;
  let dateOfIssue = null;
  if (rawDate) {
    const d = new Date(rawDate);
    dateOfIssue = isNaN(d) ? null : d;
  }
  return {
    supplierName: pd.supplierName || "",
    poNumber: pd.poNumber || "",
    dateOfIssue,
  };
}

// Normalize the partSuppliers array (the "Assign Suppliers to Parts" block)
// so every entry has a clean shape before saving — guarantees this data is
// never dropped or malformed on save.
function normalizePartSuppliers(list) {
  if (!Array.isArray(list)) return [];
  return list.map((ps) => ({
    customerPartNo: ps?.customerPartNo || "",
    suppliers: Array.isArray(ps?.suppliers)
      ? ps.suppliers.map((s) => ({
          name: s?.name || "",
          poNumber: s?.poNumber || "",
          dateOfIssue: s?.dateOfIssue || "",
        }))
      : [],
  }));
}

// POST /api/v1/enquiry/create
exports.createEnquiry = async (req, res) => {
  try {
    const data = { ...req.body };

    if (!data.enquiryNumber || data.enquiryNumber === "auto") {
      data.enquiryNumber = await generateEnquiryNumber();
    }

    data.generatedBy = req.user?.name || data.generatedBy || "System";

    // Explicitly normalize PO Details / per-part suppliers before saving —
    // guarantees these are always written even if a field came through
    // empty/odd, instead of relying on the generic cast.
    data.poDetails = normalizePoDetails(data.poDetails);
    data.partSuppliers = normalizePartSuppliers(data.partSuppliers);

    data.editHistory = [{
      section: "BO / Enquiry Details",
      sectionColor: "bo",
      description: "Enquiry record created",
      user: data.generatedBy || "System",
      timestamp: new Date(),
    }];

    console.log("[createEnquiry] Incoming partSuppliers:", JSON.stringify(req.body.partSuppliers));
    console.log("[createEnquiry] Normalized partSuppliers to save:", JSON.stringify(data.partSuppliers));

    const enquiryDoc = new Enquiry(data);
    const enquiry = await enquiryDoc.save();

    console.log("[createEnquiry] Saved enquiry partSuppliers:", JSON.stringify(enquiry.partSuppliers));

    res.status(201).json(enquiry);
  } catch (err) {
    console.error("Create enquiry error:", err);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/v1/enquiry
exports.getAllEnquiries = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      customerName,
      supplierName,
      rfqDateFrom,
      rfqDateTo,
      inquiryNumber,
      poNumber,
      partNumber,
      generatedBy,
      search,
      sortField,
      sortOrder,
    } = req.query;

    const filter = {};

    if (customerName) filter.customerName = { $regex: customerName, $options: "i" };
    if (supplierName) {
      const supplierRegex = { $regex: supplierName, $options: "i" };
      filter.$and = (filter.$and || []).concat([
        {
          $or: [
            { "poDetails.supplierName": supplierRegex },
            { "poDetailsList.supplierName": supplierRegex },
          ],
        },
      ]);
    }
    if (inquiryNumber) filter.enquiryNumber = { $regex: inquiryNumber, $options: "i" };
    if (poNumber) {
      const poRegex = { $regex: poNumber, $options: "i" };
      filter.$and = (filter.$and || []).concat([
        {
          $or: [
            { "poDetails.poNumber": poRegex },
            { "poDetailsList.poNumber": poRegex },
          ],
        },
      ]);
    }
    if (partNumber) {
      filter.$or = [
        { "partMapping.customerPartNo": { $regex: partNumber, $options: "i" } },
        { "partMapping.modifiedBOPartNo": { $regex: partNumber, $options: "i" } },
      ];
    }
    if (generatedBy) filter.generatedBy = { $regex: generatedBy, $options: "i" };

    if (rfqDateFrom || rfqDateTo) {
      filter.customerRFQDate = {};
      if (rfqDateFrom) filter.customerRFQDate.$gte = new Date(rfqDateFrom);
      if (rfqDateTo) filter.customerRFQDate.$lte = new Date(rfqDateTo);
    }

    if (search) {
      const searchRegex = { $regex: search, $options: "i" };
      filter.$or = [
        { customerName: searchRegex },
        { enquiryNumber: searchRegex },
        { itemDescription: searchRegex },
        { "poDetails.supplierName": searchRegex },
        { "poDetails.poNumber": searchRegex },
        { "poDetailsList.supplierName": searchRegex },
        { "poDetailsList.poNumber": searchRegex },
        { "partMapping.customerPartNo": searchRegex },
        { "partMapping.customerPartName": searchRegex },
        { generatedBy: searchRegex },
      ];
    }

    const sort = {};
    if (sortField) {
      sort[sortField] = sortOrder === "desc" ? -1 : 1;
    } else {
      sort.createdAt = -1;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Enquiry.countDocuments(filter);
    const enquiries = await Enquiry.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      enquiries,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error("Get enquiries error:", err);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/v1/enquiry/stats
exports.getEnquiryStats = async (req, res) => {
  try {
    const totalEnquiries = await Enquiry.countDocuments();

    const activePOs = await Enquiry.countDocuments({
      "poDetails.poNumber": { $exists: true, $ne: "" },
    });

    const partMappings = await Enquiry.countDocuments({
      "partMapping.customerPartNo": { $exists: true, $ne: "" },
    });

    const suppliersAgg = await Enquiry.aggregate([
      {
        $project: {
          allSuppliers: {
            $setUnion: [
              {
                $cond: [
                  { $in: ["$poDetails.supplierName", [null, ""]] },
                  [],
                  ["$poDetails.supplierName"],
                ],
              },
              {
                $filter: {
                  input: { $ifNull: ["$poDetailsList.supplierName", []] },
                  as: "s",
                  cond: { $and: [{ $ne: ["$$s", null] }, { $ne: ["$$s", ""] }] },
                },
              },
            ],
          },
        },
      },
      { $unwind: "$allSuppliers" },
      { $group: { _id: "$allSuppliers" } },
      { $count: "count" },
    ]);
    const activeSuppliers = suppliersAgg.length > 0 ? suppliersAgg[0].count : 0;

    res.json({ totalEnquiries, activePOs, partMappings, activeSuppliers });
  } catch (err) {
    console.error("Get stats error:", err);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/v1/enquiry/filters
exports.getFilterOptions = async (req, res) => {
  try {
    const customers = await Enquiry.distinct("customerName");
    const legacySuppliers = await Enquiry.distinct("poDetails.supplierName");
    const multiSuppliers = await Enquiry.distinct("poDetailsList.supplierName");
    const generatedByList = await Enquiry.distinct("generatedBy");

    const suppliers = Array.from(
      new Set([...legacySuppliers, ...multiSuppliers].filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    res.json({
      customers: customers.filter(Boolean),
      suppliers,
      generatedByList: generatedByList.filter(Boolean),
    });
  } catch (err) {
    console.error("Get filters error:", err);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/v1/enquiry/:id
exports.getEnquiryById = async (req, res) => {
  try {
    const enquiry = await Enquiry.findById(req.params.id).lean();
    if (!enquiry) return res.status(404).json({ message: "Enquiry not found" });
    res.json(enquiry);
  } catch (err) {
    console.error("Get enquiry error:", err);
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/v1/enquiry/update/:id
exports.updateEnquiry = async (req, res) => {
  try {
    const current = await Enquiry.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ message: "Enquiry not found" });

    const data = req.body;
    const now = new Date();
    const user = data.generatedBy || current.generatedBy || "System";
    const newEntries = [];

    // Helper: normalize a value to a comparable string
    const norm = (v) => (v == null ? "" : String(v).trim());
    const normDate = (v) => {
      if (!v) return "";
      const d = new Date(v);
      return isNaN(d) ? "" : d.toISOString().split("T")[0];
    };

    // Detect BO section changes
    if (
      norm(data.customerName) !== norm(current.customerName) ||
      normDate(data.customerRFQDate) !== normDate(current.customerRFQDate) ||
      norm(data.itemDescription) !== norm(current.itemDescription)
    ) {
      newEntries.push({ section: "BO / Enquiry Details", sectionColor: "bo", description: "Updated BO / Enquiry Details", user, timestamp: now });
    }

    // Detect Part Mapping changes
    if (data.partMapping) {
      const pm = data.partMapping;
      const cp = current.partMapping || {};
      if (
        norm(pm.customerPartNo) !== norm(cp.customerPartNo) ||
        norm(pm.customerPartName) !== norm(cp.customerPartName) ||
        norm(pm.modifiedBOPartNo) !== norm(cp.modifiedBOPartNo) ||
        norm(pm.boPartName) !== norm(cp.boPartName)
      ) {
        newEntries.push({ section: "Part Number Mapping", sectionColor: "part", description: "Updated Part Number Mapping", user, timestamp: now });
      }
    }

    // Detect Parts (multi part / child part) changes
    if (data.parts) {
      const normalizeParts = (arr) =>
        JSON.stringify(
          (arr || []).map((p) => ({
            customerPartNo: norm(p.customerPartNo),
            customerPartName: norm(p.customerPartName),
            modifiedBOPartNo: norm(p.modifiedBOPartNo),
            boPartName: norm(p.boPartName),
            children: (p.children || []).map((c) => ({
              customerPartNo: norm(c.customerPartNo),
              customerPartName: norm(c.customerPartName),
              modifiedBOPartNo: norm(c.modifiedBOPartNo),
              boPartName: norm(c.boPartName),
            })),
          }))
        );
      if (normalizeParts(data.parts) !== normalizeParts(current.parts)) {
        newEntries.push({ section: "Part Number Mapping", sectionColor: "part", description: "Updated Parts Details (parent/child parts)", user, timestamp: now });
      }
    }

    // Detect PO changes (legacy single supplier/PO)
    let poChanged = false;
    if (data.poDetails) {
      const pd = data.poDetails;
      const cp = current.poDetails || {};
      if (
        norm(pd.supplierName) !== norm(cp.supplierName) ||
        norm(pd.poNumber) !== norm(cp.poNumber) ||
        normDate(pd.dateOfIssue) !== normDate(cp.dateOfIssue)
      ) {
        poChanged = true;
      }
    }

    // Detect PO changes (multi supplier / PO entries)
    if (data.poDetailsList) {
      const normalizePOs = (arr) =>
        JSON.stringify(
          (arr || []).map((p) => ({
            supplierName: norm(p.supplierName),
            poNumber: norm(p.poNumber),
            dateOfIssue: normDate(p.dateOfIssue),
            linkedPartNo: norm(p.linkedPartNo),
          }))
        );
      if (normalizePOs(data.poDetailsList) !== normalizePOs(current.poDetailsList)) {
        poChanged = true;
      }
    }

    if (poChanged) {
      newEntries.push({ section: "PO Number Details", sectionColor: "po", description: "Updated PO Number Details", user, timestamp: now });
    }

    // Always push at least one entry so every save is recorded
    if (newEntries.length === 0) {
      newEntries.push({ section: "General", sectionColor: "bo", description: "Enquiry record saved (no field changes detected)", user, timestamp: now });
    }

    const { enquiryNumber, ...setData } = data; // never overwrite enquiryNumber via $set

    // Explicitly normalize PO Details / per-part suppliers before saving —
    // guarantees these are always written even if a field came through
    // empty/odd, instead of relying on the generic $set to cast it correctly.
    if (Object.prototype.hasOwnProperty.call(setData, "poDetails")) {
      setData.poDetails = normalizePoDetails(setData.poDetails);
    }
    if (Object.prototype.hasOwnProperty.call(setData, "partSuppliers")) {
      setData.partSuppliers = normalizePartSuppliers(setData.partSuppliers);
    }

    console.log("[updateEnquiry] Incoming partSuppliers:", JSON.stringify(req.body.partSuppliers));
    console.log("[updateEnquiry] Normalized partSuppliers to save:", JSON.stringify(setData.partSuppliers));

    // Load as a live document (not .lean()) so we can use markModified —
    // this removes any possibility of a nested-object $set being skipped.
    const doc = await Enquiry.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Enquiry not found" });

    Object.assign(doc, setData);
    doc.markModified("poDetails");
    doc.markModified("partSuppliers");
    doc.editHistory.push(...newEntries);

    const updated = await doc.save();

    console.log("[updateEnquiry] Saved enquiry partSuppliers (from .save() return):", JSON.stringify(updated.partSuppliers));

    // Trust nothing: re-read the document fresh from the DB (bypassing any
    // in-memory Mongoose document state) and verify what actually landed.
    // If it doesn't match what we intended to write, something dropped it
    // during the real DB write — surface that loudly instead of returning
    // a 200 with silently-missing data.
    const verifyDoc = await Enquiry.findById(req.params.id).lean();
    const expectedCount = Array.isArray(setData.partSuppliers)
      ? setData.partSuppliers.reduce((sum, ps) => sum + (Array.isArray(ps.suppliers) ? ps.suppliers.length : 0), 0)
      : null;
    const actualCount = Array.isArray(verifyDoc?.partSuppliers)
      ? verifyDoc.partSuppliers.reduce((sum, ps) => sum + (Array.isArray(ps.suppliers) ? ps.suppliers.length : 0), 0)
      : 0;

    console.log("[updateEnquiry] Re-read from DB after save, partSuppliers:", JSON.stringify(verifyDoc?.partSuppliers));
    console.log(`[updateEnquiry] Expected supplier count: ${expectedCount}, actual count in DB: ${actualCount}`);

    if (Object.prototype.hasOwnProperty.call(setData, "partSuppliers") && expectedCount !== actualCount) {
      console.error("[updateEnquiry] SAVE VERIFICATION FAILED — data was silently dropped during write.", {
        enquiryId: req.params.id,
        sentByFrontend: req.body.partSuppliers,
        normalizedBeforeSave: setData.partSuppliers,
        actuallyInDbAfterSave: verifyDoc?.partSuppliers,
      });
      return res.status(500).json({
        message: `Save verification failed: expected ${expectedCount} supplier(s) but only ${actualCount} were actually persisted. The update was NOT fully applied — please retry. If this repeats, check the server logs for the exact entries that were dropped.`,
        expectedCount,
        actualCount,
      });
    }

    res.json(updated);
  } catch (err) {
    console.error("Update enquiry error:", err);
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/v1/enquiry/delete/:id
exports.deleteEnquiry = async (req, res) => {
  try {
    const deleted = await Enquiry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Enquiry not found" });
    res.json({ message: "Enquiry deleted successfully" });
  } catch (err) {
    console.error("Delete enquiry error:", err);
    res.status(500).json({ message: err.message });
  }
};
