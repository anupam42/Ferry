# Ferry roadmap

Ideas for where Ferry could go next. The priority labels (P0 = most important) suggest an order to work in; they are not commitments or estimates.

Want to pick one up? Comment on its issue (or open one), then see [CONTRIBUTING.md](CONTRIBUTING.md).

**Legend:** ✅ available today · 🟡 partly there (the note says what exists) · no mark = not started

## P0 — Core reliability and safety

1. Crash recovery and automatic sync resumption. 🟡 two-way state, held conflicts and pending resolve requests survive a restart
2. Concurrent file modification handling. 🟡 changes are applied only after the folder stops changing (`settle`), and large batches wait
3. File integrity verification using checksums. 🟡 SHA-256 content hashes decide what changed; copies aren't re-verified afterwards
4. Case-sensitive filename collision detection.
5. Sync loop and duplicate event prevention. 🟡 refuses nested folders and shared targets; identical files are never rewritten
6. Advanced configuration validation. 🟡 config errors name the line and the pair; `ferry doctor` checks the setup
7. Remote transfer retry and recovery queue. 🟡 failed ssh and cloud uploads are retried on the next pass
8. Cross-platform end-to-end integration testing. 🟡 CI runs the tests and a binary smoke test on Ubuntu, macOS and Windows

## P1 — Developer experience and UI

9. Interactive CLI setup wizard.
10. Modern real-time web dashboard. ✅ `ferry ui`
11. Visual source-to-target folder mapping. 🟡 the web app's folder picker; `map:` in the config
12. Live file diff and change preview. ✅ diffs in the dashboard, the web app and `ferry plan --diff`
13. Preconfigured synchronization templates.
14. Project-level configuration and environment variables. 🟡 `./ferry.yaml` is picked up automatically; `FERRY_HOME`, `FERRY_TOKEN`
15. Advanced VS Code extension with file explorer. 🟡 the extension in `editors/vscode` (status, conflicts, history, commit)
16. Built-in synchronization performance benchmarks.
17. Drag-and-drop folder synchronization.
18. Global search across synchronized files. 🟡 `/` filters files and activity in the dashboard
19. Customizable keyboard shortcuts.
20. Dark and light themes with UI preferences. ✅ `--theme auto|dark|light|mono`; the web app follows the system theme
21. Desktop application using Tauri.
22. System tray synchronization controls.
23. One-click pause, resume and rollback. ✅ dashboard keys, web app buttons, `ferry undo` / `ferry restore`
24. Synchronization activity timeline. ✅ `ferry history`, the dashboard's history view, the web app's History tab

## P2 — Remote, cloud and container sync

25. Docker container file synchronization.
26. Bidirectional SSH synchronization. 🟡 ssh targets are one-way today
27. Compressed SSH transfers using zstd.
28. Delta-based file synchronization.
29. rclone integration for additional cloud providers.
30. Bandwidth throttling and transfer limits. 🟡 `max_ops_per_sec` limits file operations, not bytes
31. Remote workspace initialization and bootstrap.
32. End-to-end encrypted cloud synchronization.
33. SFTP synchronization support.
34. Kubernetes pod file synchronization.
35. Remote development workspace synchronization.
36. Offline synchronization queue. 🟡 unsent remote changes are kept and retried
37. Automatic network reconnection. 🟡 the next pass retries after a failed push
38. Parallel file transfer optimization. 🟡 cloud uploads run 8 at a time; ssh sends one archive per pass
39. Large-file chunked synchronization.
40. Remote file permission and ownership management. 🟡 permissions are kept; ownership isn't

## P2 — Git and repository automation

41. Smart Git branch synchronization. 🟡 `--branch` switches to (or creates) a branch first
42. Cross-repository file synchronization. ✅ one source into several targets (`targets:`)
43. Automated pull request creation with previews. 🟡 `--pr` opens a PR with `gh`; `ferry plan --format markdown` for previews
44. Git commit policy enforcement.
45. Git worktree synchronization.
46. Repository drift detection. 🟡 `--check-upstream` pauses while the target is behind its upstream
47. GitHub Actions integration.
48. Azure DevOps pipeline integration.
49. GitLab CI/CD integration.
50. Automatic branch creation for synchronized changes. 🟡 `--branch` creates the branch if it's missing
51. Selective file staging and committing. ✅ `a` in the dashboard stages a file; `c` commits only staged files
52. Git conflict visualization and resolution. ✅ dashboard, web app and VS Code, with three-way merge
53. Automatic test execution before commits. ✅ `--before-commit "npm test"`
54. Repository synchronization health monitoring. 🟡 `ferry status`, `ferry doctor`, webhooks
55. Shared component synchronization across monorepos. 🟡 `map:` turns one pair into one per sub-folder
56. Automatic dependency change detection.

## P3 — AI-powered features

57. AI-assisted conflict resolution.
58. Local AI integration using Ollama.
59. AI-generated Git commit messages. ✅ `{ai}` in commit templates, `ferry commit --ai`
60. AI-powered code change summaries.
61. AI-based secret and security risk detection. 🟡 pattern-based secret scanning and `secrets: redact` (no AI)
62. AI coding workspace integration.
63. Natural-language synchronization commands.
64. AI-powered synchronization error diagnosis.
65. AI-generated pull request descriptions.
66. AI-assisted code review before synchronization.
67. AI-powered duplicate file detection.
68. AI-based intelligent file mapping.
69. AI-assisted rollback recommendations.
70. AI-generated synchronization reports.
71. AI-powered repository change impact analysis.
72. AI-assisted merge conflict explanations.

## P3 — Team collaboration and enterprise

73. Shared team synchronization profiles.
74. Approval-based synchronization workflows. 🟡 `batch_action: confirm` asks before large batches
75. Centralized synchronization audit logs. 🟡 per-machine history in `ferry history`
76. Role-based access control.
77. Prometheus metrics endpoint.
78. OpenTelemetry monitoring integration.
79. Signed release binaries and verification. 🟡 releases ship `checksums.txt`; binaries aren't signed
80. Team synchronization dashboard.
81. Multi-user workspace synchronization.
82. Team activity notifications. 🟡 webhooks
83. Slack and Microsoft Teams integration. 🟡 Slack, Discord and ntfy webhooks; no Teams format yet
84. Synchronization policy enforcement.
85. Protected folder and repository rules.
86. Centralized configuration management.
87. Team synchronization analytics. 🟡 per-machine `ferry stats`
88. Enterprise SSO integration.

## P4 — Advanced and unique features

89. AI Workspace Bridge for AI-generated code.
90. Visual Safe Sync Timeline with point-in-time restore. 🟡 `ferry restore --at "2h ago"` and "Go back" in the web app; no visual timeline yet
91. Cross-Repository Component Sync Engine.
92. Automatic workspace snapshots. 🟡 per-file backups before every overwrite or delete
93. Smart incremental synchronization. ✅ only changed files are compared and copied; hashes are cached
94. Content-aware file synchronization. 🟡 `transform:` pipes files through a command; binary and size rules
95. Dependency-aware synchronization ordering.
96. File synchronization simulation mode. ✅ `ferry plan` and `--dry-run`
97. Automatic environment configuration synchronization.
98. Workspace cloning and replication.
99. Developer workspace migration assistant.
100. Plugin architecture for custom sync providers.
101. Custom pre-sync and post-sync hooks. 🟡 `before_commit` and `transform:`; no pre/post-sync hooks yet
102. Synchronization rules based on file content.
103. Scheduled synchronization with cron expressions. 🟡 `--every 15m`, `--window 09:00-18:00`, `--days mon-fri`
104. Multi-device workspace synchronization.
105. Local peer-to-peer synchronization.
106. Real-time synchronization performance analytics.
107. Automatic backup compression and deduplication. 🟡 backup age and size limits; no compression
108. Self-healing synchronization engine.
109. REST API and SDK for third-party integrations. 🟡 the local HTTP API; no SDK
110. Ferry CLI plugin marketplace.

In total: 110 ideas, some extending what Ferry already does and some entirely new.
