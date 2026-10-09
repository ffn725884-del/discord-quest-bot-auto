# Discord Quest Bot Auto

A Discord bot project for Railway that stores a token, starts automation, and tracks quest progress.

Important notes:
- This is an automation script intended for use with your own Discord account and your own bot token.
- Please check Discord/Roblox app terms before using automated quest logic.
- Some page selectors and quest flows may change over time.

## Features
- `/token` command to save a token
- `/start` to begin automation
- `/status` to see progress
- `/stop` to stop automation
- SQLite storage for saved tokens and quest logs
- ready to deploy on Railway

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment file:
   ```bash
   cp .env.example .env
   ```

3. Fill in values:
   - `DISCORD_TOKEN` = your Discord bot token
   - `DISCORD_CLIENT_ID` = your Discord application/client ID

4. Start the bot locally:
   ```bash
   npm start
   ```

## Railway deployment

1. Push this repository to your GitHub account.
2. Create a new Railway project and connect this repo.
3. Add environment variables from `.env.example`.
4. Deploy.

## Commands in Discord

- `/token token:your_token_here`
- `/start`
- `/status`
- `/stop`

## File structure

- `bot.js` – bot and automation logic
- `package.json` – dependencies and start script
- `railway.json` – Railway config
- `.env.example` – example environment variables
