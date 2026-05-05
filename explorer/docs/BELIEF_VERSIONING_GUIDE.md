# Belief Versioning UI

## Overview

The Belief Versioning page (`/versions`) provides a git-like interface for
exploring the version history of beliefs in the Limen knowledge graph. It
supports branching and merging with conflict resolution.

## Features

### Search
Enter a belief ID and press Enter or click Search to load its version history.
Versions are displayed newest-first in a vertical timeline.

### Version Timeline
Each version entry shows:
- **Version ID** (truncated hash)
- **Branch name** (purple badge, if on a named branch)
- **Confidence** score (0.0-1.0)
- **Governance state** (colored badge: active/suspended/revoked/pending/archived)
- **Content preview** (first 100 characters)
- **Timestamp**

Click a version to select it for branching.

### Create Branch
1. Select a version by clicking it in the timeline.
2. Click "Branch from [version]".
3. Enter a branch name in the dialog.
4. Click Create.

The branch creates a new lineage from the selected version, allowing
independent evolution of the belief.

### Merge Branches
1. Click "Merge Branches" in the toolbar.
2. Enter source and target branch names.
3. Select a conflict resolution strategy:
   - **Take Source** — source branch values win on conflict.
   - **Take Target** — target branch values win on conflict.
   - **Take Higher Confidence** — the version with higher confidence wins.
4. Click Merge.

On success, the result shows the merged version ID and conflict count.

## API Endpoints

| Endpoint                                | Method | Description            |
|-----------------------------------------|--------|------------------------|
| `/beliefs/:id/versions`                 | GET    | List versions          |
| `/beliefs/:id/branches`                 | POST   | Create branch          |
| `/beliefs/merge`                        | POST   | Merge two branches     |

## Workflow Example

1. Search for belief `claim-abc-123`.
2. Review its version history — notice confidence dropped at version 5.
3. Branch from version 4 (before the drop) as `experiment-revert`.
4. After investigation, merge `experiment-revert` into `main` with
   `take_higher_confidence` resolution.

## Troubleshooting

- **No versions found**: The belief ID may not exist or has no version history.
- **Merge fails**: Branch names must match existing branches exactly.
- **Connection Error**: Check `NEXT_PUBLIC_API_URL` environment variable.
