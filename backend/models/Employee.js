const mongoose = require("mongoose");

const EmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    employeeId: { type: String, unique: true, required: true },
    department: { type: String, required: true },
    designation: { type: String, default: "" },
    phone: { type: String, default: "" },
    role: {
      type: String,
      enum: ["admin", "employee"],
      default: "employee",
    },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Employee || mongoose.model("Employee", EmployeeSchema);
