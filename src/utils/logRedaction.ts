/** Best-effort redaction for exports; callers must still review reports before sharing. */
export function redactLogText(text: string): string {
  const sensitive =
    /password|passphrase|secret|token|authorization|credential|connectionstrings?|api.?key/i;
  const scrub = (value: string) =>
    value
      .replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]")
      .replace(
        /(["']?(?:password|passphrase|secret|token|authorization|credential|connectionstring|apikey)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
        "$1[REDACTED]",
      );
  try {
    const value: unknown = JSON.parse(text);
    const visit = (item: unknown, depth = 0): unknown => {
      if (depth > 50) return "[depth limit]";
      if (Array.isArray(item))
        return item.map((value) => visit(value, depth + 1));
      if (item && typeof item === "object")
        return Object.fromEntries(
          Object.entries(item).map(([key, value]) => [
            key,
            sensitive.test(key) ? "[REDACTED]" : visit(value, depth + 1),
          ]),
        );
      return typeof item === "string" ? scrub(item) : item;
    };
    return JSON.stringify(visit(value));
  } catch {
    return scrub(text);
  }
}
