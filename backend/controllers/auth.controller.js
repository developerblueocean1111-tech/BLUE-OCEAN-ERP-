const Employee = require("../models/Employee");
const EmployeePermission = require("../models/EmployeePermission");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { JWT_SECRET } = require("../middleware/auth");

const defaultModules = {
  enquiry: {
    visible: false,
    actions: { view: false, create: false, edit: false, delete: false }
  },
  invoice: {
    visible: false,
    actions: { view: false, create: false, edit: false, delete: false }
  },
  logistics: {
    visible: false,
    actions: { view: false, create: false, edit: false, delete: false }
  },
};

const adminModules = {
  enquiry: {
    visible: true,
    actions: { view: true, create: true, edit: true, delete: true }
  },
  invoice: {
    visible: true,
    actions: { view: true, create: true, edit: true, delete: true }
  },
  logistics: {
    visible: true,
    actions: { view: true, create: true, edit: true, delete: true }
  },
};

// POST /api/v1/auth/register
exports.register = async (req, res) => {
  try {
    const {
      name,
      employeeId,
      department,
      designation,
      phone,
      role,
      email,
      password,
      confirmPassword
    } = req.body;

    if (!name || !employeeId || !department || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters"
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match"
      });
    }

    const existing = await Employee.findOne({
      $or: [{ email }, { employeeId }]
    });

    if (existing) {
      const field =
        existing.email === email ? "Email" : "Employee ID";

      return res.status(409).json({
        success: false,
        message: `${field} already exists`
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const employee = await Employee.create({
      name,
      employeeId,
      department,
      designation: designation || "",
      phone: phone || "",
      role: role || "employee",
      email,
      password: hashedPassword,
    });

    const modules =
      role === "admin"
        ? adminModules
        : defaultModules;

    await EmployeePermission.create({
      employeeId: employee._id,
      modules
    });

    return res.status(201).json({
      success: true,
      message: "Registration successful. Please login."
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// POST /api/v1/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const employee = await Employee.findOne({ email });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email"
      });
    }

    if (!employee.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is disabled. Contact administrator."
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      employee.password
    );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password"
      });
    }

    // ===== FIX START =====
    let permissionsToReturn;

    if (employee.role === "admin") {
      // Admin always full access
      await EmployeePermission.findOneAndUpdate(
        { employeeId: employee._id },
        { $set: { modules: adminModules } },
        { upsert: true, new: true }
      );

      permissionsToReturn = adminModules;

    } else {
      let permDoc =
        await EmployeePermission.findOne({
          employeeId: employee._id
        });

      if (!permDoc) {
        permDoc =
          await EmployeePermission.create({
            employeeId: employee._id,
            modules: defaultModules
          });
      }

      permissionsToReturn = permDoc.modules;
    }
    // ===== FIX END =====

    const token = jwt.sign(
      {
        id: employee._id,
        role: employee.role,
        name: employee.name,
        employeeId: employee.employeeId
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.status(200).json({
      success: true,
      token,
      employee: {
        id: employee._id,
        name: employee.name,
        employeeId: employee.employeeId,
        department: employee.department,
        designation: employee.designation,
        phone: employee.phone,
        role: employee.role,
        email: employee.email,
      },
      permissions: permissionsToReturn,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// GET /api/v1/auth/me
exports.getMe = async (req, res) => {
  try {
    const employee = await Employee.findById(
      req.user.id
    ).select("-password");

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // ===== FIX START =====
    let permissionsToReturn;

    if (employee.role === "admin") {
      permissionsToReturn = adminModules;
    } else {
      const permDoc =
        await EmployeePermission.findOne({
          employeeId: employee._id
        });

      permissionsToReturn =
        permDoc ? permDoc.modules : {};
    }
    // ===== FIX END =====

    return res.status(200).json({
      success: true,
      employee: {
        id: employee._id,
        name: employee.name,
        employeeId: employee.employeeId,
        department: employee.department,
        designation: employee.designation,
        phone: employee.phone,
        role: employee.role,
        email: employee.email,
      },
      permissions: permissionsToReturn,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};
