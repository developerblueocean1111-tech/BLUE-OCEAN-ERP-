const mongoose = require("mongoose");

const InvoiceItemSchema = new mongoose.Schema(
  {
    description: { type: String, default: "" },
    refPartInvNo: { type: String, default: "" },
    hsnCode: { type: String, default: "" },
    qty: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNo: { type: String, unique: true, required: true },
    invoiceDate: { type: Date, default: Date.now },
    billTo: {
      companyName: { type: String, default: "" },
      address: { type: String, default: "" },
      contactNumber: { type: String, default: "" },
      blNo: { type: String, default: "" },
    },
    items: { type: [InvoiceItemSchema], default: [] },
    totalAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Invoice || mongoose.model("Invoice", InvoiceSchema);