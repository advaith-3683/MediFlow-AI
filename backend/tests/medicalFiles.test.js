const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { validateFile, visibleRecordFilter, MAX_FILE_SIZE } = require("../services/medicalFiles");
const { createRecordService } = require("../services/medicalRecords");
const { medicalFixture, png, pdf, file } = require("./helpers/medicalFixture.cjs");
const patientId = "507f1f77bcf86cd799439011";
const input = () => ({ patientId, body: { title: "Synthetic record", recordType: "Lab Report" }, file: file() });
test("PNG and PDF contents, MIME and extensions are validated", () => {
  assert.equal(validateFile(file()).mime, "image/png");
  assert.equal(validateFile(file(pdf(), "synthetic.PDF", "application/pdf")).mime, "application/pdf");
});
for (const [label, value] of [
  ["HTML disguised as PNG", file(Buffer.from("<script>synthetic</script>"))],
  ["wrong extension", file(png, "synthetic.pdf")], ["double executable extension", file(png, "synthetic.png.html")],
  ["SVG content", file(Buffer.from("<svg/>"), "synthetic.svg", "image/svg+xml")],
  ["empty file", file(Buffer.alloc(0))], ["truncated PNG", file(png.subarray(0, 30))],
  ["trailing PNG payload", file(Buffer.concat([png, Buffer.from("extra")]))],
  ["truncated JPEG", file(Buffer.from([255, 216, 255, 217]), "synthetic.jpg", "image/jpeg")],
  ["JPEG with missing scan header", file(Buffer.from([255,216,255,192,0,8,8,0,1,0,1,0,255,218,255,217]), "synthetic.jpg", "image/jpeg")],
  ["active PDF", file(Buffer.from(pdf().toString().replace("/Catalog", "/Catalog /OpenAction 9 0 R")), "synthetic.pdf", "application/pdf")],
]) test(`reject ${label}`, () => assert.throws(() => validateFile(value), { status: 400 }));
test("actual byte count enforces file size, independent of claimed metadata", () => {
  assert.throws(() => validateFile({ ...file(Buffer.alloc(MAX_FILE_SIZE + 1)), size: 1 }), { status: 413 });
});
test("validated upload creates pending metadata then ready file with private digest", async t => {
  const h = await medicalFixture(); t.after(h.cleanup);
  const record = await createRecordService(h.Model, h.store).create(input());
  assert.equal(record.storageState, "ready"); assert.equal(h.rows.length, 1);
  assert.equal((await h.store.read(h.rows[0])).buffer.equals(png), true);
});
test("invalid metadata and record types never write metadata or files", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); const api = createRecordService(h.Model, h.store);
  for (const body of [{ title: " " }, { title: "Synthetic", recordType: "Unknown" }, { title: { invalid: true } }]) await assert.rejects(api.create({ ...input(), body }), { status: 400 });
  assert.equal(h.rows.length, 0); assert.deepEqual(await fs.readdir(h.root), []);
});
test("record types preserve Scan/Diagnosis and support Imaging alias and discharge summaries", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); const api = createRecordService(h.Model, h.store);
  for (const type of ["Scan", "Diagnosis", "Imaging", "Discharge Summary"]) {
    const record = await api.create({ ...input(), file: undefined, body: { title: "Synthetic", recordType: type } });
    assert.equal(record.recordType, type === "Imaging" ? "Scan" : type);
  }
});
test("database creation failure leaves no file; ambiguous creation leaves recoverable pending metadata", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); const api = createRecordService(h.Model, h.store);
  h.flags.failCreate = true; await assert.rejects(api.create(input())); assert.deepEqual(await fs.readdir(h.root), []);
  h.flags.failCreate = false; h.flags.failCreateAfter = true; await assert.rejects(api.create(input()));
  assert.equal(h.rows[0].storageState, "pending"); assert.deepEqual(await fs.readdir(h.root), []);
});
test("disk failure is recoverable and hidden, without an invented upload success", async t => {
  const h = await medicalFixture(); t.after(h.cleanup);
  await assert.rejects(createRecordService(h.Model, { ...h.store, write: async () => { throw new Error("Synthetic disk failure"); } }).create(input()), { code: "UPLOAD_PENDING" });
  assert.equal(h.rows[0].storageState, "pending"); assert.deepEqual(await h.Model.find({ patient: patientId, ...visibleRecordFilter() }), []);
});
test("lost ready acknowledgement never deletes a possibly committed file", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); h.flags.failPromoteAfter = true;
  await assert.rejects(createRecordService(h.Model, h.store).create(input()), { code: "UPLOAD_PENDING" });
  assert.equal(h.rows[0].storageState, "ready"); assert.equal((await h.store.read(h.rows[0])).buffer.equals(png), true);
});
test("file removal failure retains a deleting receipt for safe retry", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); const api = createRecordService(h.Model, h.store); const record = await api.create(input());
  const failing = createRecordService(h.Model, { ...h.store, remove: async () => { throw new Error("Synthetic permission failure"); } });
  await assert.rejects(failing.remove({ id: record._id, patientId })); assert.equal(h.rows[0].storageState, "deleting");
  assert.deepEqual(await h.Model.find(visibleRecordFilter()), []);
  await api.remove({ id: record._id, patientId }); assert.equal(h.rows.length, 0); assert.deepEqual(await fs.readdir(h.root), []);
});
test("metadata delete failure after unlink can be retried without losing a cleanup receipt", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); const api = createRecordService(h.Model, h.store); const record = await api.create(input());
  h.flags.failDelete = true; await assert.rejects(api.remove({ id: record._id, patientId })); assert.equal(h.rows[0].storageState, "deleting");
  h.flags.failDelete = false; await api.remove({ id: record._id, patientId }); assert.equal(h.rows.length, 0);
});
test("another patient cannot read or delete an owned file through service operations", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); const api = createRecordService(h.Model, h.store); const record = await api.create(input());
  await assert.rejects(api.remove({ id: record._id, patientId: "507f1f77bcf86cd799439012" }), { status: 404 });
  assert.equal(h.rows[0].storageState, "ready");
});
test("traversal references and tampered content fail closed", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); const record = await createRecordService(h.Model, h.store).create(input());
  for (const fileUrl of ["/uploads/../outside.pdf", "/uploads/..\\outside.pdf", "file:///etc/passwd", "/uploads/%2e%2e/outside.pdf"]) await assert.rejects(h.store.read({ fileUrl }), { status: 400 });
  await fs.writeFile(path.join(h.root, path.basename(record.fileUrl)), Buffer.from("synthetic tamper"));
  await assert.rejects(h.store.read(h.rows[0]), { status: 400 });
});
test("symbolic links are refused before reading their target", async t => {
  const h = await medicalFixture(); t.after(h.cleanup);
  t.mock.method(fs, "lstat", async () => ({ isFile: () => true, isSymbolicLink: () => true, size: 20 }));
  await assert.rejects(h.store.read({ fileUrl: "/uploads/synthetic.pdf" }), { status: 400 });
});
test("dry-run recovery performs no file/DB mutations; apply recovers only pending/deleting receipts", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); const api = createRecordService(h.Model, h.store);
  h.flags.failPromote = true; await assert.rejects(api.create(input())); h.flags.failPromote = false;
  const before = JSON.stringify(h.rows); const dry = await api.reconcile({ before: new Date(Date.now() + 60000) });
  assert.equal(dry.pending, 1); assert.equal(JSON.stringify(h.rows), before);
  const applied = await api.reconcile({ apply: true, before: new Date(Date.now() + 60000) });
  assert.equal(applied.recovered, 1); assert.equal(h.rows[0].storageState, "ready");
  await fs.writeFile(path.join(h.root, "unmanaged.pdf"), Buffer.from("synthetic unrelated file"));
  await api.reconcile({ apply: true, before: new Date(Date.now() + 60000) });
  assert.ok((await fs.readdir(h.root)).includes("unmanaged.pdf"));
});
test("missing pending upload recovers without touching any ready record", async t => {
  const h = await medicalFixture(); t.after(h.cleanup); const api = createRecordService(h.Model, h.store);
  await api.create({ ...input(), file: undefined }); h.flags.failCreateAfter = true; await assert.rejects(api.create(input()));
  h.flags.failCreateAfter = false;
  await api.reconcile({ apply: true, before: new Date(Date.now() + 60000) });
  assert.equal(h.rows.length, 1); assert.equal(h.rows[0].storageState, "ready");
});
