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

| File | Purpose | When to read |
|------|---------|-------------|
| `CLAUDE.md` (this file) | Project identity, structure, patterns, current phase pointer | Auto-loaded every session |
| `.claude/phases/current.md` | Active phase: goals, requirements, architecture, implementation notes | Read when starting phase work |
| `.claude/phases/NNN-name.md` | Archived phases (completed) | Only if you need historical context |

### Phase transitions

When a phase is completed:

1. **Condense** — extract lasting decisions from `.claude/phases/current.md` (architecture choices, patterns established, conventions) and add them to the "Decisions from previous phases" section above. Keep each to 1-2 lines.
2. **Archive** — rename `.claude/phases/current.md` to `.claude/phases/NNN-name.md` (e.g., `001-auth-system.md`)
3. **Start fresh** — create a new `.claude/phases/current.md` from `~/.claude/phase-template.md`
4. **Update this file** — update the "Current Phase" section above
5. **Prune** — remove anything from this file that was phase-specific and no longer applies

### What goes where

- **This file**: project-wide truths (stack, structure, patterns, conventions). Things that are true regardless of which phase you're in.
- **Phase doc**: goals, requirements, architecture decisions, implementation notes, and anything specific to the current body of work.
- **Process rules**: delegation and modularization standards live in `~/.claude/process.md` (global, not per-project).
