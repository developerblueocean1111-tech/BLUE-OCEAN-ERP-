const mongoose = require("mongoose");

/**
 * 1. Sub-Schema for Individual Parts
 * Supports the dynamic "+ Add Part" / "Remove Part" frontend functionality
 */
const PartItemSchema = new mongoose.Schema({
  part_no: { 
    type: String, 
    required: [true, "Part Number is required"] 
  },
  part_desc: { type: String, default: "" },
  box_size: { type: String, default: "" },
  quantity: { type: Number, default: 0 },
  net_wt_per_unit: { type: Number, default: 0 }, // Net Wt / Unit (Kg)
  packing_wt: { type: Number, default: 0 },     // Packing Wt (Kg)
  gross_wt: { type: Number, default: 0 } ,
  no_of_boxes: { type: Number, default: 0 }, 
         
});

/**
 * 2. Main Shipment Schema
 */
const ShipmentSchema = new mongoose.Schema(
  {
    enquiry_no: { type: String },
    supplier_name: { type: String },
    ff: { type: String },
    customer: { type: String },

    invoice_no: { type: String },
    invoice_date: { type: String },

    // Dynamic array containing all individual parts
    parts: [PartItemSchema],

    // Calculated fields for Whole Shipment Totals
   // Add these to your Main ShipmentSchema definition to catch all variants safely
total_net_weight: { type: Number, default: 0 },
total_no_of_boxes: { type: Number, default: 0 },
total_gross_weight: { type: Number, default: 0 },
total_parts_count: { type: Number, default: 0 },

// 🚀 ALIASES TO SUPPORT DIRECT STEP 1 FLAT ENTRIES
total_qty: { type: Number },
total_net_wt: { type: Number },
total_gross_wt: { type: Number },
total_no_of_boxes: { type: Number },
    // Dropdown value constraints (Enums)
    incoterm: { 
      type: String, 
      enum: {
        values: ["DAP", "EXW", "CIF", "CIP", "CFR", "CPT", "DAT", "DDP", "FAS", "FCA", "FOB", null],
        message: "{VALUE} is not a valid Incoterm"
      },
      default: null 
    },
    mode: { 
      type: String, 
      enum: {
        values: ["Sea", "Air", "Road", "Rail", null],
        message: "{VALUE} is not a valid Shipping Mode"
      },
      default: null 
    },

    package_type: { type: String },
    dispatch_date: { type: Date, default: null },

    sb_no: { type: String },
    sb_date: { type: Date, default: null },

    etd: { type: Date, default: null },
    supplier_etd: { type: Date, default: null }, // Supplier ETD (added — additive only, no other schema/logic changes)
    final_delivery_date: { type: Date, default: null }, // Mapped from Final Delivery

    bl_no: { type: String },
    container_no: { type: String },
    pol: { type: String }, // Port of Loading

    notify_email: { type: String },
    email_message: { type: String },
    manual_desc: { type: String },

    label_files: { type: [String], default: [] },
    label_urls: { type: [String], default: [] },

    status: { type: String, default: "ACTIVE" },
    delivery_status: { type: String, default: "IN_PROCESS" }
  },
  { timestamps: true }
);

/**
 * 3. Pre-Save Middleware Hook
 * Automatically computes total weights and piece counts whenever a document is saved/updated
 */
ShipmentSchema.pre("save", function (next) {
  // If flat values exist from Step 1, synchronize them to the schema standard keys
  if (this.total_qty !== undefined && this.total_qty !== null) this.total_parts_count = Number(this.total_qty);
  if (this.total_net_wt !== undefined && this.total_net_wt !== null) this.total_net_weight = Number(this.total_net_wt);
  if (this.total_gross_wt !== undefined && this.total_gross_wt !== null) this.total_gross_weight = Number(this.total_gross_wt);
  if (this.total_no_of_boxes !== undefined && this.total_no_of_boxes !== null) this.total_no_of_boxes = Number(this.total_no_of_boxes);

  if (this.parts && this.parts.length > 0) {
    // If complex parts items exist, sum them up
    this.total_parts_count = this.parts.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    this.total_no_of_boxes = this.parts.reduce((sum, item) => sum + (Number(item.no_of_boxes) || 0), 0);
    this.total_gross_weight = this.parts.reduce((sum, item) => sum + (Number(item.gross_wt) || 0), 0);
    this.total_net_weight = this.parts.reduce((sum, item) => sum + ((Number(item.quantity) || 0) * (Number(item.net_wt_per_unit) || 0)), 0);
  }
  next();
});

/**
 * 4. Unique Index on the Shipment's business identifier (enquiry_no)
 * ----------------------------------------------------------------------
 * WHY: This is the MongoDB-level safety net for Task 1 (Prevent Duplicate
 * Shipment Records). enquiry_no (a.k.a. QMR No) is already the unique
 * business identifier used elsewhere in the app (bulk-upload de-dup check
 * in shipment.controller.js, and the auto-increment logic in
 * getEnquiryNumber). We simply enforce that uniqueness at the database
 * layer so that even if application-level logic is ever bypassed
 * (race condition, direct API call, script, etc.) two shipments can never
 * be inserted with the same enquiry_no.
 *
 * `sparse: true` ensures this does NOT break any existing/legacy documents
 * that may have a null/missing enquiry_no — the unique constraint only
 * applies to documents where the field actually has a value.
 * No other business logic, field, or validation was changed.
 */
ShipmentSchema.index({ enquiry_no: 1 }, { unique: true, sparse: true });

/**
 * 5. Performance indexes (Dashboard fix request, item 7)
 * ----------------------------------------------------------------------
 * These back the Part Number Analytics search, ETD search/filters, and
 * the main Shipment List filters so none of them fall back to a full
 * collection scan as data grows. Additive only — no existing index or
 * schema behaviour is changed.
 */
ShipmentSchema.index({ "parts.part_no": 1 });   // partNumber
ShipmentSchema.index({ mode: 1 });               // shipmentType
ShipmentSchema.index({ etd: 1 });                // etd (single date + range search)
ShipmentSchema.index({ supplier_name: 1 });      // supplier
ShipmentSchema.index({ customer: 1 });           // customer
ShipmentSchema.index({ final_delivery_date: 1 }); // deliveryDate
ShipmentSchema.index({ status: 1 });             // shipmentStatus


// Prevent OverwriteModelError
module.exports = mongoose.models.Shipment || mongoose.model("Shipment", ShipmentSchema);
