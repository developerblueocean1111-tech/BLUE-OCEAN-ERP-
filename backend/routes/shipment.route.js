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
// ✅ NEW — Dashboard Enhancement: Part Number Analytics + ETD Date Search.
// Purely additive; every route above is unchanged.
router.get("/part-analytics/:partNo", fetchPartAnalytics);
router.get("/search-by-etd", searchShipmentsByEtd);
router.get("/:id", getShipmentById);
router.get("/", fetchAllShipments)

module.exports = router;
