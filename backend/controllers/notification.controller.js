const mailSender = require("../utils/mailSender");

exports.sendTrackingEmailNotification = async (req, res) => {
  try {
    const {
      to,
      subject,
      message,
      bl_no,
      container_no,
      etd,
      eta,
    } = req.body;

    const html = `
        <h3>Shipment Tracking Details</h3>
        <table border="1" cellpadding="8">
          <tr><td><b>BL No</b></td><td>${bl_no}</td></tr>
          <tr><td><b>Container No</b></td><td>${container_no}</td></tr>
          <tr><td><b>ETD</b></td><td>${etd}</td></tr>
          <tr><td><b>ETA</b></td><td>${eta}</td></tr>
        </table>
        <p>${message}</p>
      `;

    await mailSender(
      to,
      subject,
      html,
    );

    res.json({ success: true });
  } catch (err) {
    console.error("MAIL ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
