const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { AppError } = require("../middleware/errorHandler");
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const RECORD_TYPES = Object.freeze(["Prescription", "Lab Report", "Scan", "Diagnosis", "Discharge Summary", "Other"]);
const visibleRecordFilter = () => ({ $or: [{ storageState: "ready" }, { storageState: { $exists: false } }] });
const invalid = () => { throw new AppError(400, "Choose a valid PDF, JPG or PNG whose extension and content match its file type", "INVALID_MEDICAL_FILE"); };
const fileType = name => ({ ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" })[path.extname(name).toLowerCase()];
const validateFile = ({ buffer, originalname, mimetype }) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) invalid();
  if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, "File must be 10 MB or smaller", "FILE_TOO_LARGE");
  const mime = mimetype === "image/jpg" ? "image/jpeg" : mimetype;
  if (!fileType(originalname) || mime !== fileType(originalname)) invalid();
  if (mime === "application/pdf") {
    const text = buffer.toString("latin1");
    if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(text) || !/startxref\s+\d+\s+%%EOF\s*$/.test(text) || !/\bobj\b/.test(text)) invalid();
    // Defense in depth only: this is not a PDF sanitizer or malware scanner.
    if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA|Encrypt)\b/i.test(text)) invalid();
  } else if (mime === "image/png") {
    if (buffer.length < 45 || !buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) invalid();
    let offset = 8, first = true, data = false, ended = false;
    while (offset + 12 <= buffer.length) {
      const size = buffer.readUInt32BE(offset), type = buffer.toString("ascii", offset + 4, offset + 8);
      if (size > buffer.length - offset - 12) invalid();
      if (first && (type !== "IHDR" || size !== 13 || !buffer.readUInt32BE(offset + 8) || !buffer.readUInt32BE(offset + 12))) invalid();
      first = false; if (type === "IDAT") data = true;
      offset += size + 12;
      if (type === "IEND") { if (size !== 0 || offset !== buffer.length) invalid(); ended = true; break; }
    }
    if (!data || !ended) invalid();
  } else {
    if (buffer.length < 12 || buffer[0] !== 255 || buffer[1] !== 216 || buffer.at(-2) !== 255 || buffer.at(-1) !== 217) invalid();
    let offset = 2, frame = false, scan = false;
    while (offset < buffer.length - 2) {
      if (buffer[offset++] !== 255) invalid();
      while (buffer[offset] === 255) offset += 1;
      const marker = buffer[offset++];
      if (marker === 218) {
        if (offset + 2 > buffer.length - 2) invalid();
        const size = buffer.readUInt16BE(offset);
        const components = buffer[offset + 2];
        if (!components || components > 4 || size !== 6 + 2 * components || offset + size >= buffer.length - 2) invalid();
        scan = true; break;
      }
      if (marker === 0 || marker === 216 || marker === 217 || offset + 2 > buffer.length) invalid();
      const size = buffer.readUInt16BE(offset);
      if (size < 2 || offset + size > buffer.length) invalid();
      if ([192, 193, 194].includes(marker)) {
        if (size < 8 || !buffer.readUInt16BE(offset + 3) || !buffer.readUInt16BE(offset + 5)) invalid();
        frame = true;
      }
      offset += size;
    }
    if (!frame || !scan) invalid();
  }
  return { mime, size: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex") };
};
const createFileStore = (directory = process.env.UPLOADS_DIRECTORY || path.join(__dirname, "..", "uploads")) => {
  const root = path.resolve(directory);
  const location = fileUrl => {
    if (typeof fileUrl !== "string" || !/^\/uploads\/[a-zA-Z0-9_-]+\.(?:pdf|png|jpe?g)$/i.test(fileUrl)) throw new AppError(400, "Invalid medical file reference", "INVALID_FILE_REFERENCE");
    return path.join(root, fileUrl.slice("/uploads/".length));
  };
  const read = async record => {
    const filename = location(record.fileUrl);
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_SIZE) invalid();
      if (path.dirname(await fs.realpath(filename)) !== await fs.realpath(root)) invalid();
      const handle = await fs.open(filename, require("node:fs").constants.O_RDONLY | (require("node:fs").constants.O_NOFOLLOW || 0));
      let buffer;
      try { if ((await handle.stat()).size > MAX_FILE_SIZE) invalid(); buffer = await handle.readFile(); } finally { await handle.close(); }
      const info = validateFile({ buffer, originalname: filename, mimetype: record.fileMimeType || fileType(filename) });
      if (record.fileSha256 && info.sha256 !== record.fileSha256) invalid();
      return { buffer, ...info, filename: path.basename(filename) };
    } catch (error) {
      if (error.code === "ENOENT") throw new AppError(404, "Medical file not found", "MEDICAL_FILE_MISSING");
      throw error;
    }
  };
  return {
    read,
    async write(fileUrl, buffer) { await fs.mkdir(root, { recursive: true, mode: 0o700 }); await fs.writeFile(location(fileUrl), buffer, { flag: "wx", mode: 0o600 }); },
    async remove(fileUrl) { const filename = location(fileUrl); try { const stat = await fs.lstat(filename); if (!stat.isFile() || stat.isSymbolicLink()) invalid(); await fs.unlink(filename); } catch (error) { if (error.code !== "ENOENT") throw error; } },
  };
};
const sendMedicalFile = async (record, req, res, store = createFileStore(), loadedFile) => {
  const file = loadedFile || await store.read(record);
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Content-Disposition": `${req.query.download === "1" ? "attachment" : "inline"}; filename="${file.filename}"` });
  res.type(file.mime).send(file.buffer);
};
module.exports = { MAX_FILE_SIZE, RECORD_TYPES, visibleRecordFilter, validateFile, createFileStore, sendMedicalFile };
