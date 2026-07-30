const fs = require("fs");
const FileModel = require("../models/fileModel");

function normalizeFiles(filesValue) {
  if (!filesValue) return [];
  return Array.isArray(filesValue) ? filesValue : [filesValue];
}

function getDataUrlFromFile(file) {
  if (file.tempFilePath && fs.existsSync(file.tempFilePath)) {
    const base64 = fs.readFileSync(file.tempFilePath, { encoding: "base64" });
    return `data:${file.mimetype || "application/octet-stream"};base64,${base64}`;
  }

  if (file.data) {
    const base64 = Buffer.from(file.data).toString("base64");
    return `data:${file.mimetype || "application/octet-stream"};base64,${base64}`;
  }

  return "";
}

exports.uploadFiles = async (req, res) => {
  try {
    const files = normalizeFiles(req.files?.files || req.files?.file);
    if (!files.length) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const result = [];
    for (const file of files) {
      const url = getDataUrlFromFile(file);

      const saved = await FileModel.create({
        filename: file.name,
        url,
        meta: {
          size: file.size,
          mimetype: file.mimetype,
        },
      });

      if (file.tempFilePath && fs.existsSync(file.tempFilePath)) {
        fs.unlinkSync(file.tempFilePath);
      }

      result.push({
        id: saved._id.toString(),
        filename: saved.filename,
        url: saved.url,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error("File upload error:", err);
    return res.status(500).json({ message: err.message });
  }
};