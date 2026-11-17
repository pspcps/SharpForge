const path = require("node:path");

function isTrustedSender(event, window, development) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    return false;
  const url = event.senderFrame.url;
  const entry = window.webContents.getURL();
  return (
    url === entry &&
    (url.startsWith("file:") ||
      (development && new URL(url).origin === "http://localhost:3000"))
  );
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
module.exports = { isTrustedSender, inside };
