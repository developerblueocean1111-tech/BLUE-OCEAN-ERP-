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

router.post("/create", optionalAuth, createEnquiry);
router.get("/stats", getEnquiryStats);
router.get("/filters", getFilterOptions);
router.get("/:id", getEnquiryById);
router.put("/update/:id", optionalAuth, updateEnquiry);
router.delete("/delete/:id", deleteEnquiry);
router.get("/", getAllEnquiries);

module.exports = router;
