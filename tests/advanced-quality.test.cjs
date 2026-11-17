const { test } = require("node:test");
const assert = require("node:assert/strict");
const { coverageReport } = require("../desktop/advanced-quality.cjs");
test("coverage parser preserves uncovered source lines and rejects non-Cobertura/entity reports", () => {
  const report = coverageReport(
    '<coverage line-rate="0.5" branch-rate="0"><packages><package><classes><class filename="Calc.cs" line-rate="0.5"><lines><line number="2" hits="1"/><line number="3" hits="0"/></lines></class></classes></package></packages></coverage>',
  );
  assert.equal(report.files[0].lines[1].hits, 0);
  assert.equal(report.lineRate, 0.5);
  assert.throws(() => coverageReport("<other/>"));
  assert.throws(() => coverageReport("<!DOCTYPE coverage><coverage/>"));
});
