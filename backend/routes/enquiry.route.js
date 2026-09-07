const express = require("express");
const { optionalAuth } = require("../middleware/auth"); 
const {
  createEnquiry,
  getAllEnquiries,
  getEnquiryStats,
  getFilterOptions,
  getEnquiryById,
  updateEnquiry,
  deleteEnquiry,
} = require("../controllers/enquiry.controller");

const router = express.Router();

// Ensure enquiry GET responses are never cached by the browser or any CDN/proxy
// in front of the deployed backend — prevents stale data (e.g. a just-added
// supplier/PO/date entry) from being served after an update.
router.use((req, res, next) => {
  if (req.method === "GET") {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});

router.post("/create", optionalAuth, createEnquiry);
router.get("/stats", getEnquiryStats);
router.get("/filters", getFilterOptions);
router.get("/:id", getEnquiryById);
router.put("/update/:id", optionalAuth, updateEnquiry);
router.delete("/delete/:id", deleteEnquiry);
router.get("/", getAllEnquiries);

module.exports = router;
