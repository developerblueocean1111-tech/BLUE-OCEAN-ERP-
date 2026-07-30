const mongoose = require("mongoose");

const modulePermissionSchema = {
  visible: { type: Boolean, default: false },
  actions: {
    view: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
  },
};

const EmployeePermissionSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      unique: true,
    },
    modules: {
      enquiry: { ...modulePermissionSchema },
      invoice: { ...modulePermissionSchema },
      logistics: { ...modulePermissionSchema },
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.EmployeePermission ||
  mongoose.model("EmployeePermission", EmployeePermissionSchema);
