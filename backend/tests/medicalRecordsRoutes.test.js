const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("node:fs/promises");
const User = require("../models/User");
const Appointment = require("../models/Appointment");
const MedicalRecord = require("../models/MedicalRecord");
const AuditLog = require("../models/AuditLog");
const { createMedicalRecordRouter } = require("../routes/medicalRecords");
const doctorRouter = require("../routes/doctorClinical");
const { errorHandler } = require("../middleware/errorHandler");
const { createRecordService } = require("../services/medicalRecords");
const { medicalFixture, png, file } = require("./helpers/medicalFixture.cjs");
const patientId = "507f1f77bcf86cd799439011", doctorId = "507f1f77bcf86cd799439012";
const setup = async t => {
  const h = await medicalFixture(); const originalSecret = process.env.JWT_SECRET, originalUploads = process.env.UPLOADS_DIRECTORY;
  process.env.JWT_SECRET = "synthetic-file-http-secret"; process.env.UPLOADS_DIRECTORY = h.root;
  let account = { _id: patientId, role: "patient", accountStatus: "active", isVerified: false };
  let relationship = false;
  t.mock.method(User, "findById", () => ({ select: async () => account }));
  t.mock.method(User, "findOne", async () => account.role === "doctor" && account.doctorVerificationStatus === "verified" ? account : null);
  t.mock.method(MedicalRecord, "findOne", filter => h.Model.findOne(filter));
  t.mock.method(Appointment, "exists", async filter => { assert.deepEqual(filter.status, { $in: ["scheduled", "completed"] }); return relationship ? { _id: "synthetic" } : null; });
  const audits = []; t.mock.method(AuditLog, "create", async value => { audits.push(value); return value; });
  t.mock.method(console, "error", () => {});
  const app = express(); app.use(express.json()); app.use("/records", createMedicalRecordRouter({ Model: h.Model, store: h.store })); app.use("/clinical", doctorRouter); app.use(errorHandler);
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await h.cleanup(); if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; if (originalUploads === undefined) delete process.env.UPLOADS_DIRECTORY; else process.env.UPLOADS_DIRECTORY = originalUploads; });
  const request = (path, options = {}, authenticated = true) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...options, headers: { ...(authenticated ? { authorization: `Bearer ${jwt.sign({ userId: account._id }, process.env.JWT_SECRET)}` } : {}), ...options.headers } });
  return { ...h, request, audits, as(value) { account = { ...account, ...value }; }, relationship(value) { relationship = value; } };
};
test("real multipart upload/list/view/download/delete uses private files and authenticated ownership", async t => {
  const h = await setup(t); const body = new FormData(); body.set("title", "Synthetic upload"); body.set("recordType", "Imaging"); body.set("file", new Blob([png], { type: "image/png" }), "synthetic.png");
  const upload = await h.request("/records", { method: "POST", body }); assert.equal(upload.status, 201);
  const { record } = await upload.json(); assert.equal(record.recordType, "Scan"); assert.equal(record.fileSha256, undefined);
  assert.equal((await (await h.request("/records/my")).json()).length, 1);
  const viewed = await h.request(`/records/${record._id}/file`); assert.equal(viewed.status, 200); assert.match(viewed.headers.get("content-type"), /^image\/png/); assert.equal(viewed.headers.get("cache-control"), "private, no-store"); assert.equal(Buffer.from(await viewed.arrayBuffer()).equals(png), true);
  const download = await h.request(`/records/${record._id}/file?download=1`); assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal((await h.request(`/records/${record._id}/file`, {}, false)).status, 401);
  h.as({ _id: "507f1f77bcf86cd799439013" });
  assert.equal((await h.request(`/records/${record._id}/file`)).status, 404); assert.equal((await h.request(`/records/${record._id}`, { method: "DELETE" })).status, 404);
  h.as({ _id: patientId }); assert.equal((await h.request(`/records/${record._id}`, { method: "DELETE" })).status, 200);
  assert.equal(h.rows.length, 0); assert.deepEqual(await fs.readdir(h.root), []);
});
test("invalid metadata, spoofed contents and oversized multipart uploads leave no files", async t => {
  const h = await setup(t);
  for (const [title, buffer, status] of [[" ", png, 400], ["Synthetic", Buffer.from("<html>synthetic</html>"), 400], ["Synthetic", Buffer.alloc(10 * 1024 * 1024 + 1), 413]]) {
    const body = new FormData(); body.set("title", title); body.set("file", new Blob([buffer], { type: "image/png" }), "synthetic.png");
    assert.equal((await h.request("/records", { method: "POST", body })).status, status);
  }
  assert.equal(h.rows.length, 0); assert.deepEqual(await fs.readdir(h.root), []);
});
test("pending/deleting files cannot be read or listed and unsafe references never escape storage", async t => {
  const h = await setup(t); const row = await createRecordService(h.Model, h.store).create({ patientId, body: { title: "Synthetic" }, file: file() });
  for (const state of ["pending", "deleting"]) { h.rows[0].storageState = state; assert.equal((await h.request(`/records/${row._id}/file`)).status, 404); assert.deepEqual(await (await h.request("/records/my")).json(), []); }
  h.rows[0].storageState = "ready"; h.rows[0].fileUrl = "/uploads/../../outside.pdf";
  assert.equal((await h.request(`/records/${row._id}/file`)).status, 400);
  assert.equal((await h.request("/records/not-an-id/file")).status, 400);
});
test("doctor file access requires approval and non-cancelled relationship, and records a controlled audit", async t => {
  const h = await setup(t); const row = await createRecordService(h.Model, h.store).create({ patientId, body: { title: "Synthetic" }, file: file() });
  const path = `/clinical/patients/${patientId}/records/${row._id}/file`;
  h.as({ _id: doctorId, role: "doctor", doctorVerificationStatus: "pending" }); assert.equal((await h.request(path)).status, 403);
  h.as({ doctorVerificationStatus: "verified" }); assert.equal((await h.request(path)).status, 403); assert.equal(h.audits.length, 0);
  h.relationship(true); assert.equal((await h.request(path)).status, 200); assert.equal(h.audits.length, 1); assert.deepEqual(h.audits[0].metadata, { access: "file" });
  h.rows[0].storageState = "deleting"; assert.equal((await h.request(path)).status, 404);
  assert.equal((await h.request(path.replace(patientId, "507f1f77bcf86cd799439014"))).status, 404);
});
