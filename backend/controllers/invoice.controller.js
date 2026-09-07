const Invoice = require("../models/Invoice");
const Shipment = require("../models/shipment");
const mailSender = require("../utils/mailSender");

function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeDateInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const lastInvoice = await Invoice.findOne({ invoiceNo: { $regex: `^${prefix}` } })
    .sort({ createdAt: -1 })
    .lean();

  let nextSequence = 1;
  if (lastInvoice?.invoiceNo) {
    const parts = lastInvoice.invoiceNo.split("-");
    nextSequence = parseInt(parts[2], 10) + 1;
  }

  return `${prefix}${String(nextSequence).padStart(4, "0")}`;
}

function buildInvoiceHtml(invoice, recipient) {
  const rows = invoice.items
    .map((item, index) => {
      // Logic for Reserved Rows vs Item Rows
      const isReserved = index < 2;
      // Start SR NO from 1 only on the 3rd item (index 2)
      const srNo = isReserved ? "" : index - 1; 
      
      // Visual Separation: Light gray background for reserved rows
      const rowStyle = isReserved 
        ? 'style="background-color: #f8fafc; font-weight: 500;"' 
        : '';
      
      // Divider logic: Add a thicker bottom border to the 2nd reserved row
      const cellStyle = (index === 1) 
        ? 'style="border-bottom: 2px solid #cbd5e1;"' 
        : '';

      return `
        <tr ${rowStyle}>
          <td ${cellStyle} align="center">${srNo}</td>
          <td ${cellStyle}>${item.description || ""}</td>
          <td ${cellStyle}>${item.refPartInvNo || ""}</td>
          <td ${cellStyle}>${item.hsnCode || ""}</td>
          <td ${cellStyle}>${item.qty || 0}</td>
          <td ${cellStyle}>${item.unitPrice || 0}</td>
          <td ${cellStyle}>${item.amount || 0}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <h2 style="margin:0 0 8px; color:#1d4ed8;">Invoice ${invoice.invoiceNo}</h2>
      <p style="margin:0 0 16px;">Dear ${recipient || invoice.billTo.companyName || "Customer"},</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; font-size: 13px; border: 1px solid #e5e7eb;">
        <thead>
          <tr style="background:#eff6ff;">
            <th>Sr No</th>
            <th>Description</th>
            <th>Ref Part Inv No</th>
            <th>HSN Code</th>
            <th>Qty (Pcs)</th>
            <th>Unit Price (USD)</th>
            <th>Amount (USD)</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p style="margin-top:16px; text-align: right;"><b>Total Amount:</b> USD ${invoice.totalAmount || 0}</p>
      <p style="margin:0;">Regards,<br/>Blue Ocean Consulting</p>
    </div>
  `;
}

exports.createInvoice = async (req, res) => {
  try {
    const body = req.body || {};
    const invoiceNo = body.invoiceNo && body.invoiceNo !== "auto"
      ? body.invoiceNo
      : await generateInvoiceNumber();

    const items = Array.isArray(body.items)
      ? body.items.map((item) => {
          const qty = normalizeNumber(item.qty);
          const unitPrice = normalizeNumber(item.unitPrice);
          return {
            description: item.description || "",
            refPartInvNo: item.refPartInvNo || "",
            hsnCode: item.hsnCode || "",
            qty,
            unitPrice,
            amount: normalizeNumber(item.amount) || qty * unitPrice,
          };
        })
      : [];

    const totalAmount = items.reduce((sum, item) => sum + normalizeNumber(item.amount), 0);

    const invoice = await Invoice.create({
      invoiceNo,
      invoiceDate: normalizeDateInput(body.invoiceDate) || new Date(),
      billTo: {
        companyName: body.billTo?.companyName || "",
        address: body.billTo?.address || "",
        contactNumber: body.billTo?.contactNumber || "",
        blNo: body.billTo?.blNo || "",
      },
      items,
      totalAmount,
    });

    res.status(201).json(invoice);
  } catch (err) {
    console.error("Create invoice error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).lean();
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    res.json(invoice);
  } catch (err) {
    console.error("Get invoice error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.sendInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).lean();
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const to = req.body?.to;
    if (!to) return res.status(400).json({ message: "Recipient email is required" });

    const html = buildInvoiceHtml(invoice, to);
    await mailSender(to, `Invoice ${invoice.invoiceNo}`, html);

    res.json({ success: true });
  } catch (err) {
    console.error("Send invoice error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.generateInvoiceNumber = generateInvoiceNumber;