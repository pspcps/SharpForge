const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isTrustedSender } = require("../desktop/security.cjs");
test("privileged IPC rejects subframes, foreign windows, and remote content", () => {
  const frame = { url: "file:///app/index.html" };
  const contents = { mainFrame: frame, getURL: () => frame.url };
  const win = { webContents: contents };
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: frame }, win, false),
    true,
  );
  assert.equal(
    isTrustedSender(
      { sender: contents, senderFrame: { ...frame } },
      win,
      false,
    ),
    false,
  );
  assert.equal(
    isTrustedSender({ sender: {}, senderFrame: frame }, win, false),
    false,
  );
  frame.url = "https://attacker.example";
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: frame }, win, false),
    false,
  );
  frame.url = "http://localhost:3000";
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: frame }, win, false),
    false,
  );
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: frame }, win, true),
    true,
  );
});
