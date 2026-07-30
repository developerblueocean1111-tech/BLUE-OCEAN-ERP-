const mongoose = require("mongoose");

// 1. IMPORT YOUR UPDATED SHIPMENT MODEL
// Adjust the path below if your model is in a different folder (e.g., "./models/Shipment")



// 2. PASTE YOUR ACTUAL MONGO_URI STRING HERE 
// It should look like: "mongodb+srv://..."
const MONGO_URI = "YOUR_MONGODB_ATLAS_CONNECTION_STRING_HERE";

async function runMigration() {
  try {
    console.log("🔄 Connecting to MongoDB Atlas...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected successfully to developer_db_user database.");

    console.log("⚙️  Running migration on 'shipments' collection...");
    
    // We access the raw MongoDB driver from Mongoose to execute the update
    const result = await mongoose.connection.db.collection("shipments").updateMany(
      { parts: { $exists: false } }, // Target only unmigrated documents
      [
        {
          $set: {
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

    console.log(`🎉 Migration complete! Modified ${result.modifiedCount} shipment documents.`);
  } catch (error) {
    console.error("❌ Migration failed with error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB.");
  }
}

runMigration();