// ─────────────────────────────────────────────────────────────────────────
// DOCX → PDF conversion for Document Generation downloads — via a real
// installed Microsoft Word (COM automation on Windows), not LibreOffice.
// This renders the header/footer/floating logo exactly as Word displays
// them, since it IS Word doing the conversion — no template changes of any
// kind are required for this to work correctly.
//
// REQUIRES: Microsoft Word installed on this Windows machine. This only
// works on Windows (COM automation is a Windows-only technology) — it will
// NOT work on a Linux server (e.g. your Render deployment). If you deploy
// this backend to Render, you'll need a different converter there
// (LibreOffice or CloudConvert, both covered in earlier versions of this
// file) — this Word-based version is best suited for local/on-prem Windows
// use where document fidelity matters most.
//
// This only runs *after* generateDocumentBuffer() has already produced the
// finished, fully-populated DOCX — no template/content/formatting logic is
// touched here, and neither is the DOCX file itself.
// ─────────────────────────────────────────────────────────────────────────
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const SCRIPT_PATH = path.join(__dirname, "docx-to-pdf.ps1");

function runWordConversion(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", SCRIPT_PATH,
        "-InputPath", inputPath,
        "-OutputPath", outputPath,
      ],
      { windowsHide: true, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        resolve();
      }
    );
  });
}

async function convertDocxBufferToPdf(docxBuffer /*, filename (unused here) */) {
  const uid = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), `${uid}.docx`);
  const outputPath = path.join(os.tmpdir(), `${uid}.pdf`);

  fs.writeFileSync(inputPath, docxBuffer);
  try {
    await runWordConversion(inputPath, outputPath);
    return fs.readFileSync(outputPath);
  } finally {
    // Clean up temp files regardless of success/failure.
    try { fs.unlinkSync(inputPath); } catch (_) {}
    try { fs.unlinkSync(outputPath); } catch (_) {}
  }
}

module.exports = { convertDocxBufferToPdf };
