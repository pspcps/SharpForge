self.onmessage = (
  event: MessageEvent<{ pattern: string; flags: string; text: string }>,
) => {
  try {
    const { pattern, flags, text } = event.data;
    if (text.length > 100000 || pattern.length > 2000)
      throw new Error("Limit: 100 KB text and 2000-character pattern");
    const regex = new RegExp(
      pattern,
      flags.includes("g") ? flags : flags + "g",
    );
    const matches = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) && matches.length < 500) {
      matches.push({
        index: match.index,
        value: match[0],
        groups: match.groups || match.slice(1),
      });
      if (match[0] === "") regex.lastIndex++;
    }
    self.postMessage({ matches });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Invalid regular expression",
    });
  }
};
