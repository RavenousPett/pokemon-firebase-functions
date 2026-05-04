# Grassroots AI — Firebase Functions

## Project Overview

Firebase Cloud Functions backend for Grassroots AI — a grassroots football match tracker for Ascot United Titans U9s (2025/26 season). Handles AI-powered insights and chat via the Anthropic Claude API with Firebase Data Connect tool calling.

## Structure

- Git root contains Firebase config (`firebase.json`, `firestore.rules`, etc.)
- All function code lives in `functions/` — that is its own Node.js package with its own `package.json`
- Run commands from `functions/` unless working on Firebase config

## Running Locally

```bash
cd functions
npm run build:watch   # TypeScript compiler in watch mode

# In another terminal, from repo root:
firebase emulators:start --only functions
```

## Tech Stack

- **Node.js 24** (Cloud Functions)
- **TypeScript**
- **Firebase Admin SDK** + **Firebase Data Connect** (PostgreSQL-backed)
- **Anthropic Claude API** (`@anthropic-ai/sdk`)
- **ESLint 8** with Google style + `@typescript-eslint` + `eslint-config-prettier`

## Architecture

The `calmMeDown` Cloud Run function handles all AI chat requests. It:

1. Accepts POST with either `messages` (multi-turn) or `userInputText` (single-turn / MOTD)
2. Runs an agentic loop with Claude + 8 tools that query Firebase Data Connect
3. Streams text deltas back to the client as plain text (chunked transfer)

### Tools

| Tool                 | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `get_team_info`      | Team identity (club, name, age group, season)                        |
| `get_all_match_data` | Full season data — all matches with periods, events, lineups, awards |
| `list_matches`       | Lightweight match list (scores, venue, date, result)                 |
| `get_match`          | Full detail for a single match                                       |
| `list_players`       | Active squad roster                                                  |
| `get_player`         | Player profile + all appearances and events                          |
| `get_events_by_type` | All events of a specific type across the season                      |
| `get_player_events`  | All events for a specific player                                     |

### Event Types (schema enum, append-only)

`GOAL_SCORED`, `GOAL_CONCEDED`, `THROW_IN`, `CORNER_TAKEN`, `CORNER_CONCEDED`, `YELLOW_CARD`, `RED_CARD`, `FOUL_COMMITTED`, `FOUL_SUFFERED`, `SUBSTITUTION_ON`, `SUBSTITUTION_OFF`, `ASSIST`, `FREE_KICK_TAKEN`, `FREE_KICK_CONCEDED`, `SHOT_ON_TARGET`, `SHOT_OFF_TARGET`, `SAVE`

### Data Connect config

- Service ID: `pokemon-football`
- Location: `us-east4`
- Active team UUID: `2e000000-0000-0000-0000-000000000001` (single-team POC)

## Related Repo

Frontend Next.js app lives at `/Users/richard/code/websites/pokemon-football` (locally) and `RavenousPett/pokemon-football` on GitHub.

## Coding Conventions

- **Formatting**: Prettier handles all formatting automatically — do not manually adjust whitespace, indentation, or quote style.
- **Linting**: After making changes, run `npm run lint` from the `functions/` directory. Do not use `--fix`; errors should be fixed manually.
- **Unused variables**: Prefix with `_` (e.g. `_err`) to signal intentionally unused. Never leave genuinely unused variables.
- **No ESLint auto-fix**: Do not suggest or apply `eslint --fix` — fixes should be made explicitly.
