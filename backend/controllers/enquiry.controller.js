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

// POST /api/v1/enquiry/create
exports.createEnquiry = async (req, res) => {
  try {
    const data = { ...req.body };

    if (!data.enquiryNumber || data.enquiryNumber === "auto") {
      data.enquiryNumber = await generateEnquiryNumber();
    }

    const existing = await Enquiry.findOne({ enquiryNumber: data.enquiryNumber });
    if (existing) {
      return res.status(400).json({ message: "Enquiry number already exists" });
    }
data.generatedBy = req.user?.name || data.generatedBy || "System";
    data.editHistory = [{
      section: "BO / Enquiry Details",
      sectionColor: "bo",
      description: "Enquiry record created",
    user: data.generatedBy, 
      timestamp: new Date(),
    }];

    const enquiry = await Enquiry.create(data);
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
    if (supplierName) filter["poDetails.supplierName"] = { $regex: supplierName, $options: "i" };
    if (inquiryNumber) filter.enquiryNumber = { $regex: inquiryNumber, $options: "i" };
    if (poNumber) filter["poDetails.poNumber"] = { $regex: poNumber, $options: "i" };
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
      { $match: { "poDetails.supplierName": { $exists: true, $ne: "" } } },
      { $group: { _id: "$poDetails.supplierName" } },
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
    const suppliers = await Enquiry.distinct("poDetails.supplierName");
    const generatedByList = await Enquiry.distinct("generatedBy");

    res.json({
      customers: customers.filter(Boolean),
      suppliers: suppliers.filter(Boolean),
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
    const user = req.user?.name || data.generatedBy || current.generatedBy || "System";  // CHANGED
 data.generatedBy = user; 
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

    // Detect PO changes
    if (data.poDetails) {
      const pd = data.poDetails;
      const cp = current.poDetails || {};
      if (
        norm(pd.supplierName) !== norm(cp.supplierName) ||
        norm(pd.poNumber) !== norm(cp.poNumber) ||
        normDate(pd.dateOfIssue) !== normDate(cp.dateOfIssue)
      ) {
        newEntries.push({ section: "PO Number Details", sectionColor: "po", description: "Updated PO Number Details", user, timestamp: now });
      }
    }

    // Always push at least one entry so every save is recorded
    if (newEntries.length === 0) {
      newEntries.push({ section: "General", sectionColor: "bo", description: "Enquiry record saved (no field changes detected)", user, timestamp: now });
    }

    const { enquiryNumber, ...setData } = data; // never overwrite enquiryNumber via $set
    const updated = await Enquiry.findByIdAndUpdate(
      req.params.id,
      { $set: setData, $push: { editHistory: { $each: newEntries } } },
      { new: true }
    );
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
