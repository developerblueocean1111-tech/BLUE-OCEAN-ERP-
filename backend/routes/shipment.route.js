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
  generateAllDocumentsZip,
  generateLabelDocument,   // ✅ NEW — Label Document
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
router.post("/:id/generate-all-documents", generateAllDocumentsZip);

// ── New: Label Document — Shipment List "Generate Document" → 6th option ──
// Same shape as the 5 document routes above: shipment-id-scoped. The
// user-entered PO Number(s) are printed on the label, not looked up
// against any collection (see the big comment block on
// generateLabelDocument in the controller for why).
router.post("/:id/generate-label", generateLabelDocument);

// BUG FIX: GET /:id was imported but never registered.
// Wizard.js calls GET /shipment/:id on edit to fetch the full document.
// Without this route, the call 404'd and Wizard fell back to location.state
// (the list-row snapshot) which lacked parts[].net_wt_per_unit & box_size.
// Must be AFTER all specific GET routes to avoid shadowing them.
router.get("/:id", getShipmentById);

module.exports = router;
