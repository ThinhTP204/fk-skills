# fk-skills

Design guidance for AI coding agents. 1 skill, 23 commands, live browser iteration, and 44 deterministic detector rules for AI-generated frontend design.

> **Quick start:** From your project root, run `npx fk install`, then run `/fk setup` inside your AI coding tool.

## Why fk-skills?

Anthropic's [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) was the first widely-used design skill for Claude. fk-skills started from there.

Every model trained on the same SaaS templates. Skip the guidance and you get the same handful of tells on every project: Inter for everything, purple-to-blue gradients, cards nested in cards, gray text on colored backgrounds, the rounded-square icon tile above every heading.

fk-skills adds:
- **One setup flow.** `/fk setup` writes `PRODUCT.md` and offers `DESIGN.md`, so later commands know the audience, brand/product lane, voice, anti-references, colors, type, and components.
- **23 commands.** A shared design vocabulary with your AI: `finish`, `check`, `review`, `trim`, `motion`, `amplify`, `calm`, and more.
- **44 deterministic detector rules** plus LLM-only review checks. The CLI and browser extension run the deterministic rules with no LLM and no API key.

## What's Included

### The Skill: fk

The skill installs as one command:

```bash
/fk <command> <target>
```

Start every new project with:

```bash
/fk setup
```

`setup` asks whether the surface is brand (marketing, landing, portfolio) or product (app UI, dashboard, tool), then writes design context that every later command reads.

### 23 Commands

All commands are accessed through `/fk`:

| Command | What it does |
|---------|--------------|
| `/fk build` | Full plan-then-build flow with visual iteration |
| `/fk setup` | One-time setup: gather design context, write PRODUCT.md and DESIGN.md, configure live mode, recommend next steps |
| `/fk spec` | Generate root DESIGN.md from existing project code |
| `/fk tokens` | Pull reusable components and tokens into the design system |
| `/fk plan` | Plan UX/UI before writing code |
| `/fk review` | UX design review: hierarchy, clarity, emotional resonance |
| `/fk check` | Run technical quality checks (a11y, performance, responsive) |
| `/fk finish` | Final pass, design system alignment, and shipping readiness |
| `/fk amplify` | Amplify boring designs |
| `/fk calm` | Tone down overly bold designs |
| `/fk trim` | Strip to essence |
| `/fk prod` | Error handling, i18n, text overflow, edge cases |
| `/fk welcome` | First-run flows, empty states, activation paths |
| `/fk motion` | Add purposeful motion |
| `/fk color` | Introduce strategic color |
| `/fk type` | Fix font choices, hierarchy, sizing |
| `/fk space` | Fix layout, spacing, visual rhythm |
| `/fk joy` | Add moments of joy |
| `/fk wow` | Add technically extraordinary effects |
| `/fk copy` | Improve unclear UX copy |
| `/fk responsive` | Adapt for different devices |
| `/fk perf` | Performance improvements |
| `/fk live` | Visual variant mode: iterate on elements in the browser |

Use `/fk pin <command>` to create standalone shortcuts (e.g., `pin check` creates `/check`).

#### Usage Examples

```
/fk check blog           # Check blog hub + post pages
/fk review landing       # UX design review
/fk finish settings      # Final pass before shipping
/fk prod checkout        # Add error handling + edge cases
```

Or use `/fk` directly with a description:
```
/fk redo this hero section
```

### Anti-Patterns

The skill includes explicit guidance on what to avoid:

- Don't use overused fonts (Arial, Inter, system defaults)
- Don't use gray text on colored backgrounds
- Don't use pure black/gray (always tint)
- Don't wrap everything in cards or nest cards inside cards
- Don't use bounce/elastic easing (feels dated)

## See It In Action

See the GitHub repo for before/after case studies of real projects transformed with fk commands.

## Installation

### Option 1: CLI installer (Recommended)

From the root of your project, run:

```bash
npx fk-skills install
```

This shows the harness folders it detected (for example `~/.claude`, `~/.codex`, or project-local `.cursor`), lets you keep the detected set or customize providers, then asks whether to install into the current project or globally. Use `--providers=claude,codex,cursor` and `--scope=project|global` to skip those choices in scripts. On Claude Code, Cursor, and Codex, it also installs the provider-native hook manifest for the current project. Works with Cursor, Claude Code, Gemini CLI, Codex CLI, and every other supported tool. Reload your harness afterward.

To refresh an existing install, run:

```bash
npx fk-skills update
```

Codex users should open `/hooks` after install or update and approve the project hook when prompted. Codex tracks trust by hook definition, so updates that change `.codex/hooks.json` can require approval again.

### Option 2: Git Submodule

For teams that want to keep fk-skills vendored and updated through Git, add this repo as a submodule and link the compiled provider build into your harness folders:

```bash
git submodule add https://github.com/ThinhTP204/fk-skills .fk-skills
npx fk link --source=.fk-skills --providers=claude,cursor
git add .gitmodules .fk-skills .claude .cursor
git commit -m "Add fk-skills"
```

Use the providers your project needs, for example `claude`, `cursor`, `gemini`, `codex`, `github`, `opencode`, `pi`, `qoder`, `trae`, `trae-cn`, or `rovo-dev`. The command links individual skill folders from `.fk-skills/dist/universal/` and leaves existing real skill directories untouched unless you pass `--force`.

To update later:

```bash
git submodule update --remote .fk-skills
npx fk link --source=.fk-skills --providers=claude,cursor
```

### Option 3: Copy from Repository

**Cursor:**
```bash
cp -r dist/cursor/.cursor your-project/
```

> **Note:** Cursor skills require setup:
> 1. Switch to Nightly channel in Cursor Settings → Beta
> 2. Enable Agent Skills in Cursor Settings → Rules
>
> [Learn more about Cursor skills](https://cursor.com/docs/context/skills)

**Claude Code:**
```bash
# Project-specific
cp -r dist/claude-code/.claude your-project/

# Or global (applies to all projects)
cp -r dist/claude-code/.claude/* ~/.claude/
```

**OpenCode:**
```bash
cp -r dist/opencode/.opencode your-project/
```

**Pi:**
```bash
cp -r dist/pi/.pi your-project/
```

**Gemini CLI:**
```bash
cp -r dist/gemini/.gemini your-project/
```

> **Note:** Gemini CLI skills require setup:
> 1. Install preview version: `npm i -g @google/gemini-cli@preview`
> 2. Run `/settings` and enable "Skills"
> 3. Run `/skills list` to verify installation
>
> [Learn more about Gemini CLI skills](https://geminicli.com/docs/cli/skills/)

**Codex CLI:**
```bash
# Project-local
cp -r dist/agents/.agents your-project/
mkdir -p your-project/.codex
cp dist/codex/.codex/hooks.json your-project/.codex/hooks.json

# Or install the skill user-wide. Copy .codex/hooks.json into each project
# where you want the design hook to run.
mkdir -p ~/.agents/skills
cp -r dist/agents/.agents/skills/* ~/.agents/skills/
```

> The asset-producer subagent ships nested inside the skill's own `agents/` folder, which Codex auto-discovers. No separate `.codex/agents/` copy is needed. The hook is project-local because Codex discovers hooks from `.codex/hooks.json` next to trusted project config.

**GitHub Copilot:**
```bash
cp -r dist/github/.github your-project/
```

**Trae:**
```bash
# Trae China (domestic version)
cp -r dist/trae/.trae-cn/skills/* ~/.trae-cn/skills/

# Trae International
cp -r dist/trae/.trae/skills/* ~/.trae/skills/
```

> **Note:** Trae has two versions with different config directories:
> - **Trae China**: `~/.trae-cn/skills/`
> - **Trae International**: `~/.trae/skills/`
>
> After copying, restart Trae IDE to activate the skills.

**Rovo Dev:**
```bash
# Project-specific
cp -r dist/rovo-dev/.rovodev your-project/

# Or global (applies to all projects)
cp -r dist/rovo-dev/.rovodev/skills/* ~/.rovodev/skills/
```

**Qoder:**
```bash
# Project-specific
cp -r dist/qoder/.qoder your-project/

# Or global (applies to all projects)
cp -r dist/qoder/.qoder/skills/* ~/.qoder/skills/
```

## Usage

Once installed, every command runs through the single `/fk` skill:

```
/fk check        # Find issues
/fk finish       # Final cleanup
/fk trim         # Remove complexity
/fk review       # Full design review
```

Type `/fk` alone to see the full command list.

Most commands accept an optional argument to focus on a specific area:

```
/fk check the header
/fk finish the checkout form
```

If you reach for one command often, pin it with `/fk pin check` to get `/check` as a standalone shortcut.

**Note:** Codex uses skills here, not `/prompts:` commands. Open `/skills` or type `$fk`. Repo-local installs live in `.agents/skills/`; user-wide installs live in `~/.agents/skills/`. GitHub Copilot uses `.github/skills/`. Restart the tool if a newly installed skill does not appear.

## Design hook

On Claude Code, Codex, and Cursor, `npx fk-skills install` and `npx fk-skills update` install a provider-native hook manifest along with the skill payload. The hook runs the fk design detector on direct UI file edits and surfaces findings back into the agent flow. Claude Code and Codex surface findings after the edit. Cursor blocks bad proposed writes before they land.

Installed hook surfaces:

- Claude Code: `.claude/settings.local.json` (gitignored, machine-local) runs `${CLAUDE_PROJECT_DIR}/.claude/skills/fk/scripts/hook.mjs`. A hook moved into the shared `settings.json` is honored in place.
- Cursor: `.cursor/hooks.json` runs `.cursor/skills/fk/scripts/hook-before-edit.mjs`.
- Codex: `.codex/hooks.json` runs `.agents/skills/fk/scripts/hook.mjs`.

The installer preserves unrelated hook entries and settings. If a hook manifest is malformed, install/update aborts by default; rerun with `--force` to back up the malformed file as `.bak` and replace it.

On an interactive `install`/`update`, fk-skills explains the hook and offers to install it (default yes). Your choice is remembered per-developer in the gitignored `.fk-skills/config.local.json`, so you are not asked again; `--no-hooks` skips it for that run without recording anything. Hook lifecycle settings live under the `hook` key of `.fk-skills/config.json`; detector ignores live under `detector`, shared by `/fk hooks` and `npx fk-skills detect`.

For debugging, set `hook.auditLog` in `.fk-skills/config.json` to a path to write one NDJSON line per hook invocation. Leave it unset for normal use.

Codex requires one platform step: open `/hooks` after install or update and approve the project hook. There is no Codex marketplace/plugin install flow for this hook.

Full hook docs: see `skill/reference/hooks.md` in this repo.

Manual copy commands are fallback/debug instructions. The normal path is:

```bash
npx fk-skills install
npx fk-skills update
```

## CLI

fk-skills includes a standalone CLI for detecting anti-patterns without an AI harness:

```bash
npx fk-skills detect src/                   # scan a directory
npx fk-skills detect index.html             # scan an HTML file
npx fk-skills detect https://example.com    # scan a URL (Puppeteer)
npx fk-skills detect --json .               # CI-friendly JSON output
npx fk-skills detect --no-config src/       # raw scan, ignoring project config/context
npx fk-skills ignores list                  # show detector ignores
npx fk-skills ignores add-file "src/legacy/**"
npx fk-skills ignores add-value overused-font Inter --reason "Brand font"
```

The detector catches 44 deterministic issues across AI slop (side-tab borders, purple gradients, bounce easing, dark glows) and general design quality (line length, cramped padding, small touch targets, skipped headings, and more).

By default, `detect` respects the same `.fk-skills/config.json` and `.fk-skills/config.local.json` detector config as the design hook: `detector.ignoreRules`, `detector.ignoreFiles`, `detector.ignoreValues`, and `detector.designSystem.enabled`. Hook lifecycle settings such as `hook.enabled` only affect automatic hook execution.

Full detector docs: see `cli/engine/detect-antipatterns.mjs` in this repo.

## Supported Tools

- [Cursor](https://cursor.com)
- [Claude Code](https://claude.ai/code)
- [OpenCode](https://opencode.ai)
- [Pi](https://pi.dev)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Codex CLI](https://github.com/openai/codex)
- [VS Code Copilot](https://code.visualstudio.com)
- [Kiro](https://kiro.dev)
- [Trae](https://trae.ai)
- [Rovo Dev](https://www.atlassian.com/software/rovo)
- [Qoder](https://qoder.com)

## Upgrading from impeccable

fk-skills started as a fork of [impeccable](https://github.com/impeccable-style/fk). If you are migrating from that project, here is what changed.

### Commands

The skill prefix changed from `/fk` to `/fk`, and several commands were renamed:

| Old (`/fk`) | New (`/fk`) |
|---------------------|-------------|
| `init` | `setup` |
| `craft` | `build` |
| `critique` | `review` |
| `audit` | `check` |
| `polish` | `finish` |
| `distill` | `trim` |
| `harden` | `prod` |
| `shape` | `plan` |
| `document` | `spec` |
| `extract` | `tokens` |
| `bolder` | `amplify` |
| `quieter` | `calm` |
| `colorize` | `color` |
| `delight` | `joy` |
| `overdrive` | `wow` |
| `animate` | `motion` |
| `adapt` | `responsive` |

These commands kept their name (prefix only changed):

| Old (`/fk`) | New (`/fk`) |
|---------------------|-------------|
| `copy` | `copy` |
| `type` | `type` |
| `space` | `space` |
| `perf` | `perf` |
| `welcome` | `welcome` |
| `live` | `live` |

### Config folder

In v1.0.5, the local config folder was renamed from `.fk-skills/` to `.fk-skills/`. Running `npx fk-skills install` or `npx fk-skills update` migrates your files automatically.

| Before | After (v1.0.5+) |
|--------|-----------------|
| `.fk-skills/config.json` | `.fk-skills/config.json` |
| `.fk-skills/config.local.json` | `.fk-skills/config.local.json` |
| `.fk-skills/design.json` | `.fk-skills/design.json` |
| `.fk-skills/hook.cache.json` | `.fk-skills/hook.cache.json` |
| `.fk-skills/hook.pending.json` | `.fk-skills/hook.pending.json` |

The old `.fk-skills/` folder is left in place after migration. You can delete it manually once you have confirmed everything works.

## Contributing

See [DEVELOP.md](docs/DEVELOP.md) for contributor guidelines and build instructions.

## License

Apache 2.0. See [LICENSE](LICENSE).

---

Created by Trần Phú Thịnh
# fk-skills
