const express = require("express");
const { uploadFiles } = require("../controllers/file.controller");

const router = express.Router();

router.post("/upload", uploadFiles);

module.exports = router;