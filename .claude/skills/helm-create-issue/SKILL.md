---
name: helm-create-issue
description: Create a Helm issue for the crowd-runner project. Trigger when the user asks to file/log/create an issue or todo.
disable-model-invocation: true
---

# crowd-runner issue triage

Create a new Helm issue with hard-coded defaults:

| Field       | Value                              | Source                                          |
| ----------- | ---------------------------------- | ----------------------------------------------- |
| workspace   | `default`                          | hard-coded                                      |
| `--project` | `/Users/chencheng/Projects/crowd-runner`| hard-coded                                      |
| `--status`  | `triage` (default) \| `todo`       | hard-coded default; user may override to `todo` |
| title       | required                           | user                                            |
| description | optional                           | user (inline)                                   |
| attachments | optional, repeatable               | user (paths)                                    |

## Instructions

Do NOT run `helm daemon status` upfront — it adds a slow subprocess on the common happy path. React to exit code `2` from `helm issue new` instead (see step 4).

1. **Collect inputs from the user's request.**
   - `<title>` — required, single quoted string. If missing, ask the user for one sentence describing the issue.
   - `<status>` — `triage` by default. Use `todo` only when the user explicitly says "todo" / "as todo" / "status todo" / "create a todo" or equivalent. Do not infer `todo` from vague signals; when unsure, default to `triage` silently.
   - `--description "<text>"` — optional. Inline only; do NOT use `--description-file`. For long or multi-line descriptions (code blocks, tables, backticks), build the string with a quoted heredoc and pass it as `--description "$DESC"` so backticks and `$` are not interpreted by the shell:

     ```sh
     DESC=$(cat <<'EOF'
     ...multi-line markdown, backticks and $ are safe...
     EOF
     )
     helm issue new default "<title>" --status <status> \
       --project /Users/chencheng/Projects/crowd-runner \
       --description "$DESC" --json
     ```
   - `--attach <path>` — optional, repeat the flag per file. Expand `~` to `$HOME`. Use absolute paths when possible.

2. **Build and run the command.** Workspace and project are fixed; status is `triage` or `todo`:

   ```sh
   helm issue new default "<title>" \
     --status <status> \
     --project /Users/chencheng/Projects/crowd-runner \
     [--description "<text>"] \
     [--attach <path>]... \
     --json
   ```

   Always pass `--json` so the issue id can be parsed reliably.

3. **Report the result.** Parse the JSON envelope `{ "issue": { "id": <n>, ... } }` and tell the user:

   > Created Helm issue `#<id>` in workspace `default` (status `<status>`, project `/Users/chencheng/Projects/crowd-runner`).

4. **Exit-code handling.**
   - `0` — success.
   - `1` — validation/business error (e.g. workspace `default` doesn't exist, or `/Users/chencheng/Projects/crowd-runner` isn't attached to that workspace). Surface stderr to the user; do not retry.
   - `2` — daemon unreachable. Run `helm daemon start`, then retry the `helm issue new` command once. Stop on a second failure.

## Examples

Minimal (default status `triage`):

```sh
helm issue new default "Gate ×N multiplier can push crowd past crowdCap without clamping" \
  --status triage --project /Users/chencheng/Projects/crowd-runner --json
```

Explicit `todo`:

```sh
helm issue new default "Add stage 2 (src/config/stage2.js) and swap the import in main.js" \
  --status todo --project /Users/chencheng/Projects/crowd-runner --json
```

With description and attachments:

```sh
helm issue new default "Boss unwinnable at low crowd-at-boss (c0)" \
  --status triage --project /Users/chencheng/Projects/crowd-runner \
  --description "Solvability needs perMemberDPS·c0²/(2·bossRemovalRate) ≥ boss.hp; current stage1.js numbers fail when c0 < ~49. Re-tune combat rates or gate values." \
  --attach ~/Desktop/verify-balance.log \
  --json
```

## Guardrails

- Never substitute a different workspace or project. They are fixed to `default` / `/Users/chencheng/Projects/crowd-runner`.
- Status is restricted to `triage` (default) or `todo`. If the user explicitly asks for `in_progress`, `done`, `cancelled`, or any other status, stop and tell them this skill only handles `triage` / `todo` — suggest running `helm issue new` directly for the rest.
- Do not invent a title from thin air. If the user's request lacks one, ask.
- Don't escape into a fork/edit flow — this skill only creates issues. Use `helm issue update` separately.
