const PartMaster = require("../models/part_master");

/**
 * GET /api/parts/search?q=<query>
 *
 * Returns matching part numbers (and descriptions) for autocomplete.
 * Search triggers after 2+ characters.
 * Matches against part_number OR part_description (case-insensitive).
 *
 * Response shape:
 * [
 *   { part_number, part_description, customer_name, supplier_name[] }
 * ]
 */
exports.searchParts = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    if (q.length < 2) {
      return res.json([]);
    }

    const regex = new RegExp(q, "i"); // case-insensitive

    // Find all docs whose part_number OR part_description matches
    const rawResults = await PartMaster.find({
      $or: [{ part_number: regex }, { part_description: regex }],
    })
      .select("part_number part_description customer_name supplier_name")
      .limit(20)
      .lean();

    // Group by part_number so we can expose all suppliers for a given part
    const grouped = {};
    rawResults.forEach((row) => {
      if (!grouped[row.part_number]) {
        grouped[row.part_number] = {
          part_number: row.part_number,
          part_description: row.part_description,
          customer_name: row.customer_name,
          suppliers: [],
        };
      }
      if (
        row.supplier_name &&
        !grouped[row.part_number].suppliers.includes(row.supplier_name)
      ) {
        grouped[row.part_number].suppliers.push(row.supplier_name);
      }
    });

    res.json(Object.values(grouped));
  } catch (err) {
    console.error("Part search error:", err);
    res.status(500).json({ error: "Part search failed" });
  }
};

/**
 * GET /api/parts/:partNumber
 *
 * Returns full detail for a specific part number.
 * Aggregates all suppliers for that part.
 *
 * Response shape:
 * {
 *   part_number,
 *   part_description,
 *   customer_name,
 *   suppliers: ["Ashirwad", "ABC Engineering"]
 * }
 */
exports.getPartByNumber = async (req, res) => {
  try {
    const partNumber = (req.params.partNumber || "").trim();

    if (!partNumber) {
      return res.status(400).json({ error: "Part number is required" });
    }

    // Case-insensitive exact match
    const records = await PartMaster.find({
      part_number: new RegExp(`^${escapeRegex(partNumber)}$`, "i"),
    })
      .select("part_number part_description customer_name supplier_name")
      .lean();

    if (!records.length) {
      return res.status(404).json({ error: "Part not found" });
    }

    const first = records[0];
    const suppliers = [
      ...new Set(records.map((r) => r.supplier_name).filter(Boolean)),
    ];

    res.json({
      part_number: first.part_number,
      part_description: first.part_description,
      customer_name: first.customer_name,
      suppliers, // array — frontend picks single vs dropdown
    });
  } catch (err) {
    console.error("Get part error:", err);
    res.status(500).json({ error: "Failed to fetch part details" });
  }
};

/**
 * POST /api/parts/import
 *
 * Bulk-imports an array of part master records.
 * Upserts on part_number + supplier_name combination so re-imports are safe.
 *
 * Body: [{ part_number, part_description, customer_name, supplier_name }]
 */
exports.importParts = async (req, res) => {
  try {
    const rows = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No data provided" });
    }

    const ops = rows.map((row) => ({
      updateOne: {
        filter: {
          part_number: (row.part_number || row["Part Number"] || "").trim(),
          supplier_name: (row.supplier_name || row["Supplier Name"] || "").trim(),
        },
        update: {
          $set: {
            part_number: (row.part_number || row["Part Number"] || "").trim(),
            part_description: (
              row.part_description ||
              row["Part Description"] ||
              ""
            ).trim(),
            customer_name: (row.customer_name || row["Customer Name"] || "").trim(),
            supplier_name: (row.supplier_name || row["Supplier Name"] || "").trim(),
          },
        },
        upsert: true,
      },
    }));

    const result = await PartMaster.bulkWrite(ops);

    res.json({
      success: true,
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
    });
  } catch (err) {
    console.error("Part import error:", err);
    res.status(500).json({ error: "Import failed: " + err.message });
  }
};

// Helper — escape special regex characters in user input
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}