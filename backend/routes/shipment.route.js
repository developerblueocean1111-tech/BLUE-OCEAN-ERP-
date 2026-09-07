const express = require("express");
const {
  fetchDashboardSummary,
  addShipment,
  updateDeliveryStatus,
  updateManualDesc,
  updateShipment,
  bulkUploadShipments,
  getEnquiryNumber,
  fetchAllShipments,
  getShipmentByBl,
   getShipmentById,  
  fetchPartAnalytics,
  searchShipmentsByEtd,
  listDocumentTypes,
  previewDocument,
  generateDocument,
} = require("../controllers/shipment.controller");
const router = express.Router();

router.get("/dashboard", fetchDashboardSummary);
router.post("/", addShipment);
router.patch("/:id", updateShipment);
router.patch("/delivery-status/:id", updateDeliveryStatus);
router.patch("/manual-desc/:id", updateManualDesc);
router.post("/bulk-upload", bulkUploadShipments);
router.get("/enquiry-number", getEnquiryNumber);
router.get("/by-bl/:blNo", getShipmentByBl);

// ── New: Dashboard Enhancement — Part Number Analytics + ETD Search ──────
router.get("/search-by-etd", searchShipmentsByEtd);
router.get("/part-analytics/:partNo", fetchPartAnalytics);

router.get("/", fetchAllShipments);

// ── New: Document Generation — Logistics → Shipment List "Generate Document" ──
// Must be registered BEFORE the catch-all GET /:id below so ":id" doesn't
// swallow these more specific paths.
router.get("/:id/document-types", listDocumentTypes);
router.get("/:id/generate-document/:docType/preview", previewDocument);
router.post("/:id/generate-document/:docType", generateDocument);

// BUG FIX: GET /:id was imported but never registered.
// Wizard.js calls GET /shipment/:id on edit to fetch the full document.
// Without this route, the call 404'd and Wizard fell back to location.state
// (the list-row snapshot) which lacked parts[].net_wt_per_unit & box_size.
// Must be AFTER all specific GET routes to avoid shadowing them.
router.get("/:id", getShipmentById);

module.exports = router;
