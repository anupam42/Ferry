# GitKraken plans and features (reference)

A summary of what GitKraken offers on each plan, kept here as a reference while planning Ferry's roadmap. GitKraken changes its plans and prices often, so check [gitkraken.com/pricing](https://www.gitkraken.com/pricing) before relying on any detail.

*Compiled on 9 November 2026 from GitKraken's [pricing page](https://www.gitkraken.com/pricing) and its [subscription help page](https://help.gitkraken.com/gk-dev/gk-dev-subscription/) (last updated April 2026).*

## The plans at a glance

| | Community | Pro | Advanced | Business | Enterprise |
|---|---|---|---|---|---|
| Price | Free | per seat, billed yearly | per seat, billed yearly | per seat, billed yearly | quote |
| Seats | 1 | up to 2 | up to 10 | up to 100 | 100+ |
| Private repositories | no (local and public only) | yes | yes | yes | yes |
| Team management | no | no | yes | yes | yes |
| Self-hosted Git (GitHub Enterprise, GitLab Self-Managed…) | no | no | yes | yes | yes |
| AI | none on Desktop | basic | org controls | org-enforced providers | full |
| AI credits per user per week | – | up to 1,000,000 | up to 2,000,000 | up to 3,000,000 | up to 4,000,000 |
| Automations | no | no | preview | yes | yes |
| Single sign-on | no | no | single domain (SAML 2.0) | multi-domain | yes, including LDAP |
| Self-hosted Cloud Patch storage (S3) | no | no | no | yes | yes |
| Support response | community (Slack, Help Center) | 3 business days | 1 business day | 12 hours | 6 hours, with an SLA |
| Free trial | 14 days of Advanced | 14 days | 14 days | 30 days | 30 days of Business |

**Prices:** GitKraken's pricing page doesn't show dollar amounts in a form that could be read for this summary. Other sources disagree: Pro is listed at [$4](https://www.capterra.com/p/10035742/GitKraken-Desktop/) or [$10](https://getpulsesignal.com/compare/github-vs-gitkraken) per seat per month. Advanced is listed at $12 or $14, with [a notice](https://www.schneider.im/gitkraken-new-list-prices-for-new-sales-and-renewals/) saying it moves to $14 from 8 July 2026. Business is listed at $216 per user per year. All paid plans are billed yearly, and prices exclude tax.

**The two GitKraken pages disagree in places:** the pricing page says Enterprise starts at 20+ seats, while the help page says 100+. The help page says Community has no AI, while the pricing page says GitLens's AI works for Community users through built-in GitHub Copilot.

## What each plan adds

Each plan includes everything in the plan before it.

**Community (free)**
- GitKraken Desktop (the visual Git client), GitLens for VS Code, the GitKraken CLI, Kepler and GitKraken.dev.
- Only local repositories and public remotes. Many Desktop features (Gitflow, Git LFS, worktrees, the Git-enhanced terminal, agent workflows) work on public repositories only.
- Unlimited cloud Git integrations (GitHub, GitLab, Bitbucket, Azure DevOps); issue trackers are view-only.
- Agent Sessions View, for public repositories only.
- Support through Slack and the Help Center.

**Pro** adds
- Private repositories.
- Cloud issue trackers: Jira Cloud and Trello.
- Conflict Detection: warns when teammates edit the same files before you merge.
- Launchpad: one view of your pull requests and issues across services.
- Shared Cloud Workspaces: groups of repositories shared with a teammate.
- GitKraken AI credits, or bring your own AI key.
- GitKraken Code Review, essential AI features (commit messages, explanations), Agent Sessions View for private repositories, and the GitKraken MCP server.

**Advanced** adds
- Self-hosted Git and enterprise integrations.
- Single-domain SSO (SAML 2.0).
- Team Launchpad.
- Automations (preview).
- AI security controls and private AI model providers.
- AI changelog generation in GitLens ("coming soon" to Desktop).

**Business** adds
- Multi-domain SSO and an internal software directory.
- GitKraken Insights (engineering metrics; access limits may apply).
- An admin control for Conflict Prevention.
- Organization-wide bring-your-own AI key, and AI controls the organization can enforce.
- A customer success manager, and Git training and certification.

**Enterprise** adds
- Custom terms, contracts and security questionnaires.
- Security audit logs.
- A 6-hour support response time with a service SLA, and a dedicated customer success manager.
- All AI models supported.

### GitKraken Desktop features by area

The pricing page groups Desktop features like this. It doesn't say clearly which plan each one needs, beyond the limits above.

| Area | Features |
|---|---|
| Git productivity | local and cloud workspaces, merge conflict tool, Gitflow, Git LFS, worktrees, visual interactive rebase and cherry-pick |
| Agent workflows | Agent Sessions View; launching sessions for Claude Code, Codex CLI, Copilot CLI, Gemini CLI and OpenCode |
| Team collaboration | Code Suggest (preview), Cloud Patches (preview), Insights (by request), Launchpad, Conflict Prevention |
| Integrations | cloud and self-hosted Git hosts; issue trackers (Jira Cloud and Data Center, Trello…) |
| Administration | user, team and license management; admin and security controls; access management |
| Other | integrated terminal |

GitKraken.dev Automations (preview) are limited by plan: 2, 10 or 20 connected repositories, and 1, 5 or 10 automations per repository.

## How Ferry compares

GitKraken is a Git client: it helps you work with a repository. Ferry syncs a working folder into a repository and commits it. The overlap is small, but these are the closest points:

| GitKraken | Ferry today |
|---|---|
| Visual diff and merge conflict tool | the web app's change story, conflict resolution with three-way merge, the dashboard's diff view |
| AI commit messages (Pro and up) | `{ai}` commit messages, free, using your own Anthropic API key |
| Conflict Detection (Pro and up) | two-way conflict detection before anything is overwritten, free |
| Private repositories (Pro and up) | any repository: Ferry has no paid tiers |
| Undo | `ferry undo`, `ferry restore --at`, per-file backups |
| Launchpad, Code Review, Insights, SSO, audit logs | not in Ferry (see [ROADMAP.md](../ROADMAP.md) for related ideas) |
