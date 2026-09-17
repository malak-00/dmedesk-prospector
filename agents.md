# Agent Instructions & Operating Guidelines

Guidelines and protocols for AI agents working in the `dmedesk-prospector` repository.

---

## 1. Documentation & Markdown Maintenance Protocol

### Mandatory Worklog Updates (`documentation/operations/WORKLOG.md`)
Every significant task, schema change, data migration, bug fix, or architectural change **must** be logged in [`documentation/operations/WORKLOG.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/operations/WORKLOG.md).

When completing a milestone or session:
1. **Add a Dated Section**: Format as `## YYYY-MM-DD — <Short Title>`.
2. **Include Standard Subsections**:
   - **Objective**: What problem was being solved or what was the goal.
   - **Actions Completed**: Bulleted list of exact files changed, tools run, or SQL executed.
   - **Database / System Result**: Numbers, counts, or outcome metrics (e.g. rows processed, table size changes, schema diffs).
   - **Safety Status**: Explicit confirmation that no unintended data was deleted, claims weren't dropped, or production tables altered unexpectedly.

### Keeping Planning & Reference Docs Synchronized
- **Active Plans**: When working on features or fixes documented in planning files (e.g. [`documentation/planning/sept17.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/planning/sept17.md)), update the checklists, status logs, and technical specifications as decisions are finalized or implemented.
- **Directory Boundaries**:
  - All documentation belongs in `documentation/` (`plans/`, `planning/`, `operations/`, `reference/`, `reviews/`).
  - **Never place documentation in `docs/`** &mdash; `docs/` is strictly the deployed static browser frontend and its assets.
- **Maintain Link Integrity**: When moving or adding markdown files, use standard relative links or file paths and verify they resolve properly.

---

## 2. Core Execution & Safety Rules

- **Think Before Coding**: State assumptions explicitly. Surface tradeoffs before implementing changes.
- **Simplicity & Surgical Edits**: Minimum code to solve the problem. Touch only what must be touched; do not refactor or "clean up" unrelated lines.
- **No Automatic Browser Testing**: Do not invoke automated browser testing tools. Always provide links and ask the user to test in their browser.
- **Accidental Data Loss Prevention**: Never execute `DROP`, `TRUNCATE`, broad `DELETE`, or bucket destruction without explicit user consent. Always verify before running mutating SQL on production tables.

---

## 3. Environment & Tooling Constraints

- **Shell**: PowerShell ONLY. Do not use `cmd` or `cmd /c`.
- **System PATH**: Unconfigured. Always use absolute paths for executables.
- **Privileges**: No Admin/Sudo access. Never attempt commands that require elevation.
- **Node / Clasp Execution**:
  ```powershell
  & "C:\Users\ben.arthur\node-v24.14.1-win-x64\node.exe" `
    "C:\Users\ben.arthur\node-v24.14.1-win-x64\node_modules\@google\clasp\build\src\index.js" `
    [command] [args]
  ```
  *(Always include `--no-localhost` for clasp login)*
- **OpenAI Codex CLI**:
  ```powershell
  & "C:\Users\ben.arthur\node-v24.14.1-win-x64\node.exe" `
    "C:\Users\ben.arthur\node-v24.14.1-win-x64\node_modules\@openai\codex\bin\codex.js" `
    [command] [args]
  ```
