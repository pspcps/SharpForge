import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIncidents } from "../src/utils/incidentParser";
test("groups repeated exceptions and preserves source frames and inner exception evidence", () => {
  const output =
    "Unhandled exception. System.InvalidOperationException: Request failed\n ---> System.NullReferenceException: Missing user\n   at Store.Get() in /Users/dev/My App/Store.cs:line 42\n   --- End of inner exception stack trace ---\n   at Program.Main() in /Users/dev/My App/Program.cs:line 8";
  const incidents = parseIncidents(output + "\n" + output);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].count, 2);
  assert.equal(incidents[0].frames[0].file, "/Users/dev/My App/Store.cs");
  assert.equal(incidents[0].frames[0].line, 42);
  assert.equal(incidents[0].chain.length, 1);
});
test("handles framework-only frames and unknown failures without inventing a source", () => {
  assert.equal(
    parseIncidents("System.Exception: Bad\n   at System.Threading.Worker()")[0]
      .frames[0].file,
    undefined,
  );
  assert.equal(
    parseIncidents("[Process] Exited with code 139")[0].type,
    "ProcessExit",
  );
  assert.deepEqual(parseIncidents("[Process] Exited with code 0"), []);
  assert.deepEqual(parseIncidents("ordinary output"), []);
});
test("does not interpret markup from exception messages", () => {
  assert.equal(
    parseIncidents("System.Exception: <img onerror=alert(1)>")[0].message,
    "<img onerror=alert(1)>",
  );
});
