const express = require("express");

const {
  getAllEmployees,
  getPermissions,
  updatePermissions
} = require("../controllers/permission.controller");

const {
  verifyToken,
  allowRoles
} = require("../middleware/auth");

const router = express.Router();

/*
=====================================================
ADMIN ACCESS CONTROL ROUTES
=====================================================
*/

// Get all employees list
// TEMPORARY: allow admin + employee
// (Shreya Atole special access handled in auth middleware)

router.get(
  "/employees",
  verifyToken,
  allowRoles("admin", "employee"),
  getAllEmployees
);


// Get permissions of a specific employee
// TEMPORARY: allow admin + employee

router.get(
  "/permissions/:employeeId",
  verifyToken,
  allowRoles("admin", "employee"),
  getPermissions
);


// Update permissions of employee
// TEMPORARY: allow admin + employee

router.patch(
  "/permissions/:employeeId",
  verifyToken,
  allowRoles("admin", "employee"),
  updatePermissions
);


module.exports = router;
