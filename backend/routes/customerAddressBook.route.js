const express = require("express");
const router = express.Router();
const {
  listCustomerAddresses,
  getCustomerAddress,
  upsertCustomerAddress,
  deleteCustomerAddress,
} = require("../controllers/customerAddressBook.controller");

// ✅ NEW — Customer Address Book admin CRUD (Packing List feature only).
// Fully isolated route file, mounted separately in index.js — no existing
// route file or path is touched.
router.get("/", listCustomerAddresses);
router.post("/", upsertCustomerAddress);
router.get("/:customerName", getCustomerAddress);
router.delete("/:id", deleteCustomerAddress);

module.exports = router;
