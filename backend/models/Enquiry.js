const mongoose = require("mongoose");

const EnquirySchema = new mongoose.Schema(
  {
    enquiryNumber: { type: String, unique: true },
    customerName: { type: String },
    customerRFQDate: { type: Date, default: null },
    itemDescription: { type: String },
    partMapping: {
      customerPartNo: { type: String },
      customerPartName: { type: String },
      modifiedBOPartNo: { type: String },
      boPartName: { type: String },
    },

    poDetails: {
      supplierName: { type: String },
      poNumber: { type: String },
      dateOfIssue: { type: Date, default: null },
    },

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
