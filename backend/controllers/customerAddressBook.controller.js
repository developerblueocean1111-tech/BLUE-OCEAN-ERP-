const CustomerAddressBook = require("../models/CustomerAddressBook");

// ─────────────────────────────────────────────────────────────────────────
// ✅ NEW — minimal admin CRUD for the Customer Address Book (see
// models/CustomerAddressBook.js for why this exists). Fully isolated: its
// own model, own controller, own routes — nothing about any existing
// shipment/customer logic is touched. Used by the Packing List feature to
// auto-fill the Consignee/Buyer block, and lets the data actually be
// entered/maintained without reaching into the database by hand.
// ─────────────────────────────────────────────────────────────────────────

exports.listCustomerAddresses = async (req, res) => {
  try {
    const records = await CustomerAddressBook.find({}).sort({ customerName: 1 }).lean();
    res.json(records);
  } catch (err) {
    console.error("listCustomerAddresses error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getCustomerAddress = async (req, res) => {
  try {
    const name = (req.params.customerName || "").trim();
    if (!name) return res.status(400).json({ message: "customerName is required" });
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const record = await CustomerAddressBook.findOne({
      customerName: { $regex: `^\\s*${escaped}\\s*$`, $options: "i" },
    }).lean();
    if (!record) return res.status(404).json({ message: "No address book entry for this customer" });
    res.json(record);
  } catch (err) {
    console.error("getCustomerAddress error:", err);
    res.status(500).json({ message: err.message });
  }
};

// Upsert by customerName (case-sensitive key as typed) — lets the same
// endpoint be used to both create a new entry and edit an existing one.
exports.upsertCustomerAddress = async (req, res) => {
  try {
    const customerName = (req.body?.customerName || "").trim();
    if (!customerName) {
      return res.status(400).json({ message: "customerName is required" });
    }

    const {
      companyName = "",
      addressLines = [],
      attn = "",
      phone = "",
      email = "",
      buyerSameAsConsignee = true,
      buyerCompanyName = "",
      buyerAddressLines = [],
      buyerAttn = "",
      buyerPhone = "",
      isActive = true,
    } = req.body || {};

    const record = await CustomerAddressBook.findOneAndUpdate(
      { customerName },
      {
        $set: {
          companyName,
          addressLines: Array.isArray(addressLines) ? addressLines : [],
          attn,
          phone,
          email,
          buyerSameAsConsignee: !!buyerSameAsConsignee,
          buyerCompanyName,
          buyerAddressLines: Array.isArray(buyerAddressLines) ? buyerAddressLines : [],
          buyerAttn,
          buyerPhone,
          isActive: !!isActive,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    ).lean();

    res.status(201).json(record);
  } catch (err) {
    console.error("upsertCustomerAddress error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.deleteCustomerAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await CustomerAddressBook.findByIdAndDelete(id).lean();
    if (!deleted) return res.status(404).json({ message: "Address book entry not found" });
    res.json({ message: "Deleted", id });
  } catch (err) {
    console.error("deleteCustomerAddress error:", err);
    res.status(500).json({ message: err.message });
  }
};
