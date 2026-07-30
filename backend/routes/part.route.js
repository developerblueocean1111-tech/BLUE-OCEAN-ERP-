const express = require("express");
const router = express.Router();
const { searchParts, getPartByNumber } = require("../controllers/partmaster.controller");
const { getPartByNo, upsertPart } = require("../controllers/part.controller");

// ✅ Specific routes FIRST
router.get("/search", searchParts);
router.post("/", upsertPart);

// ✅ Wildcard routes LAST
router.get("/:partNumber", getPartByNumber);
router.get("/:partNo", getPartByNo);

module.exports = router;