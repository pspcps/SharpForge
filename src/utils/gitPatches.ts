/** Split a single-file textual unified diff into independently stageable hunks. */
export function patchHunks(patch: string) {
  const lines = patch.split("\n"),
    start = lines.findIndex((line) => line.startsWith("@@ "));
  if (start < 0) return [];
  const header = lines.slice(0, start).join("\n") + "\n";
  const result: { label: string; patch: string; text: string }[] = [];
  let group: string[] = [];
  for (const line of lines.slice(start)) {
    if (line.startsWith("@@ ") && group.length) {
      result.push({
        label: group[0],
        patch: header + group.join("\n") + "\n",
        text: group.join("\n"),
      });
      group = [];
    }
    group.push(line);
  }
  if (group.length) {
    while (group.at(-1) === "") group.pop();
    result.push({
      label: group[0],
      patch: header + group.join("\n") + "\n",
      text: group.join("\n"),
    });
  }
  return result;
}
