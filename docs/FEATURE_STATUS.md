# Feature implementation status

The requested categories now have working tools rather than UI-only placeholders. Scope and operational limits are documented in [Advanced developer tools](ADVANCED_TOOLS.md).

| Category | Available workflows |
| --- | --- |
| 2. Solution intelligence | Interactive project/package/type/call dependency map, restored transitive packages, optional Roslyn compiler resolution, relationship inspector, cycles, interface implementations, unused-project candidates, health cards, architecture constraints, framework checks and unresolved-reference validation |
| 6. API testing | REST, GraphQL, all four gRPC call types, WebSockets, session environments, named local collections, session request history/replay, response diffs/JSON viewer, timing statistics, encrypted named bearer tokens and collection assertions/cancellation |
| 10. Log intelligence | Multiple named sources, structured/raw viewing, live file streams, filters/groups, exception groups, stack links, explicit correlation/request timelines, level colors, source comparison and redacted report export |
| 13. Git intelligence | Commit graph, file/hunk staging, branch comparison, merge-side/resolution view, commit impact, file timeline, interactive rebase/continue/abort, merged-branch cleanup, connectivity health and stash snapshots |
| 14. Testing/quality | Existing unified test explorer/project grouping plus real TRX runs/history/timing, Cobertura coverage/navigation, compiler/analyzer diagnostics, decision-count/duplicate-code candidates, format verification and conservative dependency-based test impact |
| 15. Utilities | JSON, XML, YAML, isolated regex, JWT decoding, UTF-8 Base64, SHA-256, UUID, cron, Unix time, URL encoding, certificate metadata, port checks/listeners, process snapshots and folder-size analysis |

“Available” does not mean unlimited or infallible analysis. In particular, unused/dead-code/impact findings are bounded by their evidence; dynamic/reflection dependencies cannot be reconstructed reliably; signatures/tokens are not verified by decoding; external proto imports, arbitrary test scripts and OAuth flows are not provided. SDKs/collectors/OS credential services must be present for their respective native tools. Read the detailed guide before using history-changing or network operations.

Existing configuration comparisons, local source-file history, saved commands, multiple interactive terminals and conditional Claude support are retained. Full LSP-backed editor navigation/refactoring, automatic unsaved-buffer recovery and the other authorized roadmap categories remain separate work.

The full database workbench (7), Windows/IIS management (16), and general plugin execution platform (20) remain excluded as requested.
