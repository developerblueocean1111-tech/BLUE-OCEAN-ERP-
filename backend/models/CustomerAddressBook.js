const mongoose = require("mongoose");

// ─────────────────────────────────────────────────────────────────────────
// ✅ NEW — Customer Address Book (Packing List generation only).
//
// Neither Shipment nor Enquiry stores a customer's address/Attn/phone/
// email anywhere (only Shipment.customer / Enquiry.customerName, a plain
// name string) — confirmed by inspecting both schemas before adding this.
// Rather than re-typing that block on every single Packing List, or
// bolting unrelated contact fields onto Shipment/Enquiry, this is its own
// small, optional lookup: saved once per customer (admin-managed, see
// controllers/customerAddressBook.controller.js), then auto-filled by
// matching Shipment.customer / Enquiry.customerName (case-insensitive).
// A customer with no saved entry here simply starts with blank fields on
// the Packing List form — nothing is invented, and nothing about the
// existing Shipment/Enquiry schema or APIs changes.
// ─────────────────────────────────────────────────────────────────────────
const CustomerAddressBookSchema = new mongoose.Schema(
  {
    // Matched case-insensitively against Shipment.customer at lookup time.
    customerName: { type: String, required: true, unique: true, trim: true },

    // "Customer / Consignee" block
    companyName: { type: String, default: "" }, // display name on the document, defaults to customerName if blank
    addressLines: { type: [String], default: [] }, // printed one per line, in order
    attn: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },

    // "Buyers Other Than Consignee" block. Per the reference sample this is
    // usually identical to the Consignee block, so it defaults to mirroring
    // it unless overridden here.
    buyerSameAsConsignee: { type: Boolean, default: true },
    buyerCompanyName: { type: String, default: "" },
    buyerAddressLines: { type: [String], default: [] },
    buyerAttn: { type: String, default: "" },
    buyerPhone: { type: String, default: "" },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.CustomerAddressBook || mongoose.model("CustomerAddressBook", CustomerAddressBookSchema);
