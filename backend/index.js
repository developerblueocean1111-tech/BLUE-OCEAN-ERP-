const express = require("express");
const app = express();
require('dotenv').config();

const shipmentRoutes = require("./routes/shipment.route");
const invoiceRoutes = require("./routes/invoice.route");
const partRoutes = require("./routes/part.route");
const fileRoutes = require("./routes/file.route");
const notificationRoutes = require("./routes/notification.route");
const enquiryRoutes = require("./routes/enquiry.route");
const authRoutes = require("./routes/auth.route");
const adminRoutes = require("./routes/admin.route");
// const cookieParser = require("cookie-parser");
const fileUpload = require("express-fileupload");
const cors = require("cors");

const database = require("./config/database");
const keepAlive = require("./keepAlive");

const PORT = process.env.PORT || 5000;

// Connecting to database
database.connect();

// middlewares
app.use(express.json());
// app.use(cookieParser());
app.use(
    cors({
        origin: "*",
        credentials: true,
    })
);
app.use(
    fileUpload({
		useTempFiles: true,
		tempFileDir: "/tmp",
	})
);

app.use("/api/v1/shipment", shipmentRoutes);
app.use("/api/shipment", shipmentRoutes);
app.use("/api/v1/invoice", invoiceRoutes);
app.use("/api/invoice", invoiceRoutes);
app.use("/api/v1/parts", partRoutes);
app.use("/api/parts", partRoutes);
app.use("/api/v1/files", fileRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/v1/notification", notificationRoutes);
app.use("/api/v1/enquiry", enquiryRoutes);
  app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);

// Testing the server
app.get("/", (req, res) => {
	return res.json({
		success: true,
		message: "Your server is up and running ...",
	});
});

// Keep-alive / uptime monitor target
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

// mongoDB Health
app.get("/api/v1/health", (req, res) => {
  res.json({
    status: "ONLINE",
    database: "MongoDB"
  });
});

app.get("/api/v1/test", (_, res) => {
  res.json({
    status: "OK",
    database: "MongoDB Atlas",
    timestamp: new Date().toISOString()
  });
});

// Listening to the server
app.listen(PORT, () => {
	console.log(`App is listening at ${PORT}`);
	keepAlive();
});
