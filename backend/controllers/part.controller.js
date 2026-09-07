const Part = require("../models/part");

exports.getPartByNo = async (req, res) => {
  try {
    const partNo = (req.params.partNo || "").trim();
    if (!partNo) {
      return res.status(400).json({ message: "part number is required" });
    }

    const record = await Part.findOne({ part_no: partNo }).lean();
    if (!record) return res.status(404).json({ message: "Part not found" });

    return res.json(record);
  } catch (err) {
    console.error("Get part error:", err);
    return res.status(500).json({ message: err.message });
  }
};

exports.upsertPart = async (req, res) => {
  try {
    const partNo = (req.body?.part_no || "").trim();
    const partDesc = (req.body?.part_desc || "").trim();

    if (!partNo || !partDesc) {
      return res.status(400).json({ message: "part_no and part_desc are required" });
    }

    const record = await Part.findOneAndUpdate(
      { part_no: partNo },
      { $set: { part_desc: partDesc } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(201).json(record);
  } catch (err) {
    console.error("Upsert part error:", err);
    return res.status(500).json({ message: err.message });
  }
};