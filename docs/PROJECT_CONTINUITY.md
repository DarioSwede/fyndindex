# Project continuity standard

This repository uses a Git-first continuity workflow so work can continue safely across ChatGPT Work, regular chat, Codex, local development, or any other environment.

## Source of truth

- GitHub is the canonical source of code.
- No environment-specific working copy is treated as authoritative unless it has been committed and pushed.
- Work sessions are execution environments, not storage.

## Required handoff state

Before ending a work session or switching environments:

1. Commit every verified change.
2. Push the active branch.
3. Update `PROJECT_STATE.md` with:
   - current branch
   - current commit SHA
   - last verified working state
   - active problem or hypothesis
   - files changed
   - tests/checks run
   - next concrete action
4. For unfinished experiments, use a dedicated branch such as `test/<topic>` instead of leaving changes only in a local/work copy.

## Verification

For each verified state record:

- Git commit SHA
- optional checksum for important generated/static artifacts
- exact verification commands/tests
- expected visible behavior

A new session should first compare the current checkout with the recorded commit before making changes.

## Debugging rule

When a known-good reference implementation exists:

1. Compare structure before rewriting logic.
2. Inventory the relevant CSS/DOM/runtime properties.
3. Change one variable class at a time.
4. Preserve a known-good branch/commit.
5. Record what was disproved as well as what worked.

## Deployment rule

- Do not deploy an unverified experiment directly from an environment-local state.
- Prefer branch -> verification -> commit -> push -> merge/deploy.
- Production fixes must remain reproducible from GitHub alone.

## Reuse for future projects

Copy this file and `PROJECT_STATE.template.md` into every new code project. Treat this workflow as the default unless the project has a stronger documented process.
