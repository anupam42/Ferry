// What the outside services send back: only the fields Ferry reads, with the
// ones that can be missing marked optional (or nullable), so the code that
// reads them has to cope. GitHub comes through the gh CLI (pr list JSON and
// GraphQL), GitLab through its REST API or glab, Azure DevOps and Jira through
// their REST APIs.

// ---------- GitHub (gh) ----------

export interface GhUser { login: string }

/** One check on a pull request (a check run, or an older commit status). */
export interface GhCheck {
  name?: string;
  context?: string;
  conclusion?: string | null;
  state?: string | null;
  status?: string | null;
  detailsUrl?: string | null;
  targetUrl?: string | null;
}

/** gh pr list --json number,title,headRefName,baseRefName,author,isDraft,url,updatedAt,reviewDecision,statusCheckRollup */
export interface GhPullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  author?: GhUser | null;
  isDraft?: boolean;
  url: string;
  updatedAt: string;
  reviewDecision?: string | null;
  statusCheckRollup?: GhCheck[] | null;
}

export interface GhComment {
  id: string;
  author?: GhUser | null;
  body: string;
  createdAt: string;
  diffHunk?: string | null;
}

/** The pull request conversation query (reviews.ts, GH_QUERY). */
export interface GhConversation {
  data?: {
    viewer?: GhUser | null;
    repository?: {
      pullRequest?: {
        id: string;
        title: string;
        url: string;
        body?: string | null;
        author?: GhUser | null;
        state: string;
        headRefName: string;
        baseRefName: string;
        comments: { nodes: GhComment[] };
        reviews: { nodes: { author?: GhUser | null; state: string; body?: string | null; submittedAt?: string | null }[] };
        reviewThreads: {
          nodes: {
            id: string;
            path: string;
            line?: number | null;
            originalLine?: number | null;
            isResolved: boolean;
            isOutdated: boolean;
            viewerCanResolve?: boolean;
            viewerCanUnresolve?: boolean;
            comments: { nodes: GhComment[] };
          }[];
        };
      } | null;
    } | null;
  } | null;
}

/** Any GraphQL answer, for its errors. */
export interface GhGraphQLResult { errors?: { message?: string }[] }

// ---------- GitLab ----------

export interface GlUser { username: string; name?: string }

export interface GlMergeRequest {
  iid: number;
  title: string;
  description?: string | null;
  state?: string;
  source_branch: string;
  target_branch: string;
  author?: GlUser | null;
  draft?: boolean;
  web_url: string;
  updated_at: string;
}

export interface GlPipeline { id: number; status: string; web_url?: string | null }

export interface GlApprovals { approved?: boolean }

export interface GlNote {
  id: number;
  body?: string | null;
  author?: GlUser | null;
  created_at: string;
  system?: boolean;
  resolvable?: boolean;
  resolved?: boolean;
  position?: { new_path?: string | null; old_path?: string | null; new_line?: number | null; old_line?: number | null } | null;
}

export interface GlDiscussion { id: string; notes?: GlNote[] }

// ---------- Azure DevOps ----------

export interface AzIdentity { displayName?: string }

export interface AzPullRequest {
  pullRequestId: number;
  title: string;
  description?: string | null;
  status?: string;
  sourceRefName: string;
  targetRefName: string;
  createdBy?: AzIdentity | null;
  isDraft?: boolean;
  creationDate: string;
  /** vote: 10 approved, 5 approved with suggestions, 0 none, -5 waiting, -10 rejected */
  reviewers?: { displayName: string; vote: number }[];
}

export interface AzStatus {
  state: string;
  description?: string | null;
  targetUrl?: string | null;
  context?: { genre?: string; name?: string } | null;
}

export interface AzComment { id: number; content?: string | null; author?: AzIdentity | null; publishedDate: string; commentType?: string; isDeleted?: boolean }

export interface AzThread {
  id: number;
  status?: string;
  isDeleted?: boolean;
  comments?: AzComment[];
  threadContext?: { filePath?: string; rightFileStart?: { line: number } | null; leftFileStart?: { line: number } | null } | null;
}

/** Azure DevOps wraps lists. */
export interface AzList<T> { value: T[] }

// ---------- Jira ----------

export interface JiraIssue {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string } | null;
    updated?: string;
  };
}
