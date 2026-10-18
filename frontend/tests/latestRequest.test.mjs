import test from "node:test";
import assert from "node:assert/strict";
import { createLatestRequest } from "../src/api/latestRequest.ts";

test("symptom edits immediately invalidate and abort the previous recommendation", () => {
  const gate = createLatestRequest(); const old = gate.start();
  gate.invalidate();
  assert.equal(old.signal.aborted, true); assert.equal(old.isCurrent(), false);
});
test("out-of-order AI or manual discovery responses cannot replace the newest result", async () => {
  const gate = createLatestRequest(); let firstResolve; let secondResolve; let visible;
  const first = gate.start();
  const firstWork = new Promise((resolve) => { firstResolve = resolve; }).then((value) => { if (first.isCurrent()) visible = value; });
  const second = gate.start();
  const secondWork = new Promise((resolve) => { secondResolve = resolve; }).then((value) => { if (second.isCurrent()) visible = value; });
  secondResolve("new specialty"); await secondWork;
  firstResolve("old specialty"); await firstWork;
  assert.equal(visible, "new specialty"); assert.equal(first.signal.aborted, true);
});
test("changing doctor or date prevents a stale slot response becoming selectable", () => {
  const slots = createLatestRequest(); const previous = slots.start();
  slots.invalidate(); const next = slots.start();
  assert.equal(previous.isCurrent(), false); assert.equal(next.isCurrent(), true);
  slots.invalidate(); assert.equal(next.isCurrent(), false);
});
