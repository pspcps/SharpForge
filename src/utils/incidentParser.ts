export interface IncidentFrame {
  method: string;
  file?: string;
  line?: number;
}
export interface Incident {
  id: string;
  type: string;
  message: string;
  count: number;
  frames: IncidentFrame[];
  chain: string[];
  raw: string;
  suggestion: string;
}
export function suggestionFor(type: string): string {
  if (/NullReference/.test(type))
    return "Inspect the first application frame and check which receiver is null. Break on thrown exceptions to inspect locals before unwinding.";
  if (/AddressInUse|SocketException/.test(type))
    return "Check the Ports panel for a conflicting listener. Verify the launch profile and configured port before stopping another process.";
  if (/SqlException|DbUpdate|Npgsql/.test(type))
    return "Inspect the inner exception, database availability, migrations and parameter values. Do not include connection secrets in shared reports.";
  if (/FileNotFound|DirectoryNotFound/.test(type))
    return "Check the working directory, requested path and whether required files are copied to the build output.";
  if (/UnauthorizedAccess/.test(type))
    return "Check file ownership and application permissions for the requested resource.";
  if (/HttpRequest|Timeout|TaskCanceled/.test(type))
    return "Check the destination service, cancellation token and timeout. Inspect the inner exception for network or TLS details.";
  return "Start at the first application source frame. Inspect the inner exception and reproduce with a breakpoint at that location. This suggestion is a starting point, not a confirmed cause.";
}
/** Parse captured output only; never execute or render log text as HTML. */
export function parseIncidents(text: string): Incident[] {
  const incidents: Incident[] = [];
  let current: Incident | undefined;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const exit = line.match(/\[Process\] Exited with code (-?\d+)/);
    if (exit && Number(exit[1]) !== 0) {
      if (!current)
        incidents.push({
          id: String(incidents.length),
          type: "ProcessExit",
          message: `Process exited with code ${exit[1]}`,
          count: 1,
          frames: [],
          chain: [],
          raw: line,
          suggestion:
            "No managed exception was captured. Check Terminal output and macOS crash reports, then reproduce under the debugger. An exit code alone does not establish the cause.",
        });
      current = undefined;
      continue;
    }
    const exception = line.match(
      /(?:^|\s|--->\s)((?:[\w`]+\.)*[\w`]*(?:Exception|Error)):\s*(.*)/,
    );
    if (exception) {
      if (line.includes("--->") && current) {
        current.chain.push(`${exception[1]}: ${exception[2]}`);
        current.raw += "\n" + line;
        continue;
      }
      current = {
        id: String(incidents.length),
        type: exception[1],
        message: exception[2],
        count: 1,
        frames: [],
        chain: [],
        raw: line,
        suggestion: suggestionFor(exception[1]),
      };
      incidents.push(current);
    } else if (
      current &&
      (/^\s*at\s/.test(line) || /End of inner exception|--- End/.test(line))
    ) {
      current.raw += "\n" + line;
      const frame = line.match(
        /^\s*at\s+(.+?)(?:\s+in\s+(.+):line\s+(\d+))?\s*$/,
      );
      if (frame)
        current.frames.push({
          method: frame[1],
          file: frame[2],
          line: frame[3] ? Number(frame[3]) : undefined,
        });
    }
  }
  const groups = new Map<string, Incident>();
  for (const incident of incidents) {
    const key =
      incident.type +
      incident.message +
      incident.frames.map((f) => f.method + f.file + f.line).join("|");
    const prior = groups.get(key);
    if (prior) prior.count++;
    else groups.set(key, incident);
  }
  return [...groups.values()].reverse();
}
