// ─────────────────────────────────────────────────────────────────────────
// DOCX → PDF conversion for Document Generation downloads — via CloudConvert
// (cloud API). Works on any server, including Render's Linux environment —
// unlike the Word-COM-automation version, which only runs on a Windows
// machine with Microsoft Word installed.
//
// REQUIRES: a CloudConvert account + API key, set as an environment
// variable on whichever server runs this (Render, in this case — set it
// under your Render service's "Environment" tab, NOT just in a local .env
// file, since Render doesn't read your local .env).
//   1. Sign up (free tier available): https://cloudconvert.com/register
//   2. Create an API key: https://cloudconvert.com/dashboard/api/v2/keys
//   3. In Render: your service → "Environment" tab → Add Environment
//      Variable → Key: CLOUDCONVERT_API_KEY, Value: your key → Save
//      (this triggers an automatic redeploy)
//
// This only runs *after* generateDocumentBuffer() has already produced the
// finished, fully-populated DOCX — no template/content/formatting logic is
// touched here.
// ─────────────────────────────────────────────────────────────────────────
const CloudConvert = require("cloudconvert");

async function convertDocxBufferToPdf(docxBuffer, filename = "document.docx") {
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "CLOUDCONVERT_API_KEY is not set. Add it in Render's Environment tab (see backend/utils/pdfConverter.js for setup steps)."
    );
    err.code = "MISSING_API_KEY";
    throw err;
  }

  const cloudConvert = new CloudConvert(apiKey);

  let job = await cloudConvert.jobs.create({
    tasks: {
      "import-doc": { operation: "import/upload" },
      "convert-doc": {
        operation: "convert",
        input: "import-doc",
        output_format: "pdf",
      },
      "export-doc": {
        operation: "export/url",
        input: "convert-doc",
      },
    },
  });

  const uploadTask = job.tasks.find((t) => t.name === "import-doc");
  await cloudConvert.tasks.upload(uploadTask, docxBuffer, filename, docxBuffer.length);

  job = await cloudConvert.jobs.wait(job.id);

  if (job.status === "error") {
    const failedTask = job.tasks.find((t) => t.status === "error");
    throw new Error(
      `CloudConvert conversion failed: ${failedTask?.message || "unknown error"}`
    );
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

module.exports = { convertDocxBufferToPdf };
