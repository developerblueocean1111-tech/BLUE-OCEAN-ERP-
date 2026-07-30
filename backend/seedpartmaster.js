/**
 * seedPartMaster.js
 * 
 * Run once to import all parts from Part_List.xlsx into the part_master collection.
 * 
 * Usage:
 *   node seedPartMaster.js
 * 
 * Make sure your MONGO_URI is set in .env or replace it inline below.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const PartMaster = require("./models/part_master"); // adjust path if needed

const data = [
  { "part_number": "051-14-001", "part_description": "Holder X-Lock 11\"", "supplier_name": "Solean", "customer_name": "Fecon" },
  { "part_number": "051-14-001", "part_description": "Holder X-Lock 11\"", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "051-14-002", "part_description": "Holder X-Lock 9\"", "supplier_name": "Solean", "customer_name": "Fecon" },
  { "part_number": "051-14-007", "part_description": "Tool X-Lock Axe", "supplier_name": "Unitec", "customer_name": "Fecon" },
  { "part_number": "051-14-008", "part_description": "Tool X-Lock Sword", "supplier_name": "Bhushan", "customer_name": "Fecon" },
  { "part_number": "052-14-001", "part_description": "Holder X-Lock 12\" Bobcat", "supplier_name": "Advance", "customer_name": "Fecon" },
  { "part_number": "052-14-001", "part_description": "Holder X-Lock 12\" Bobcat", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "052-14-002", "part_description": "Holder X-Lock 12\" JD", "supplier_name": "Advance", "customer_name": "Fecon" },
  { "part_number": "052-14-002", "part_description": "Holder X-Lock 12\" JD", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "052-14-002", "part_description": "Holder X-Lock 12\" JD", "supplier_name": "VW", "customer_name": "Fecon" },
  { "part_number": "052-14-003", "part_description": "Holder X-Lock 12\" Kubota", "supplier_name": "", "customer_name": "Fecon" },
  { "part_number": "052-14-011", "part_description": "Holder X-Lock 10\" Bobcat", "supplier_name": "VW", "customer_name": "Fecon" },
  { "part_number": "052-14-012", "part_description": "Holder X-Lock 10\" JD", "supplier_name": "VW", "customer_name": "Fecon" },
  { "part_number": "052-14-013", "part_description": "Holder X-Lock 10\" Kubota", "supplier_name": "", "customer_name": "Fecon" },
  { "part_number": "052-14-031", "part_description": "Tool X-Lock Axe Bobcat", "supplier_name": "Unitec", "customer_name": "Fecon" },
  { "part_number": "052-14-032", "part_description": "Tool X-Lock Axe JD", "supplier_name": "Unitec", "customer_name": "Fecon" },
  { "part_number": "052-14-033", "part_description": "Tool X-Lock Axe Kubota", "supplier_name": "", "customer_name": "Fecon" },
  { "part_number": "053-14-001", "part_description": "Holder X-Lock Cubit 9\"", "supplier_name": "Aashirwad", "customer_name": "Fecon" },
  { "part_number": "053-14-002", "part_description": "Tool X-Lock Cubit", "supplier_name": "Aarcs", "customer_name": "Fecon" },
  { "part_number": "053-14-002", "part_description": "Tool X-Lock Cubit", "supplier_name": "Aashirwad", "customer_name": "Fecon" },
  { "part_number": "053-14-002", "part_description": "Tool X-Lock Cubit", "supplier_name": "Monocraft", "customer_name": "Fecon" },
  { "part_number": "074-14-100", "part_description": "Mach, Dirt Ring Flat Back Holder", "supplier_name": "Tooltech", "customer_name": "Fecon" },
  { "part_number": "074-23-124-JD", "part_description": "Trapdoor Cylinder Guard JD", "supplier_name": "Deepesh", "customer_name": "Fecon" },
  { "part_number": "074-24-017", "part_description": "Mach Skid Shoe Plate PH", "supplier_name": "ICQR", "customer_name": "Fecon" },
  { "part_number": "086-14-006", "part_description": "Bolting Flange 3/4\" WL", "supplier_name": "Tooltech", "customer_name": "Fecon" },
  { "part_number": "300-60-007", "part_description": "Holder 12\"", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "300-64-030", "part_description": "Knife tool Bobcat", "supplier_name": "Aashirwad", "customer_name": "Fecon" },
  { "part_number": "300-94-011", "part_description": "1/2\" Wall Rotor Dirt Ring", "supplier_name": "Tooltech", "customer_name": "Fecon" },
  { "part_number": "300-95-009", "part_description": "Rotor Core Washer JD", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "300-95-013", "part_description": "Holder", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "301-24-003", "part_description": "Ring , Beacon Holder", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "301-34-009", "part_description": "13 T Splined Drive Shaft", "supplier_name": "Rotadyne", "customer_name": "Fecon" },
  { "part_number": "301-95-001", "part_description": "Holder", "supplier_name": "Solean", "customer_name": "Fecon" },
  { "part_number": "301-95-001", "part_description": "Holder", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "307-65-013", "part_description": "Core Washer", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "307-65-023", "part_description": "Mach, Stone Crsuher Dirt Ring", "supplier_name": "Tooltech", "customer_name": "Fecon" },
  { "part_number": "307-75-001", "part_description": "Threaded Insert", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "320-10-067", "part_description": "Holder 11\"", "supplier_name": "Advance", "customer_name": "Fecon" },
  { "part_number": "320-10-069", "part_description": "Blackhawk Holder", "supplier_name": "Advance", "customer_name": "Fecon" },
  { "part_number": "320-14-061", "part_description": "Line up Tube", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "320-14-212", "part_description": "Viking Sword", "supplier_name": "Monocraft", "customer_name": "Fecon" },
  { "part_number": "320-14-213", "part_description": "Viking Axe Knife", "supplier_name": "Aashirwad", "customer_name": "Fecon" },
  { "part_number": "501-10-004", "part_description": "Holder 9\"", "supplier_name": "Advance", "customer_name": "Fecon" },
  { "part_number": "501-14-008", "part_description": "Line up Tube", "supplier_name": "mauli", "customer_name": "Fecon" },
  { "part_number": "501-14-008", "part_description": "Line up Tube", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "501-14-013", "part_description": "Cubit Knife", "supplier_name": "Mauli", "customer_name": "Fecon" },
  { "part_number": "501-14-013", "part_description": "Cubit Knife", "supplier_name": "Aashirwad", "customer_name": "Fecon" },
  { "part_number": "501-14-013", "part_description": "Cubit Knife", "supplier_name": "Bhushan", "customer_name": "Fecon" },
  { "part_number": "501-14-014", "part_description": "Ring Dirt Guard Cast", "supplier_name": "Prasad", "customer_name": "Fecon" },
  { "part_number": "501-30-001", "part_description": "Shaft Assembly - Small", "supplier_name": "Rotadyne", "customer_name": "Fecon" },
  { "part_number": "501-33-002", "part_description": "Drive Shaft 15T Spline Weld", "supplier_name": "Rotadyne", "customer_name": "Fecon" },
  { "part_number": "501-43-100-JD", "part_description": "Mount FMX", "supplier_name": "Deepesh", "customer_name": "Fecon" },
  { "part_number": "502-14-008", "part_description": "Rotor stub floating Mach", "supplier_name": "Mauli", "customer_name": "Fecon" },
  { "part_number": "802-14-002", "part_description": "Blade Deck Mower", "supplier_name": "Advance", "customer_name": "Fecon" },
  { "part_number": "802-14-003", "part_description": "Blade Bolt Deck Mower", "supplier_name": "Mauli", "customer_name": "Fecon" },
  { "part_number": "802-14-006", "part_description": "Bolting Plate", "supplier_name": "Aarcs", "customer_name": "Fecon" },
  { "part_number": "802-14-009", "part_description": "Blade Carrier 74\"", "supplier_name": "BSP", "customer_name": "Fecon" },
  { "part_number": "802-14-011", "part_description": "Blade Carrier 86\"", "supplier_name": "BSP", "customer_name": "Fecon" },
  { "part_number": "802-14-013", "part_description": "Blade Carrier 62\"", "supplier_name": "BSP", "customer_name": "Fecon" },
  { "part_number": "802-33-005", "part_description": "Spindle Shaft Brush Cutter", "supplier_name": "Mauli", "customer_name": "Fecon" },
  { "part_number": "802-34-002", "part_description": "Lower Cap Spindle", "supplier_name": "Tooltech", "customer_name": "Fecon" },
  { "part_number": "802-34-006", "part_description": "Spacer top shaft Spindle", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "802-34-010", "part_description": "Grease Catch Spindle", "supplier_name": "Square", "customer_name": "Fecon" },
  { "part_number": "BH013-30", "part_description": "Rotor Stub Shaft Small", "supplier_name": "Mauli", "customer_name": "Fecon" },
  { "part_number": "STP-1289", "part_description": "Raker 1289", "supplier_name": "ICQR", "customer_name": "Fecon" },
  { "part_number": "STP-3139", "part_description": "Raker 3139", "supplier_name": "ICQR", "customer_name": "Fecon" }
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/your_db_name");
    console.log("Connected to MongoDB");

    // Upsert each record on part_number + supplier_name combination
    // This means re-running the script is always safe — no duplicates
    let upserted = 0;
    let modified = 0;

    for (const row of data) {
      const result = await PartMaster.updateOne(
        { part_number: row.part_number, supplier_name: row.supplier_name },
        { $set: row },
        { upsert: true }
      );
      if (result.upsertedCount) upserted++;
      if (result.modifiedCount) modified++;
    }

    console.log(`✅ Done. Inserted: ${upserted}, Updated: ${modified}, Total processed: ${data.length}`);
    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
}

seed();
[
  {
    "part_number": "051-14-001",
    "part_description": "Holder X-Lock 11\"",
    "supplier_name": "Solean",
    "customer_name": "Fecon"
  },
  {
    "part_number": "051-14-001",
    "part_description": "Holder X-Lock 11\"",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "051-14-002",
    "part_description": "Holder X-Lock 9\"",
    "supplier_name": "Solean",
    "customer_name": "Fecon"
  },
  {
    "part_number": "051-14-007",
    "part_description": "Tool X-Lock Axe",
    "supplier_name": "Unitec",
    "customer_name": "Fecon"
  },
  {
    "part_number": "051-14-008",
    "part_description": "Tool X-Lock Sword",
    "supplier_name": "Bhushan",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-001",
    "part_description": "Holder X-Lock 12\" Bobcat",
    "supplier_name": "Advance",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-001",
    "part_description": "Holder X-Lock 12\" Bobcat",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-002",
    "part_description": "Holder X-Lock 12\" JD",
    "supplier_name": "Advance",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-002",
    "part_description": "Holder X-Lock 12\" JD",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-002",
    "part_description": "Holder X-Lock 12\" JD",
    "supplier_name": "VW",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-003",
    "part_description": "Holder X-Lock 12\" Kubota",
    "supplier_name": "",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-011",
    "part_description": "Holder X-Lock 10\" Bobcat",
    "supplier_name": "VW",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-012",
    "part_description": "Holder X-Lock 10\" JD",
    "supplier_name": "VW",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-013",
    "part_description": "Holder X-Lock 10\" Kubota",
    "supplier_name": "",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-031",
    "part_description": "Tool X-Lock Axe Bobcat",
    "supplier_name": "Unitec",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-032",
    "part_description": "Tool X-Lock Axe JD",
    "supplier_name": "Unitec",
    "customer_name": "Fecon"
  },
  {
    "part_number": "052-14-033",
    "part_description": "Tool X-Lock Axe Kubota",
    "supplier_name": "",
    "customer_name": "Fecon"
  },
  {
    "part_number": "053-14-001",
    "part_description": "Holder X-Lock Cubit 9\"",
    "supplier_name": "Aashirwad",
    "customer_name": "Fecon"
  },
  {
    "part_number": "053-14-002",
    "part_description": "Tool X-Lock Cubit",
    "supplier_name": "Aarcs",
    "customer_name": "Fecon"
  },
  {
    "part_number": "053-14-002",
    "part_description": "Tool X-Lock Cubit",
    "supplier_name": "Aashirwad",
    "customer_name": "Fecon"
  },
  {
    "part_number": "053-14-002",
    "part_description": "Tool X-Lock Cubit",
    "supplier_name": "Monocraft",
    "customer_name": "Fecon"
  },
  {
    "part_number": "074-14-100",
    "part_description": "Mach, Dirt Ring Flat Back Holder",
    "supplier_name": "Tooltech",
    "customer_name": "Fecon"
  },
  {
    "part_number": "074-23-124-JD",
    "part_description": "Trapdoor Cylinder Guard JD",
    "supplier_name": "Deepesh",
    "customer_name": "Fecon"
  },
  {
    "part_number": "074-24-017",
    "part_description": "Mach Skid Shoe Plate PH",
    "supplier_name": "ICQR",
    "customer_name": "Fecon"
  },
  {
    "part_number": "086-14-006",
    "part_description": "Bolting Flange 3/4\" WL",
    "supplier_name": "Tooltech",
    "customer_name": "Fecon"
  },
  {
    "part_number": "300-60-007",
    "part_description": "Holder 12\"",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "300-64-030",
    "part_description": "Knife tool Bobcat",
    "supplier_name": "Aashirwad",
    "customer_name": "Fecon"
  },
  {
    "part_number": "300-94-011",
    "part_description": "1/2\" Wall Rotor Dirt Ring",
    "supplier_name": "Tooltech",
    "customer_name": "Fecon"
  },
  {
    "part_number": "300-95-009",
    "part_description": "Rotor Core Washer JD",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "300-95-013",
    "part_description": "Holder",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "301-24-003",
    "part_description": "Ring , Beacon Holder",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "301-34-009",
    "part_description": "13 T Splined Drive Shaft",
    "supplier_name": "Rotadyne",
    "customer_name": "Fecon"
  },
  {
    "part_number": "301-95-001",
    "part_description": "Holder",
    "supplier_name": "Solean",
    "customer_name": "Fecon"
  },
  {
    "part_number": "301-95-001",
    "part_description": "Holder",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "307-65-013",
    "part_description": "Core Washer",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "307-65-023",
    "part_description": "Mach, Stone Crsuher Dirt Ring",
    "supplier_name": "Tooltech",
    "customer_name": "Fecon"
  },
  {
    "part_number": "307-75-001",
    "part_description": "Threaded Insert",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "320-10-067",
    "part_description": "Holder 11\"",
    "supplier_name": "Advance",
    "customer_name": "Fecon"
  },
  {
    "part_number": "320-10-069",
    "part_description": "Blackhawk Holder",
    "supplier_name": "Advance",
    "customer_name": "Fecon"
  },
  {
    "part_number": "320-14-061",
    "part_description": "Line up Tube",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "320-14-212",
    "part_description": "Viking Sword",
    "supplier_name": "Monocraft",
    "customer_name": "Fecon"
  },
  {
    "part_number": "320-14-213",
    "part_description": "Viking Axe Knife",
    "supplier_name": "Aashirwad",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-10-004",
    "part_description": "Holder 9\"",
    "supplier_name": "Advance",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-14-008",
    "part_description": "Line up Tube",
    "supplier_name": "mauli",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-14-008",
    "part_description": "Line up Tube",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-14-013",
    "part_description": "Cubit Knife",
    "supplier_name": "Mauli",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-14-013",
    "part_description": "Cubit Knife",
    "supplier_name": "Aashirwad",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-14-013",
    "part_description": "Cubit Knife",
    "supplier_name": "Bhushan",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-14-014",
    "part_description": "Ring Dirt Guard Cast",
    "supplier_name": "Prasad",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-30-001",
    "part_description": "Shaft Assembly - Small",
    "supplier_name": "Rotadyne",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-33-002",
    "part_description": "Drive Shaft 15T Spline Weld",
    "supplier_name": "Rotadyne",
    "customer_name": "Fecon"
  },
  {
    "part_number": "501-43-100-JD",
    "part_description": "Mount FMX",
    "supplier_name": "Deepesh",
    "customer_name": "Fecon"
  },
  {
    "part_number": "502-14-008",
    "part_description": "Rotor stub floating Mach",
    "supplier_name": "Mauli",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-14-002",
    "part_description": "Blade Deck Mower",
    "supplier_name": "Advance",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-14-003",
    "part_description": "Blade Bolt Deck Mower",
    "supplier_name": "Mauli",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-14-006",
    "part_description": "Bolting Plate",
    "supplier_name": "Aarcs",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-14-009",
    "part_description": "Blade Carrier 74\"",
    "supplier_name": "BSP",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-14-011",
    "part_description": "Blade Carrier 86\"",
    "supplier_name": "BSP",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-14-013",
    "part_description": "Blade Carrier 62\"",
    "supplier_name": "BSP",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-33-005",
    "part_description": "Spindle Shaft Brush Cutter",
    "supplier_name": "Mauli",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-34-002",
    "part_description": "Lower Cap Spindle",
    "supplier_name": "Tooltech",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-34-006",
    "part_description": "Spacer top shaft Spindle",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "802-34-010",
    "part_description": "Grease Catch Spindle",
    "supplier_name": "Square",
    "customer_name": "Fecon"
  },
  {
    "part_number": "BH013-30",
    "part_description": "Rotor Stub Shaft Small",
    "supplier_name": "Mauli",
    "customer_name": "Fecon"
  },
  {
    "part_number": "STP-1289",
    "part_description": "Raker 1289",
    "supplier_name": "ICQR",
    "customer_name": "Fecon"
  },
  {
    "part_number": "STP-3139",
    "part_description": "Raker 3139",
    "supplier_name": "ICQR",
    "customer_name": "Fecon"
  }
]