export function apiAssertions(
  spec: {
    mode: string;
    expected: number;
    maxMs: number;
    assertionPath?: string;
    assertionValue?: string;
  },
  response: { status?: number; durationMs: number; json?: unknown },
) {
  const checks = [
    {
      name: "HTTP/gRPC status",
      passed: spec.mode === "grpc" || response.status === spec.expected,
    },
    { name: "Response time", passed: response.durationMs <= spec.maxMs },
  ];
  if (spec.assertionPath) {
    let value = response.json;
    for (const raw of spec.assertionPath.split("/").slice(1)) {
      const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      value =
        value && typeof value === "object" && Object.hasOwn(value, key)
          ? (value as Record<string, unknown>)[key]
          : undefined;
    }
    let expected: unknown;
    try {
      expected = JSON.parse(spec.assertionValue || "null");
    } catch {
      expected = spec.assertionValue;
    }
    checks.push({
      name: "JSON pointer " + spec.assertionPath,
      passed: JSON.stringify(value) === JSON.stringify(expected),
    });
  }
  return { checks, passed: checks.every((check) => check.passed) };
}
