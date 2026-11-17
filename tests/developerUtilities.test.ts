import { test } from "node:test";
import assert from "node:assert/strict";
import { runUtility } from "../src/utils/developerUtilities";
test("utilities preserve UTF-8 and reject malformed inputs", async () => {
  const encoded = await runUtility("base64-encode", "Hello नमस्ते 👋");
  assert.equal(await runUtility("base64-decode", encoded), "Hello नमस्ते 👋");
  assert.equal(
    await runUtility("url-decode", await runUtility("url-encode", "a&b=✓")),
    "a&b=✓",
  );
  assert.equal(await runUtility("timestamp", "0"), "1970-01-01T00:00:00.000Z");
  await assert.rejects(runUtility("json", "bad"));
  await assert.rejects(runUtility("timestamp", "not-a-time"));
  const token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.";
  assert.match(await runUtility("jwt", token), /NOT verified/);
  assert.equal(
    await runUtility("sha256", "abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
