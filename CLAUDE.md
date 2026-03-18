# Singlepagers

> Collection of standalone single-page game applications.

## Stack

- **Language**: HTML/JavaScript (vanilla)
- **Framework**: None
- **Database**: None (client-side state)

## Project Structure

```
yatzy.html       # Yatzy dice game
```

## Key Patterns

- Each game is a single self-contained HTML file
- No build process or external dependencies
- All logic, styles, and markup in one file per game
- Deployed to VPS via git push — HTML files copied directly to web root
- Live at: `mase.fi/yatzy.html`
- `porssi.html` was removed — superseded by the standalone spot-price project

---

## Current Phase

**Phase 1: Maintenance** — add new games or improve existing ones as needed

Details: `.claude/phases/current.md`

### Decisions from previous phases

_None yet._

---

## Doc Management

This project splits documentation to minimize context usage. Follow these rules:

### File layout

| File                         | Purpose                                                        | When to read                              |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `CLAUDE.md` (this file)      | Project identity, structure, patterns, current phase pointer   | Auto-loaded every session                 |
| `.claude/phases/current.md`  | Symlink → active phase file                                    | Read when starting phase work             |
| `.claude/phases/NNN-name.md` | Phase files (active via symlink, completed ones local-only)    | Only if you need historical context       |
| `.claude/ideas.md`           | Future feature ideas, tech debt, and enhancements              | When planning next phase or brainstorming |
| `.claude/plans/`             | Design docs and implementation plans from brainstorming        | When implementing or reviewing designs    |
| `.claude/references/`        | Domain reference material (specs, external docs, data sources) | When you need domain knowledge            |
| `.claude/[freeform].md`      | Project-specific context docs (architecture, deployment, etc.) | As referenced from this file              |

### Phase transitions

When a phase is completed:

1. **Condense** — extract lasting decisions from the active phase file and add to "Decisions from previous phases". Keep each to 1-2 lines.
2. **Archive** — remove the `current.md` symlink. The completed phase file stays but is no longer committed.
3. **Start fresh** — create a new numbered phase file from `~/.claude/phase-template.md`, then symlink `current.md` → it.
4. **Update this file** — update the "Current Phase" section above.
5. **Prune** — remove anything from this file that was phase-specific and no longer applies.

### What goes where

- **This file**: project-wide truths (stack, structure, patterns, conventions). Things that are true regardless of which phase you're in.
- **Phase doc**: goals, requirements, architecture decisions, implementation notes, and anything specific to the current body of work.
- **Process rules**: delegation and modularization standards live in `~/.claude/process.md` (global, not per-project).
