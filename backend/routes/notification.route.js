const express = require("express");
const { sendTrackingEmailNotification } = require("../controllers/notification.controller");
const router = express.Router();

router.post("/send-tracking-email", sendTrackingEmailNotification);    

module.exports = router;