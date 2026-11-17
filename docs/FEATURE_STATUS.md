# Feature implementation status

The authorized scope includes the green and yellow categories. A category appearing below does not mean every item in its original list is implemented.

## Implemented in this increment

| Category | Implemented slice | Limits |
| --- | --- | --- |
| 1. Code editor | Read-only text/file comparison and bounded local source-file history | History previews previous disk saves; no automatic rollback or unsaved-buffer recovery |
| 2. Solution intelligence | Dependency map, incoming/outgoing references, strongly connected cycle groups, unresolved reference list | Uses loaded project model, not complete conditional MSBuild evaluation; no unused-code claim |
| 8. Configuration intelligence | JSON key/value comparison, type changes, added/missing values, recognized secret-key masking in results | Local/pasted inputs; no production environment access or complete secret detection |
| 10. Log intelligence | Search and level filters, structured JSON inspection, explicit trace/correlation filters | Retained run/debug output only; no inference across uninstrumented services |
| 11. NuGet intelligence | Cross-project package declarations and differing version detection | No transitive resolution, vulnerability checks, compatibility verdict or legal clearance |
| 15. Utilities | JSON formatting, UTF-8 Base64, URL encoding, SHA-256, UUID, Unix seconds to UTC, JWT decoding | JWT signature and claims are not verified |

## Existing work retained

The draft already includes grouped exception reports, clickable stack locations, saved workspace commands, common action shortcuts, multiple PTY terminals and conditional local Claude support.

## Authorized follow-up work not yet implemented

- Full LSP-backed navigation/refactors; bookmarks/snippets and automatic session recovery.
- ASP.NET/EF read-only runtime/project explorers, migration script previews.
- Multi-service orchestration with cancellation, dependency readiness and owned-process shutdown.
- API collections with credential isolation and explicit target selection.
- Debugger exception controls, thread/task views and watch comparisons.
- NuGet transitive/advisory feeds and previews of upgrade restore/build/test results.
- Docker inspection and permission-scoped operations.
- Git graph, staging and protected change previews.
- Coverage, static-analysis results and test-impact evidence.
- Optional bounded runtime profiling and diagnostics capture.
- Explicitly invoked task pipelines with cancellation and failure handling.

## Excluded / postponed

Do not implement the full database workbench (category 7), Windows/IIS management (16), or general plugin/extension execution platform (20) without a new scope decision. Existing theme-import behavior is retained, not expanded into a plugin platform.

## Verification for this increment

Automated tests cover reference/cycle analysis, configuration keys/types/secret field detection, structured log extraction, utility validation and UTF-8, and file-history deduplication/retention/config exclusion/symlink exclusion. Browser checks exercise each workbench section, configuration mask/reveal, successful and failed utility inputs, file diff disposal and empty history. Desktop/macOS history saving and packaged editor behavior still need acceptance testing on macOS.
