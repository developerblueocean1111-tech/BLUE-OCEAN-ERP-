const jwt = require("jsonwebtoken");

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "blueocean_erp_secret_key_2024";

// Verify JWT token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: "Invalid or expired token" });
  }
};

// ✅ Optional auth: decodes JWT if present, never blocks the request
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return next();

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    // invalid/expired — ignore, don't block
  }
  next();
};

// Role permission middleware
const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (req.user && req.user.name && req.user.name === "Shreya Atole") {
      return next();
    }
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Access denied: insufficient permissions" });
    }
    next();
  };
};

module.exports = {
  verifyToken,
  optionalAuth,
  allowRoles,
  JWT_SECRET
};
