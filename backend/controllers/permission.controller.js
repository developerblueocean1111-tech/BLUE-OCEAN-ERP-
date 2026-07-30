const Employee = require("../models/Employee");
const EmployeePermission = require("../models/EmployeePermission");

// GET /api/v1/employees  — admin only
exports.getAllEmployees = async (req, res) => {
  try {
    const employees = await Employee.find({}, "name employeeId department role email");
    const permissions = await EmployeePermission.find({});

    const result = employees.map((emp) => {
      const perm = permissions.find((p) => p.employeeId.toString() === emp._id.toString());
      const enabledModules = perm
        ? Object.entries(perm.modules)
            .filter(([, v]) => v.visible)
            .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1))
            .join(", ")
        : "None";
      return {
        id: emp._id,
        name: emp.name,
        employeeId: emp.employeeId,
        department: emp.department,
        role: emp.role,
        email: emp.email,
        enabledModules,
      };
    });

    return res.status(200).json({ success: true, employees: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/v1/permissions/:employeeId
exports.getPermissions = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    let perm = await EmployeePermission.findOne({ employeeId: req.params.employeeId });
    if (!perm) {
      perm = await EmployeePermission.create({
        employeeId: req.params.employeeId,
        modules: {
          enquiry: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
          invoice: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
          logistics: { visible: false, actions: { view: false, create: false, edit: false, delete: false } },
        },
      });
    }

    return res.status(200).json({
      success: true,
      employee: {
        id: employee._id,
        name: employee.name,
        employeeId: employee.employeeId,
        department: employee.department,
        role: employee.role,
      },
      modules: perm.modules,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/v1/permissions/:employeeId  — admin only
exports.updatePermissions = async (req, res) => {
  try {
    const { modules } = req.body;

    const employee = await Employee.findById(req.params.employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const perm = await EmployeePermission.findOneAndUpdate(
      { employeeId: req.params.employeeId },
      { $set: { modules } },
      { new: true, upsert: true }
    );

    return res.status(200).json({ success: true, message: "Permissions updated", modules: perm.modules });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
