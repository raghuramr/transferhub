# TransferHub DB MCP Server

An [MCP](https://modelcontextprotocol.io) server that applies this repo's
`database/migrations/` and `database/seed/` `.sql` files to SQL Server /
Azure SQL — the same job `tools/db-script-runner/` (the PowerShell GUI)
does, but exposed as tools any MCP client (Claude Code, Claude Desktop,
etc.) can call directly, no GUI or Windows required.

It shares the **exact same** `dbo.__ScriptRunnerHistory` ledger table as
the PowerShell tool (same columns, same SHA-256-of-file-bytes checksum,
same bare-filename `ScriptName`) — whichever tool you run a script with,
both tools see it as Applied.

**Only supports TCP connections** (Azure SQL, or any real SQL Server
reachable over the network) — not LocalDB (`(localdb)\...`, a named-pipe
connection needing the native `msnodesqlv8`/ODBC driver). Use
`tools/db-script-runner/` for LocalDB.

## Tools

- **`test_connection`** — connects and reports success/failure plus which
  env file was used. Run this first.
- **`list_scripts`** — lists `.sql` files in `migrations` or `seed`
  (naturally sorted, `002_` before `011_`), each with its status: Not
  Applied, Applied, Changed since applied (edited after it last ran), or
  Failed (last run).
- **`run_migrations`** / **`run_seeds`** — runs the `.sql` files in
  `database/migrations/` or `database/seed/`, in filename order, stopping
  at the first failure. Takes an optional `scripts` array to run specific
  files instead of the whole folder, and `onlyIfNeeded` (default `true`)
  to skip files already Applied with a matching checksum.

Run migrations before seeds — seed files assume the schema already exists.

## Configuring the connection

Env resolution order (first one found wins):

1. `DB_MCP_ENV_FILE` — an explicit path to a `.env`-style file.
2. `tools/db-mcp-server/.env`, if you create one.
3. `src/api/.env` — the main API's own local-dev env file. **This is the
   default** — out of the box, this server targets whatever database the
   API itself is configured for, with no second copy of credentials to
   keep in sync.

If none of those files exist, it falls back to whatever's already in
`process.env` (e.g. variables an MCP client config supplies directly in
an `env` block).

Required variables (same names as `src/api/.env.example`): `DB_SERVER`,
`DB_NAME`, `DB_PORT` (optional), `DB_TRUSTED_CONNECTION`, `DB_ENCRYPT`,
`DB_USER`, `DB_PASSWORD`.

## Setup

```bash
cd tools/db-mcp-server
npm install
npm run build
```

### Claude Code (this repo)

A `.mcp.json` at the repo root already registers this server (command
`node tools/db-mcp-server/dist/index.js`) — Claude Code picks it up
automatically for sessions opened on this repo, once you've run the
`npm install && npm run build` above. No further configuration needed
unless you want to point it at a different database than `src/api/.env`
(see "Configuring the connection" above — `DB_MCP_ENV_FILE` or an `env`
block in `.mcp.json` both work).

### Claude Desktop / another MCP client

Add to that client's MCP server config (e.g. Claude Desktop's
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "transferhub-db": {
      "command": "node",
      "args": ["/absolute/path/to/transferhub/tools/db-mcp-server/dist/index.js"]
    }
  }
}
```

To target a database other than whatever `src/api/.env` points at, add an
`env` block there (or set `DB_MCP_ENV_FILE`):

```json
{
  "mcpServers": {
    "transferhub-db": {
      "command": "node",
      "args": ["/absolute/path/to/transferhub/tools/db-mcp-server/dist/index.js"],
      "env": {
        "DB_SERVER": "yourserver.database.windows.net",
        "DB_PORT": "1433",
        "DB_NAME": "TransferHubDB",
        "DB_TRUSTED_CONNECTION": "false",
        "DB_ENCRYPT": "true",
        "DB_USER": "youradminlogin",
        "DB_PASSWORD": "yourpassword"
      }
    }
  }
}
```

## Development

```bash
npm run dev    # runs src/index.ts directly via tsx, no build step
```

## CI auto-apply (`src/applyAll.ts`)

A non-interactive counterpart to the `run_migrations`/`run_seeds` MCP tools
and the PowerShell GUI, meant for automation rather than a human: applies
every pending script in `database/migrations/` then `database/seed/` (in
filename order, stopping at the first failure in a folder), using the exact
same `dbo.__ScriptRunnerHistory` ledger — a script applied through any of
the three tools shows as Applied in all of them.

```bash
npm run apply:all    # reads the same env as run/dev — see "Configuring the connection" above
```

Wired into `.github/workflows/main_codecrafters.yml`: it runs on every push
to `main`, right after the Azure login step and before the app deploy, so a
fresh database schema is in place before the new code that expects it goes
live. Since GitHub-hosted runners have no static IP, that workflow step
opens a temporary Azure SQL firewall rule for the runner's own public IP,
runs this script, then always removes the rule again — see the workflow
file's header comment for the exact secrets that step needs
(`DB_SERVER`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`,
`AZURE_SQL_SERVER_NAME`, `AZURE_SQL_RESOURCE_GROUP`), none of which exist
yet — add them under the repo's Settings → Secrets and variables → Actions
before relying on this.
