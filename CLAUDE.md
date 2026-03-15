# Pokemon Firebase Functions

## Project Overview

Firebase Cloud Functions backend for the Pokemon Football app. Handles AI-powered insights via the Anthropic Claude API.

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
- **Firebase Admin SDK**
- **Anthropic Claude API** (`@anthropic-ai/sdk`)
- **ESLint 8** with Google style + `@typescript-eslint` + `eslint-config-prettier`

## Coding Conventions

- **Formatting**: Prettier handles all formatting automatically — do not manually adjust whitespace, indentation, or quote style.
- **Linting**: After making changes, run `npm run lint` from the `functions/` directory. Do not use `--fix`; errors should be fixed manually.
- **Unused variables**: Prefix with `_` (e.g. `_err`) to signal intentionally unused. Never leave genuinely unused variables.
- **No ESLint auto-fix**: Do not suggest or apply `eslint --fix` — fixes should be made explicitly.
