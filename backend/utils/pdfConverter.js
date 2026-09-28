// ─────────────────────────────────────────────────────────────────────────
// DOCX → PDF conversion for Document Generation downloads.
//
// This automatically picks the right converter for whichever machine is
// running it — no manual swapping between local dev and production:
//
//   • Windows (your local PC)  → Microsoft Word via COM automation.
//     Free, no API limits, requires Word installed locally. This is what
//     runs when you test with `node index.js` on your own machine.
//
//   • Any other platform (Render's Linux servers) → CloudConvert.
//     Word COM automation cannot run on Linux at all (it's a Windows-only
//     technology), so production uses the cloud API instead. Requires
//     CLOUDCONVERT_API_KEY to be set as an environment variable on Render
//     (see the CloudConvert setup notes further down), and is subject to
//     CloudConvert's usage limits/pricing on their end.
//
// Both paths produce a PDF from the already-filled DOCX buffer that
// generateDocumentBuffer() built — no template/content/formatting logic is
// touched here either way.
// ─────────────────────────────────────────────────────────────────────────
const os = require("os");

const IS_WINDOWS = os.platform() === "win32";

// ── Windows path: Microsoft Word via COM automation ────────────────────────
async function convertViaWordCom(docxBuffer) {
  const fs = require("fs");
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
          if (err) return reject(new Error(stderr?.trim() || err.message));
          resolve();
        }
      );
    });
  }

  const uid = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), `${uid}.docx`);
  const outputPath = path.join(os.tmpdir(), `${uid}.pdf`);

  fs.writeFileSync(inputPath, docxBuffer);
  try {
    await runWordConversion(inputPath, outputPath);
    return fs.readFileSync(outputPath);
  } finally {
    try { fs.unlinkSync(inputPath); } catch (_) {}
    try { fs.unlinkSync(outputPath); } catch (_) {}
  }
}

// ── Non-Windows path: CloudConvert ──────────────────────────────────────────
async function convertViaCloudConvert(docxBuffer, filename) {
  const CloudConvert = require("cloudconvert");

  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "CLOUDCONVERT_API_KEY is not set. Add it in Render's Environment tab."
    );
    err.code = "MISSING_API_KEY";
    throw err;
  }

  const cloudConvert = new CloudConvert(apiKey);

  let job = await cloudConvert.jobs.create({
    tasks: {
      "import-doc": { operation: "import/upload" },
      "convert-doc": { operation: "convert", input: "import-doc", output_format: "pdf" },
      "export-doc": { operation: "export/url", input: "convert-doc" },
    },
  });

  const uploadTask = job.tasks.find((t) => t.name === "import-doc");
  await cloudConvert.tasks.upload(uploadTask, docxBuffer, filename, docxBuffer.length);

  job = await cloudConvert.jobs.wait(job.id);

  if (job.status === "error") {
    const failedTask = job.tasks.find((t) => t.status === "error");
    throw new Error(`CloudConvert conversion failed: ${failedTask?.message || "unknown error"}`);
  }

  const exportUrls = cloudConvert.jobs.getExportUrls(job);
  if (!exportUrls || exportUrls.length === 0) {
    throw new Error("CloudConvert returned no output file");
  }

  const response = await fetch(exportUrls[0].url);
  if (!response.ok) {
    throw new Error(`Failed to download converted PDF (HTTP ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Entry point used by the controller ──────────────────────────────────────
async function convertDocxBufferToPdf(docxBuffer, filename = "document.docx") {
  if (IS_WINDOWS) {
    return convertViaWordCom(docxBuffer);
  }
  return convertViaCloudConvert(docxBuffer, filename);
}

module.exports = { convertDocxBufferToPdf };
