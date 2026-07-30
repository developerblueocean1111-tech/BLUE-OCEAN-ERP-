const mongoose = require('mongoose');
const FileSchema = new mongoose.Schema({
  filename: String,
  url: String,
  uploadedAt: { type: Date, default: Date.now },
  meta: Object
});
module.exports = mongoose.model('File', FileSchema);
