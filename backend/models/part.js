const mongoose = require("mongoose");

const partSchema = new mongoose.Schema(
  {
    part_no: { type: String, unique: true },
    part_desc: String
  },
  { timestamps: true }
);

// ✅ ABSOLUTELY SAFE
module.exports = mongoose.models.Part
  ? mongoose.models.Part
  : mongoose.model("Part", partSchema);
