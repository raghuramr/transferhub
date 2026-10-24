# DB Script Runner

A standalone, generic Windows Forms GUI for applying `.sql` migration/seed
scripts to a SQL Server (or Azure SQL Database) database -- built to replace
manually running scripts one at a time in SSMS.

It is **not tied to this repo's schema or folder layout**. It's designed to
be copied (just this `tools/db-script-runner/` folder) into any other
SQL-Server-based project that keeps its DB changes as plain `.sql` files.

## What it does

1. **Pick an env file** -- browse to a folder (defaults to the current
   directory), pick any `.env`-style file found there (`.env`, `.env.test`,
   `.env.production`, `*.env`, ...), and load it. It parses plain
   `KEY=value` lines (skips comments/blank lines, strips quotes, strips
   trailing inline `# comments`) and pre-fills the connection fields
   (server, port, database, trusted/SQL auth, user, password, encrypt).
   Every field stays editable by hand afterwards -- useful if another
   project uses different variable names than `DB_SERVER`/`DB_NAME`/etc.
2. **Pick a scripts folder** -- browse to any folder of `.sql` files
   (defaults to `database/migrations` under the current directory when run
   from this repo). If a sibling `database/seed` folder exists next to it,
   it's auto-detected and shown on its own "Seed" tab.
3. **List + status** -- every `.sql` file in the folder is listed, sorted
   *naturally* by filename (so `002_x.sql` sorts before `011_x.sql`, not
   alphabetically-as-a-string). Each one shows:
   - **Not Applied** -- never recorded as run against this database.
   - **Applied** -- recorded as succeeded, and the file's contents haven't
     changed since.
   - **Changed since applied** -- recorded as succeeded, but the file's
     SHA-256 checksum no longer matches what was run (edited after the
     fact -- worth a second look before re-running).
   - **Failed (last run)** -- the last attempt errored out.
4. **Select + execute** -- check one, several, or all scripts (checkboxes
   in the list; "Select All"/"Select None" helpers), then **Run Selected**.
   Scripts always execute in filename order regardless of check order.
   Output streams live into the log panel at the bottom. The batch **stops
   at the first error** and shows clearly which script failed; only
   scripts that succeeded are recorded as applied.

## How it tracks what's already been run

On first use against a database, it creates (if missing):

```sql
dbo.__ScriptRunnerHistory (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    ScriptName NVARCHAR(500) NOT NULL,
    AppliedAt DATETIME2 NOT NULL,
    Success BIT NOT NULL,
    Checksum NVARCHAR(64) NOT NULL
)
```

Every run (success or failure) appends a row. The GUI reads the most recent
row per script name to compute the Applied/Not Applied/Changed/Failed
status. If you try to re-run something already marked **Applied**, you get
a confirmation prompt first -- it's a warning, not a hard block, since
sometimes re-running on purpose (e.g. an idempotent script) is exactly what
you want.

## How it executes scripts

It uses `sqlcmd.exe` if found on `PATH` (no extra PowerShell modules
needed). If `sqlcmd.exe` isn't available, it falls back to `Invoke-Sqlcmd`
from the `SqlServer` PowerShell module (`Install-Module SqlServer`) --
the Connection tab tells you which engine it found.

Both Windows/trusted auth and SQL auth (user/password) are supported via
the "Trusted/Windows Auth" checkbox.

**Azure SQL Database**: check "Encrypt / Azure SQL (DB_ENCRYPT)". This adds
`-N -C` to the `sqlcmd` call (or `Encrypt=Mandatory` /
`TrustServerCertificate=$true` for `Invoke-Sqlcmd`) -- the encrypted
connection Azure SQL requires, with the server certificate trusted so it
works out of the box without installing a separate CA cert.

## Running it

- **Double-click `Run.bat`** -- the easiest way. It launches
  `DbScriptRunner.ps1` with `-ExecutionPolicy Bypass` scoped to just that
  one process; it does **not** change your machine's global execution
  policy.
- Or from PowerShell directly:
  ```powershell
  powershell -ExecutionPolicy Bypass -File DbScriptRunner.ps1
  ```

Requires Windows (Windows Forms) and either `sqlcmd.exe` (ships with SSMS /
the "SQL Server Command Line Utilities" / Azure CLI's `sql` extension) or
the `SqlServer` PowerShell module.

## Using it in *this* project

- Env file folder: `src/api` (has `.env` / `.env.example` with
  `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
  `DB_ENCRYPT`, `DB_DRIVER`, `DB_TRUSTED_CONNECTION`, `DB_ODBC_DRIVER` --
  `DB_DRIVER`/`DB_ODBC_DRIVER` are Node-specific and aren't used by this
  tool, since it always talks to SQL Server via `sqlcmd`/ODBC directly).
- Scripts folder: `database/migrations` (auto-detected default when run
  from the repo root), with `database/seed` picked up automatically as
  the second tab.

## Using it in another project

Copy the whole `tools/db-script-runner/` folder into the other project.
Nothing inside it references this project's schema, table names, or
folder layout -- only the generic `.env` parsing conventions and the
tool's own `dbo.__ScriptRunnerHistory` ledger table. Point the env-file
folder and scripts folder at wherever that project keeps them, and fill in
connection fields by hand if its `.env` uses different variable names.

## Troubleshooting

**`.\DbScriptRunner.ps1` fails with "Missing closing '}' in statement
block" even though the file looks fine** -- this happens when the script
was edited and re-saved with a non-ASCII character (smart quotes, em
dashes, etc.) in a UTF-8-without-BOM file. Windows PowerShell 5.1
(`powershell.exe`, not `pwsh.exe`) reads a BOM-less `.ps1` using the
system ANSI codepage, which mangles multi-byte UTF-8 characters and can
throw off brace matching at a location far from the real problem. Fix:
keep the file plain ASCII (see the `.NOTES` block at the top of
`DbScriptRunner.ps1`), or save it with a UTF-8 BOM if you must use
non-ASCII characters.
