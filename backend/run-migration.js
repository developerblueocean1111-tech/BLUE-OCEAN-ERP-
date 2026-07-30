const mongoose = require("mongoose");
const path = require("path");

// Automatically look for and load your existing database connection string from your .env file
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Use your existing environment variable string, fallback to a local string if empty
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("❌ Error: Could not find MONGO_URI or MONGODB_URI in your .env file.");
  console.error("Please make sure your .env file exists in the backend folder, or paste your string directly.");
  process.exit(1);
}

async function startMigration() {
  try {
    console.log("🔄 Connecting to MongoDB Atlas using your .env configuration...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected successfully to the database.");

    console.log("⚙️  Running database structural migration on 'shipments' collection...");
    
    // Execute the database pipeline transformation
    const result = await mongoose.connection.db.collection("shipments").updateMany(
      { parts: { $exists: false } }, // Safety filter: Target only unmigrated old records
      [
        {
          $set: {
            // Step 1: Restructure existing single item fields into the new 'parts' array layout
            parts: [
              {
                part_no: { $ifNull: ["$part_no", "MIGRATED_UNKNOWN"] },
                part_desc: { $ifNull: ["$part_desc", ""] },
                box_size: { $ifNull: ["$box_size", ""] },
                quantity: { $ifNull: ["$part_qty", 0] },
                net_wt_per_unit: { $ifNull: ["$net_wt", 0] },
                packing_wt: { $ifNull: ["$packaging_wt", 0] },
                gross_wt: { $ifNull: ["$gross_wt", 0] }
              }
            ],
            // Step 2: Set the structural whole shipment calculations totals
            total_parts_count: { $ifNull: ["$part_qty", 0] },
            total_packing_weight: { $ifNull: ["$packaging_wt", 0] },
            total_gross_weight: { $ifNull: ["$gross_wt", 0] },
            total_net_weight: {
              $multiply: [
                { $ifNull: ["$part_qty", 0] },
                { $ifNull: ["$net_wt", 0] }
              ]
            }
          }
        },
        {
          // Step 3: Delete old top-level legacy keys to keep documents optimized
          $unset: [
            "part_no",
            "part_desc",
            "part_qty",
            "net_wt",
            "packaging_wt",
            "gross_wt",
            "box_size"
          ]
        }
      ]
    );

    console.log("---------------------------------------------------------");
    console.log(`🎉 SUCCESS: Migration complete!`);
    console.log(`📦 Total matched and updated records: ${result.modifiedCount}`);
    console.log("---------------------------------------------------------");

  } catch (error) {
    console.error("❌ Critical Migration failed with error:", error);
  } finally {
    // Safely disconnect from cluster
    await mongoose.disconnect();
    console.log("🔌 Safely disconnected from MongoDB Atlas.");
  }
}

// Execute the function
startMigration();