const mongoose = require("mongoose");

/**
 * Part Master Schema
 * Central source of truth for part → customer/supplier mapping.
 * Used for autocomplete and auto-fill in the shipment form.
 */
const PartMasterSchema = new mongoose.Schema(
  {
    part_number: {
      type: String,
      required: [true, "Part Number is required"],
      trim: true,
      index: true,
    },
    part_description: {
      type: String,
      default: "",
      trim: true,
    },
    customer_name: {
      type: String,
      default: "",
      trim: true,
    },
    supplier_name: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

// Compound index for fast case-insensitive prefix search on part_number
PartMasterSchema.index({ part_number: "text", part_description: "text" });

module.exports =
  mongoose.models.PartMaster ||
  mongoose.model("PartMaster", PartMasterSchema);