/**
 * Seed script — Enquiry collection
 * Run: node seed/enquirySeed.js
 */

const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const Enquiry = require("../models/Enquiry");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/shreyaatole";

const enquiries = [
  {
    enquiryNumber: "BO-230108",
    customerName: "EMS",
    customerRFQDate: new Date("2023-08-21"),
    emailSubject: "Battery to PDU HV bracket-1",
    itemDescription: "Battery to PDU HV bracket-1",
    partMapping: {
      customerPartNo: "3001-60-007",
      customerPartName: "SAE 5160 Raw Material Sheet",
      modifiedBOPartNo: "BOD05169",
      boPartName: "SAE S160 Raw Material Sheet",
    },
    poDetails: {
      supplierName: "Emerson Forge Pvt Ltd",
      poNumber: "POBR1524",
      loiNumber: "LOI-2023-001",
      partNo: "3001-60-007",
      partName: "Holder Asm OEM 12\" Tube Bracket",
      dateOfIssue: new Date("2023-12-15"),
    },
    generatedBy: "Dipak",
    createdAt: new Date("2023-08-21"),
  },
  {
    enquiryNumber: "BO-230109",
    customerName: "EMS",
    customerRFQDate: new Date("2023-08-22"),
    emailSubject: "CDVRCONNECTORS3MMTHK",
    itemDescription: "CDVRCONNECTORS3MMTHK",
    partMapping: {
      customerPartNo: "BOD60007",
      customerPartName: "Machine: Core Washer Steel Ring",
      modifiedBOPartNo: "BOD4006",
      boPartName: "Machine Flat Back Steel Washer",
    },
    poDetails: {
      supplierName: "Square Engineering",
      poNumber: "POCO1603",
      loiNumber: "LOI-2023-002",
      partNo: "BOD60007",
      partName: "12\" Holder ASM",
      dateOfIssue: new Date("2024-11-25"),
    },
    generatedBy: "Dipak",
    createdAt: new Date("2023-08-22"),
  },
  {
    enquiryNumber: "BO-230110",
    customerName: "TechCorp",
    customerRFQDate: new Date("2023-08-23"),
    emailSubject: "Industrial Motor Assembly",
    itemDescription: "Complete motor assembly for industrial use",
    partMapping: {
      customerPartNo: "4001-70-008",
      customerPartName: "Hardened Steel Rod 250mm Grade",
      modifiedBOPartNo: "BOD05170",
      boPartName: "Hardened Steel Rod Assembly Rod",
    },
    poDetails: {
      supplierName: "TechForge Industries",
      poNumber: "POBR1525",
      loiNumber: "LOI-2023-003",
      partNo: "4001-70-008",
      partName: "Precision Bracket Assembly Unit",
      dateOfIssue: new Date("2024-01-10"),
    },
    generatedBy: "Sarah",
    createdAt: new Date("2023-08-23"),
  },
  {
    enquiryNumber: "BO-230111",
    customerName: "AutoParts Inc",
    customerRFQDate: new Date("2023-08-24"),
    emailSubject: "Brake System Components",
    itemDescription: "High-grade brake pads and rotor kits",
    partMapping: {
      customerPartNo: "5001-80-009",
      customerPartName: "Aluminum Plate 6061-T6 Grade",
      modifiedBOPartNo: "BOD05171",
      boPartName: "Aluminum Plate 6061-T6 Machined",
    },
    poDetails: {
      supplierName: "MetalWorks Co",
      poNumber: "POMW1526",
      loiNumber: "LOI-2023-004",
      partNo: "5001-80-009",
      partName: "Heavy Duty Mounting Plate 6061",
      dateOfIssue: new Date("2024-02-18"),
    },
    generatedBy: "Mike",
    createdAt: new Date("2023-08-24"),
  },
  {
    enquiryNumber: "BO-230112",
    customerName: "AutoParts Inc",
    customerRFQDate: new Date("2023-08-25"),
    emailSubject: "Suspension Spring Kit",
    itemDescription: "Heavy-duty suspension coil spring set",
    partMapping: {
      customerPartNo: "6002-45-011",
      customerPartName: "Chrome Silicon Alloy Spring",
      modifiedBOPartNo: "BOD05172",
      boPartName: "CS Alloy Coil Spring 55mm",
    },
    poDetails: {
      supplierName: "PrecisionParts Ltd",
      poNumber: "POPP1527",
      loiNumber: "LOI-2023-005",
      partNo: "6002-45-011",
      partName: "Suspension Coil Spring Assembly",
      dateOfIssue: new Date("2024-03-05"),
    },
    generatedBy: "Sarah",
    createdAt: new Date("2023-08-25"),
  },
  {
    enquiryNumber: "BO-230113",
    customerName: "GlobalTech",
    customerRFQDate: new Date("2023-09-01"),
    emailSubject: "Control Panel Board",
    itemDescription: "Industrial control panel PCB assembly",
    partMapping: {
      customerPartNo: "7003-21-015",
      customerPartName: "FR4 PCB Control Board 12-Layer",
      modifiedBOPartNo: "BOD05173",
      boPartName: "FR4 Multi-Layer Control PCB",
    },
    poDetails: {
      supplierName: "ElectroSupply Co",
      poNumber: "POES1528",
      loiNumber: "LOI-2023-006",
      partNo: "7003-21-015",
      partName: "Industrial Control PCB Unit",
      dateOfIssue: new Date("2024-03-20"),
    },
    generatedBy: "Dipak",
    createdAt: new Date("2023-09-01"),
  },
  {
    enquiryNumber: "BO-230114",
    customerName: "GlobalTech",
    customerRFQDate: new Date("2023-09-05"),
    emailSubject: "HVAC Blower Motor RFQ",
    itemDescription: "HVAC blower motor 24V DC 300W",
    partMapping: {
      customerPartNo: "8004-33-020",
      customerPartName: "DC Brushless Blower Motor 24V",
      modifiedBOPartNo: "BOD05174",
      boPartName: "24V DC Blower Motor Assembly",
    },
    poDetails: {
      supplierName: "Emerson Forge Pvt Ltd",
      poNumber: "POBR1529",
      loiNumber: "LOI-2023-007",
      partNo: "8004-33-020",
      partName: "Blower Motor 24V 300W Complete",
      dateOfIssue: new Date("2024-04-12"),
    },
    generatedBy: "Mike",
    createdAt: new Date("2023-09-05"),
  },
  {
    enquiryNumber: "BO-230115",
    customerName: "EMS",
    customerRFQDate: new Date("2023-09-10"),
    emailSubject: "Wiring Harness Bundle-2",
    itemDescription: "Custom wiring harness for EV battery pack",
    partMapping: {
      customerPartNo: "9005-55-030",
      customerPartName: "PVC Insulated Wiring Harness Set",
      modifiedBOPartNo: "BOD05175",
      boPartName: "EV Battery Wiring Harness Kit",
    },
    poDetails: {
      supplierName: "CableTech Solutions",
      poNumber: "POCT1530",
      loiNumber: "LOI-2023-008",
      partNo: "9005-55-030",
      partName: "EV Battery Pack Wiring Harness",
      dateOfIssue: new Date("2024-04-28"),
    },
    generatedBy: "Sarah",
    createdAt: new Date("2023-09-10"),
  },
  {
    enquiryNumber: "BO-230116",
    customerName: "TechCorp",
    customerRFQDate: new Date("2023-09-15"),
    emailSubject: "Gearbox Housing Casting",
    itemDescription: "Aluminium Die Cast Gearbox Housing",
    partMapping: {
      customerPartNo: "1006-88-042",
      customerPartName: "AlSi12 Die Cast Housing Part",
      modifiedBOPartNo: "BOD05176",
      boPartName: "AlSi12 Gearbox Housing Casting",
    },
    poDetails: {
      supplierName: "MetalWorks Co",
      poNumber: "POMW1531",
      loiNumber: "LOI-2023-009",
      partNo: "1006-88-042",
      partName: "Gearbox Housing Aluminium Cast",
      dateOfIssue: new Date("2024-05-15"),
    },
    generatedBy: "Dipak",
    createdAt: new Date("2023-09-15"),
  },
  {
    enquiryNumber: "BO-230117",
    customerName: "AutoParts Inc",
    customerRFQDate: new Date("2023-09-20"),
    emailSubject: "Fuel Injector Nozzle Set",
    itemDescription: "High pressure direct injection nozzle set 8-piece",
    partMapping: {
      customerPartNo: "2007-99-050",
      customerPartName: "Stainless Injector Nozzle 1.8mm",
      modifiedBOPartNo: "BOD05177",
      boPartName: "SS Fuel Injector Nozzle 316L",
    },
    poDetails: {
      supplierName: "PrecisionParts Ltd",
      poNumber: "POPP1532",
      loiNumber: "LOI-2023-010",
      partNo: "2007-99-050",
      partName: "Direct Injection Nozzle 1.8mm Set",
      dateOfIssue: new Date("2024-06-01"),
    },
    generatedBy: "Mike",
    createdAt: new Date("2023-09-20"),
  },
  {
    enquiryNumber: "BO-230118",
    customerName: "GlobalTech",
    customerRFQDate: new Date("2023-09-25"),
    emailSubject: "Servo Drive Controller",
    itemDescription: "3-axis servo drive motion controller unit",
    partMapping: {
      customerPartNo: "3008-12-060",
      customerPartName: "Servo Drive 3-Axis 230V AC",
      modifiedBOPartNo: "BOD05178",
      boPartName: "3-Axis Servo Controller Unit",
    },
    poDetails: {
      supplierName: "ElectroSupply Co",
      poNumber: "POES1533",
      loiNumber: "LOI-2023-011",
      partNo: "3008-12-060",
      partName: "3-Axis Servo Drive 230V Complete",
      dateOfIssue: new Date("2024-06-18"),
    },
    generatedBy: "Sarah",
    createdAt: new Date("2023-09-25"),
  },
  {
    enquiryNumber: "BO-230119",
    customerName: "EMS",
    customerRFQDate: new Date("2023-10-01"),
    emailSubject: "Battery Cooling Plate Set",
    itemDescription: "Liquid-cooled aluminium battery cooling plates",
    partMapping: {
      customerPartNo: "4009-67-071",
      customerPartName: "Al 3003 Liquid Cooling Plate",
      modifiedBOPartNo: "BOD05179",
      boPartName: "Al3003 Battery Cooling Plate Kit",
    },
    poDetails: {
      supplierName: "TechForge Industries",
      poNumber: "POTF1534",
      loiNumber: "LOI-2023-012",
      partNo: "4009-67-071",
      partName: "Battery Cooling Plate Liquid Kit",
      dateOfIssue: new Date("2024-07-05"),
    },
    generatedBy: "Dipak",
    createdAt: new Date("2023-10-01"),
  },
  {
    enquiryNumber: "BO-230120",
    customerName: "TechCorp",
    customerRFQDate: new Date("2023-10-08"),
    emailSubject: "Hydraulic Pump Assembly",
    itemDescription: "Gear-type hydraulic pump 50cc/rev",
    partMapping: {
      customerPartNo: "5010-44-082",
      customerPartName: "Cast Iron Gear Pump 50cc",
      modifiedBOPartNo: "BOD05180",
      boPartName: "CI Gear Hydraulic Pump 50cc",
    },
    poDetails: {
      supplierName: "Square Engineering",
      poNumber: "POSE1535",
      loiNumber: "LOI-2023-013",
      partNo: "5010-44-082",
      partName: "Hydraulic Gear Pump 50cc Assembly",
      dateOfIssue: new Date("2024-07-22"),
    },
    generatedBy: "Mike",
    createdAt: new Date("2023-10-08"),
  },
  {
    enquiryNumber: "BO-230121",
    customerName: "AutoParts Inc",
    customerRFQDate: new Date("2023-10-14"),
    emailSubject: "Exhaust Manifold Gasket",
    itemDescription: "Multi-layer steel exhaust manifold gasket set",
    partMapping: {
      customerPartNo: "6011-23-090",
      customerPartName: "MLS Exhaust Gasket 4-Cyl Set",
      modifiedBOPartNo: "BOD05181",
      boPartName: "MLS Exhaust Manifold Gasket Kit",
    },
    poDetails: {
      supplierName: "MetalWorks Co",
      poNumber: "POMW1536",
      loiNumber: "LOI-2023-014",
      partNo: "6011-23-090",
      partName: "Exhaust Manifold MLS Gasket Set",
      dateOfIssue: new Date("2024-08-10"),
    },
    generatedBy: "Sarah",
    createdAt: new Date("2023-10-14"),
  },
  {
    enquiryNumber: "BO-230122",
    customerName: "GlobalTech",
    customerRFQDate: new Date("2023-10-20"),
    emailSubject: "Column Bracket Frame Weldment",
    itemDescription: "Structural column bracket welded frame",
    partMapping: {
      customerPartNo: "7012-76-100",
      customerPartName: "S355 Structural Steel Bracket",
      modifiedBOPartNo: "BOD05182",
      boPartName: "S355 Column Bracket Weldment",
    },
    poDetails: {
      supplierName: "Emerson Forge Pvt Ltd",
      poNumber: "POBR1537",
      loiNumber: "LOI-2023-015",
      partNo: "7012-76-100",
      partName: "Column Bracket Structural Weldment",
      dateOfIssue: new Date("2024-08-28"),
    },
    generatedBy: "Dipak",
    createdAt: new Date("2023-10-20"),
  },
  {
    enquiryNumber: "BO-240001",
    customerName: "EMS",
    customerRFQDate: new Date("2024-01-08"),
    emailSubject: "BMS Enclosure Housing",
    itemDescription: "IP67 aluminium BMS enclosure for 48V pack",
    partMapping: {
      customerPartNo: "8001-31-010",
      customerPartName: "Al6063 IP67 BMS Enclosure Box",
      modifiedBOPartNo: "BOD06001",
      boPartName: "IP67 BMS Aluminum Enclosure",
    },
    poDetails: {
      supplierName: "CableTech Solutions",
      poNumber: "POCT1601",
      loiNumber: "LOI-2024-001",
      partNo: "8001-31-010",
      partName: "BMS IP67 Enclosure 48V Pack",
      dateOfIssue: new Date("2024-09-15"),
    },
    generatedBy: "Sarah",
    createdAt: new Date("2024-01-08"),
  },
  {
    enquiryNumber: "BO-240002",
    customerName: "TechCorp",
    customerRFQDate: new Date("2024-01-15"),
    emailSubject: "Planetary Gearbox RFQ",
    itemDescription: "3-stage planetary gearbox ratio 1:50",
    partMapping: {
      customerPartNo: "9002-58-022",
      customerPartName: "20MnCr5 Planet Gear 1:50",
      modifiedBOPartNo: "BOD06002",
      boPartName: "20MnCr5 Planetary Gear Set",
    },
    poDetails: {
      supplierName: "TechForge Industries",
      poNumber: "POTF1602",
      loiNumber: "LOI-2024-002",
      partNo: "9002-58-022",
      partName: "Planetary Gearbox 3-Stage 1:50",
      dateOfIssue: new Date("2024-10-02"),
    },
    generatedBy: "Mike",
    createdAt: new Date("2024-01-15"),
  },
  {
    enquiryNumber: "BO-240003",
    customerName: "AutoParts Inc",
    customerRFQDate: new Date("2024-02-01"),
    emailSubject: "ABS Sensor Ring Kit",
    itemDescription: "ABS reluctor ring and wheel sensor kit",
    partMapping: {
      customerPartNo: "1003-14-033",
      customerPartName: "ABS Reluctor Ring 48-Tooth",
      modifiedBOPartNo: "BOD06003",
      boPartName: "ABS Sensor Ring 48-Tooth Kit",
    },
    poDetails: {
      supplierName: "PrecisionParts Ltd",
      poNumber: "POPP1603",
      loiNumber: "LOI-2024-003",
      partNo: "1003-14-033",
      partName: "ABS Reluctor Ring and Sensor Kit",
      dateOfIssue: new Date("2024-10-20"),
    },
    generatedBy: "Dipak",
    createdAt: new Date("2024-02-01"),
  },
  {
    enquiryNumber: "BO-240004",
    customerName: "GlobalTech",
    customerRFQDate: new Date("2024-02-12"),
    emailSubject: "Industrial Encoder Assembly",
    itemDescription: "Hollow shaft incremental encoder 2048 PPR",
    partMapping: {
      customerPartNo: "2004-92-044",
      customerPartName: "Hollow Shaft Encoder 2048PPR",
      modifiedBOPartNo: "BOD06004",
      boPartName: "Incremental Encoder 2048 PPR HS",
    },
    poDetails: {
      supplierName: "ElectroSupply Co",
      poNumber: "POES1604",
      loiNumber: "LOI-2024-004",
      partNo: "2004-92-044",
      partName: "Hollow Shaft Encoder 2048PPR Kit",
      dateOfIssue: new Date("2024-11-05"),
    },
    generatedBy: "Sarah",
    createdAt: new Date("2024-02-12"),
  },
  {
    enquiryNumber: "BO-240005",
    customerName: "EMS",
    customerRFQDate: new Date("2024-03-01"),
    emailSubject: "Cell Holder Frame Module",
    itemDescription: "18650 cell holder plastic frame 4S10P module",
    partMapping: {
      customerPartNo: "3005-61-055",
      customerPartName: "PP Cell Holder Frame 4S10P",
      modifiedBOPartNo: "BOD06005",
      boPartName: "18650 Cell Holder Frame 4S10P",
    },
    poDetails: {
      supplierName: "CableTech Solutions",
      poNumber: "POCT1605",
      loiNumber: "LOI-2024-005",
      partNo: "3005-61-055",
      partName: "18650 4S10P Cell Holder Module",
      dateOfIssue: new Date("2024-11-22"),
    },
    generatedBy: "Mike",
    createdAt: new Date("2024-03-01"),
  },
];

async function seed() {
  try {
    console.log("Connecting to MongoDB:", MONGO_URI);
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected.");

    // Clear existing enquiries
    const deleteResult = await Enquiry.deleteMany({});
    console.log(`Cleared ${deleteResult.deletedCount} existing enquiry record(s).`);

    // Insert seed data
    const inserted = await Enquiry.insertMany(enquiries);
    console.log(`Successfully seeded ${inserted.length} enquiry records.`);

    await mongoose.disconnect();
    console.log("Done. DB connection closed.");
    process.exit(0);
  } catch (err) {
    console.error("Seeding failed:", err);
    process.exit(1);
  }
}

seed();
