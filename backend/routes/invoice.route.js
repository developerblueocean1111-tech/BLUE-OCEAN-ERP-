const express = require("express");
const {
  createInvoice,
  getInvoiceById,
  sendInvoice,
} = require("../controllers/invoice.controller");

const router = express.Router();

router.post("/create", createInvoice);
router.get("/get/:id", getInvoiceById);
router.post("/send/:id", sendInvoice);

module.exports = router;