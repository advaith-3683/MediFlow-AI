const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const MedicalRecord = require("../../models/MedicalRecord");
const { createFileStore } = require("../../services/medicalFiles");
const copy = value => JSON.parse(JSON.stringify(value));
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === "$or") return value.some(item => matches(row, item));
  if (value && typeof value === "object" && !value._bsontype) return Object.entries(value).every(([op, rhs]) => op === "$exists" ? (row[key] !== undefined) === rhs : op === "$ne" ? row[key] !== rhs : op === "$in" ? rhs.includes(row[key]) : op === "$lt" ? new Date(row[key]) < new Date(rhs) : false);
  return String(row[key]) === String(value);
});
const medicalFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mediflow-files-"));
  const rows = [], flags = {};
  const query = (filter, many = false) => {
    let includeHash = false;
    return { select(value) { includeHash = value.includes("+fileSha256"); return this; }, sort() { return this; }, then(resolve, reject) {
      return Promise.resolve().then(() => {
        if (flags.failRead) throw new Error("Synthetic read failure");
        const values = rows.filter(row => matches(row, filter)).map(row => { const value = copy(row); if (!includeHash) delete value.fileSha256; return value; });
        return many ? values : values[0] || null;
      }).then(resolve, reject);
    } };
  };
  const Model = {
    find: filter => query(filter, true), findOne: filter => query(filter),
    async create(values) {
      if (flags.failCreate) throw new Error("Synthetic database failure");
      const doc = new MedicalRecord(values); await doc.validate(); const row = { ...copy(doc.toObject()), createdAt: new Date().toISOString() }; rows.push(row);
      if (flags.failCreateAfter) throw new Error("Synthetic lost creation receipt");
      return doc;
    },
    async findOneAndUpdate(filter, change) {
      const row = rows.find(item => matches(item, filter)); if (!row) return null;
      if (change.$set.storageState === "ready" && flags.failPromote) throw new Error("Synthetic promotion failure");
      Object.assign(row, change.$set);
      if (change.$set.storageState === "ready" && flags.failPromoteAfter) throw new Error("Synthetic lost promotion receipt");
      return copy(row);
    },
    async deleteOne(filter) { if (flags.failDelete) throw new Error("Synthetic delete failure"); const index = rows.findIndex(row => matches(row, filter)); if (index < 0) return { deletedCount: 0 }; rows.splice(index, 1); return { deletedCount: 1 }; },
    async updateOne(filter, changes) { const row = rows.find(item => matches(item, filter)); if (row) Object.assign(row, changes.$set); return { modifiedCount: row ? 1 : 0 }; },
  };
  const store = createFileStore(root);
  return { root, rows, flags, Model, store, async cleanup() { await fs.rm(root, { recursive: true, force: true }); } };
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const pdf = () => {
  let text = "%PDF-1.4\n"; const offsets = [0];
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>"];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
};
const file = (buffer = png, originalname = "synthetic.png", mimetype = "image/png") => ({ buffer, originalname, mimetype });
module.exports = { medicalFixture, matches, png, pdf, file };
