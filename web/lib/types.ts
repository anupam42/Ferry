// The shapes the server sends, shared with its own code so both sides agree.
export type { GitSettings } from "../../src/shared/settings.ts";
export type { SettingsResponse as Settings } from "../../src/shared/settings.ts";
export type { Batch, ChangedFile, FileDiff, FolderListing, JournalEntry, Line, PairStatus, RestoreResult, Stats } from "../../src/shared/pairs.ts";

export interface Info {
  version: string;
  can_add: boolean;
  can_open_repos: boolean;
  config_file: string;
  home: string;
  platform: string;
  sep: string;
  dev?: { boot: string };
}

export interface Connection { connected: boolean; user: string; where: string; fromEnv: boolean }
export type Connections = Record<"gitlab" | "azure" | "jira", Connection>;

export interface Release {
  version: string;
  dev?: boolean;
  commit?: string;
  built?: string;
  platform: string;
  arch: string;
  bun: string;
  install: { method: string; where: string };
}

export type Mode = "sync" | "git" | "settings";
export type { Conversation, InsightsResponse, ShapeBatch, ShapeResult, ShapeTimeline, Issue, IssueList, PullRequest, PullRequestList, Review, ReviewComment, ReviewThread, Blame, BlameChunk, Branch, BranchList, Commit, CommitDetail, FileChange, FileContent, FileVersion, FolderEntry, FolderListing as RepoFolder, IncomingCommit, LostBranch, PushIssue, ReflogEntry, RemoteCheckResponse, RepoEntry, RepoStateResponse, Stash, Tag, UndoTimeline, Worktree } from "../../src/shared/git.ts";
