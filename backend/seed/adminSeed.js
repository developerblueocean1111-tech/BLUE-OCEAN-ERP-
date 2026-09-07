/**
 * Run: node seed/adminSeed.js
 * Creates default admin user if not present
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Employee = require("../models/Employee");
const EmployeePermission = require("../models/EmployeePermission");

const MONGO_URI = process.env.MONGO_URI;

const adminModules = {
  enquiry: { visible: true, actions: { view: true, create: true, edit: true, delete: true } },
  invoice: { visible: true, actions: { view: true, create: true, edit: true, delete: true } },
  logistics: { visible: true, actions: { view: true, create: true, edit: true, delete: true } },
};

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const existing = await Employee.findOne({ email: "admin@blueocean.com" });
  if (existing) {
    console.log("Admin already exists:", existing.email);
    await mongoose.disconnect();
    return;
  }

  const hashedPassword = await bcrypt.hash("admin123", 10);
  const admin = await Employee.create({
    name: "Super Admin",
    employeeId: "ADMIN001",
    department: "Administration",
    role: "admin",
    email: "admin@blueocean.com",
    password: hashedPassword,
  });

  await EmployeePermission.create({ employeeId: admin._id, modules: adminModules });

  console.log("Admin created: admin@blueocean.com / admin123");
  await mongoose.disconnect();
}

seed().catch((err) => { console.error(err); process.exit(1); });
