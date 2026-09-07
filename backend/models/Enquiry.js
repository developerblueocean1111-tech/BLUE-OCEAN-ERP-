const mongoose = require("mongoose");
const EnquirySchema = new mongoose.Schema(
  {
    enquiryNumber: { type: String },
    customerName: { type: String },
    customerRFQDate: { type: Date, default: null },
    itemDescription: { type: String },
    partMapping: {
      customerPartNo: { type: String },
      customerPartName: { type: String },
      modifiedBOPartNo: { type: String },
      boPartName: { type: String },
    },
    parts: [
      {
        _id: false,
        customerPartNo: { type: String, default: "" },
        customerPartName: { type: String, default: "" },
        modifiedBOPartNo: { type: String, default: "" },
        boPartName: { type: String, default: "" },
        isChildPart: { type: Boolean, default: false },
        children: [
          {
            _id: false,
            customerPartNo: { type: String, default: "" },
            customerPartName: { type: String, default: "" },
            modifiedBOPartNo: { type: String, default: "" },
            boPartName: { type: String, default: "" },
            isChildPart: { type: Boolean, default: true },
          },
        ],
      },
    ],
    poDetails: {
      supplierName: { type: String },
      poNumber: { type: String },
      dateOfIssue: { type: Date, default: null },
    },
    // ── ADDED: multiple suppliers assigned per Part, matched by Customer Part No ──
    // CHANGE: `suppliers` was `[{ type: String }]` — now each supplier is an object
    // so it can carry its own PO Number alongside its name.
    partSuppliers: [
      {
        _id: false,
        customerPartNo: { type: String, default: "" },
        suppliers: [
          {
            _id: false,
            name: { type: String, default: "" },     // CHANGE: was a plain string entry
            poNumber: { type: String, default: "" },  // ADDED: PO Number per supplier
            dateOfIssue: { type: String, default: "" }, // ADDED: Date of Issue per supplier
          },
        ],
      },
    ],
    generatedBy: { type: String, default: "System" },
    editHistory: [
      {
        section: { type: String },
        sectionColor: { type: String },
        description: { type: String },
        user: { type: String },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);
module.exports =
  mongoose.models.Enquiry ||
  mongoose.model("Enquiry", EnquirySchema);
