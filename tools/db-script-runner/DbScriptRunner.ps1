<#
.SYNOPSIS
    DB Script Runner -- a generic Windows Forms GUI for applying .sql
    migration/seed scripts to a SQL Server (or Azure SQL Database)
    database, in order, with a tracked history so you never re-run
    (or forget to run) a script by accident.

.DESCRIPTION
    This tool is intentionally generic and NOT tied to any specific
    project's schema or folder layout. It can be copied into any
    SQL-Server-based project that keeps its DB changes as plain .sql
    files on disk and (optionally) connection settings in a .env-style
    file.

    Workflow:
      1. Pick a folder containing a .env-style file (or type connection
         settings in by hand) and choose which env file to use.
      2. Pick a folder of .sql scripts (defaults to database/migrations
         under the current directory, if present). A sibling
         database/seed folder is auto-detected and offered as a second
         tab.
      3. The list shows every .sql file, naturally sorted, with its
         Applied / Not Applied / Changed status (tracked via a
         dbo.__ScriptRunnerHistory table created automatically in the
         target database).
      4. Check the scripts you want, click "Run Selected". Each script
         runs in filename order via sqlcmd.exe (falling back to
         Invoke-Sqlcmd if sqlcmd.exe isn't on PATH). Output streams
         live into the log panel. The batch stops at the first error;
         only scripts that succeeded are recorded in the history table.

.NOTES
    Run via Run.bat (double-click) or:
      powershell -ExecutionPolicy Bypass -File DbScriptRunner.ps1

    Keep this file plain ASCII. Windows PowerShell 5.1 (the "powershell.exe"
    that ships with Windows, as opposed to "pwsh.exe"/PowerShell 7+) reads a
    .ps1 with no UTF-8 BOM using the system ANSI codepage, not UTF-8 -- any
    non-ASCII character (smart quotes, em dashes, box-drawing characters,
    etc.) gets silently mangled on read, which can shift brace/paren
    matching and produce confusing "Missing closing '}'" errors far from
    the actual offending character. This bit a real user on first run; if
    you're editing this file, don't reintroduce non-ASCII characters.
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# -------------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------------

# Walks upward from $StartPath looking for a subfolder matching
# $RelativeTarget (e.g. 'database\migrations'). Used so the tool finds the
# right defaults regardless of how it's launched -- double-clicking Run.bat,
# right-click > Run with PowerShell, or invoking from an arbitrary terminal
# directory can all leave the process's current directory somewhere other
# than the project root (notably: double-clicking a .bat sets the current
# directory to the .bat's own folder, i.e. this tool's folder itself, which
# has no database\migrations subfolder of its own).
function Find-UpwardFolder {
    param(
        [string]$StartPath,
        [string]$RelativeTarget
    )
    $dir = $StartPath
    for ($i = 0; $i -lt 10 -and $dir; $i++) {
        $candidate = Join-Path $dir $RelativeTarget
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            return $candidate
        }
        $parent = Split-Path -Parent $dir
        if (-not $parent -or $parent -eq $dir) { break }
        $dir = $parent
    }
    return $null
}

function Get-NaturalSortKey {
    <#
        Splits a filename into alternating text/number chunks so that
        natural sort works (e.g. "002_x.sql" sorts before "011_x.sql",
        not after "02_x.sql" alphabetically-as-strings).
        Returns an array mixing [string] and [int] pieces; PowerShell's
        Sort-Object compares array elements positionally when given a
        script block that returns such an array via a custom comparer,
        so instead we build a zero-padded sortable string key.
    #>
    param([string]$Name)

    $parts = [regex]::Matches($Name, '(\d+|\D+)') | ForEach-Object {
        $token = $_.Value
        if ($token -match '^\d+$') {
            # pad numeric chunks so string comparison behaves numerically
            $token.PadLeft(20, '0')
        } else {
            $token
        }
    }
    return [string]::Join('', $parts)
}

function Get-FileSha256 {
    param([string]$Path)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $hashBytes = $hasher.ComputeHash($stream)
        } finally {
            $stream.Dispose()
        }
    } finally {
        $hasher.Dispose()
    }
    return [System.BitConverter]::ToString($hashBytes).Replace('-', '').ToLowerInvariant()
}

function Parse-EnvFile {
    <#
        Generic KEY=value parser. Skips blank lines and lines starting
        with '#'. Strips matching surrounding single or double quotes
        from values. Returns a hashtable (case-insensitive keys, as env
        var names conventionally are).
    #>
    param([string]$Path)

    $result = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $result }

    foreach ($rawLine in Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue) {
        $line = $rawLine.Trim()
        if ($line.Length -eq 0) { continue }
        if ($line.StartsWith('#')) { continue }
        if ($line.StartsWith('export ')) { $line = $line.Substring(7).Trim() }

        $eqIndex = $line.IndexOf('=')
        if ($eqIndex -lt 1) { continue }

        $key = $line.Substring(0, $eqIndex).Trim()
        $value = $line.Substring($eqIndex + 1).Trim()

        # strip inline comments that trail an unquoted value (best-effort,
        # generic .env files commonly do "KEY=value   # comment")
        if ($value.Length -gt 0 -and $value[0] -ne '"' -and $value[0] -ne "'") {
            $hashIdx = $value.IndexOf(' #')
            if ($hashIdx -ge 0) { $value = $value.Substring(0, $hashIdx).Trim() }
        }

        if ($value.Length -ge 2) {
            $first = $value[0]
            $last = $value[$value.Length - 1]
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        $result[$key] = $value
    }
    return $result
}

function Find-EnvFiles {
    param([string]$Folder)
    if (-not (Test-Path -LiteralPath $Folder)) { return @() }
    $patterns = @('.env', '.env.*', '*.env')
    $found = @{}
    foreach ($pattern in $patterns) {
        Get-ChildItem -LiteralPath $Folder -Filter $pattern -File -ErrorAction SilentlyContinue |
            ForEach-Object { $found[$_.FullName] = $_ }
    }
    return $found.Values | Sort-Object Name
}

# Resolves the sqlcmd/Invoke-Sqlcmd auth + encryption args from the
# connection settings currently in the form.
function Build-SqlcmdArgs {
    param(
        [string]$Server,
        [string]$Port,
        [string]$Database,
        [bool]$Trusted,
        [string]$User,
        [string]$Password,
        [bool]$Encrypt
    )

    $serverArg = $Server
    if ($Port -and $Port.Trim().Length -gt 0) {
        $serverArg = "$Server,$Port"
    }

    $argList = New-Object System.Collections.Generic.List[string]
    $argList.Add('-S'); $argList.Add($serverArg)
    $argList.Add('-d'); $argList.Add($Database)

    if ($Trusted) {
        $argList.Add('-E')
    } else {
        $argList.Add('-U'); $argList.Add($User)
        $argList.Add('-P'); $argList.Add($Password)
    }

    # Modern sqlcmd (mssql-cli / ODBC 17+ based, ships with recent SSMS)
    # supports -N (encrypt) and -C (trust server cert). These are also
    # exactly what Azure SQL Database requires: encrypted connection,
    # and (for a self-signed/dev chain) trusting the cert.
    if ($Encrypt) {
        $argList.Add('-N')
        $argList.Add('-C')
    }

    return ,$argList.ToArray()
}

function Test-SqlcmdAvailable {
    $cmd = Get-Command sqlcmd.exe -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command sqlcmd -ErrorAction SilentlyContinue }
    return $cmd
}

function Test-InvokeSqlcmdAvailable {
    return [bool](Get-Module -ListAvailable -Name SqlServer -ErrorAction SilentlyContinue)
}

$HistoryTableDdl = @"
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '__ScriptRunnerHistory' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.__ScriptRunnerHistory (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        ScriptName NVARCHAR(500) NOT NULL,
        AppliedAt DATETIME2 NOT NULL,
        Success BIT NOT NULL,
        Checksum NVARCHAR(64) NOT NULL
    );
END
"@

# -------------------------------------------------------------------------
# Form state
# -------------------------------------------------------------------------

$script:ConnSettings = [ordered]@{
    Server      = ''
    Port        = ''
    Database    = ''
    Trusted     = $true
    User        = ''
    Password    = ''
    Encrypt     = $false
    SqlcmdPath  = $null   # resolved at run time
}

$script:ScriptsFolder = $null
$script:SeedFolder    = $null
$script:HistoryCache  = @{}   # ScriptName(lower) -> @{ AppliedAt; Success; Checksum }

# -------------------------------------------------------------------------
# Form layout
# -------------------------------------------------------------------------

$form = New-Object System.Windows.Forms.Form
$form.Text = 'DB Script Runner'
$form.Size = New-Object System.Drawing.Size(980, 760)
$form.StartPosition = 'CenterScreen'
$form.MinimumSize = New-Object System.Drawing.Size(860, 600)

$tabControl = New-Object System.Windows.Forms.TabControl
$tabControl.Dock = 'Fill'

# ---- Tab 1: Connection ----------------------------------------------------
$tabConn = New-Object System.Windows.Forms.TabPage
$tabConn.Text = 'Connection'

$connLayout = New-Object System.Windows.Forms.TableLayoutPanel
$connLayout.Dock = 'Top'
$connLayout.AutoSize = $true
$connLayout.ColumnCount = 3
$connLayout.Padding = New-Object System.Windows.Forms.Padding(10)
[void]$connLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 150)))
[void]$connLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
[void]$connLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 100)))

function New-Label($text) {
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $text
    $lbl.AutoSize = $true
    $lbl.Margin = New-Object System.Windows.Forms.Padding(3, 8, 3, 3)
    return $lbl
}

# Env folder row
$lblEnvFolder = New-Label 'Env file folder:'
$txtEnvFolder = New-Object System.Windows.Forms.TextBox
$txtEnvFolder.Dock = 'Fill'
$script:DefaultEnvFolder = Find-UpwardFolder -StartPath $PSScriptRoot -RelativeTarget 'src\api'
if (-not $script:DefaultEnvFolder) {
    $script:DefaultEnvFolder = Find-UpwardFolder -StartPath (Get-Location).Path -RelativeTarget 'src\api'
}
if (-not $script:DefaultEnvFolder) { $script:DefaultEnvFolder = (Get-Location).Path }
$txtEnvFolder.Text = $script:DefaultEnvFolder
$btnBrowseEnvFolder = New-Object System.Windows.Forms.Button
$btnBrowseEnvFolder.Text = 'Browse...'
$btnBrowseEnvFolder.Dock = 'Fill'
$connLayout.Controls.Add($lblEnvFolder, 0, 0)
$connLayout.Controls.Add($txtEnvFolder, 1, 0)
$connLayout.Controls.Add($btnBrowseEnvFolder, 2, 0)

# Env file picker row
$lblEnvFile = New-Label 'Env file:'
$cmbEnvFile = New-Object System.Windows.Forms.ComboBox
$cmbEnvFile.Dock = 'Fill'
$cmbEnvFile.DropDownStyle = 'DropDownList'
$btnLoadEnv = New-Object System.Windows.Forms.Button
$btnLoadEnv.Text = 'Load'
$btnLoadEnv.Dock = 'Fill'
$connLayout.Controls.Add($lblEnvFile, 0, 1)
$connLayout.Controls.Add($cmbEnvFile, 1, 1)
$connLayout.Controls.Add($btnLoadEnv, 2, 1)

# Separator-ish label
$lblManual = New-Label 'Connection settings (auto-filled from env file -- edit freely):'
$lblManual.Font = New-Object System.Drawing.Font($lblManual.Font, [System.Drawing.FontStyle]::Bold)
$connLayout.Controls.Add($lblManual, 0, 2)
$connLayout.SetColumnSpan($lblManual, 3)

$lblServer = New-Label 'Server (DB_SERVER):'
$txtServer = New-Object System.Windows.Forms.TextBox
$txtServer.Dock = 'Fill'
$connLayout.Controls.Add($lblServer, 0, 3)
$connLayout.Controls.Add($txtServer, 1, 3)

$lblPort = New-Label 'Port (DB_PORT):'
$txtPort = New-Object System.Windows.Forms.TextBox
$txtPort.Dock = 'Fill'
$connLayout.Controls.Add($lblPort, 0, 4)
$connLayout.Controls.Add($txtPort, 1, 4)

$lblDatabase = New-Label 'Database (DB_NAME):'
$txtDatabase = New-Object System.Windows.Forms.TextBox
$txtDatabase.Dock = 'Fill'
$connLayout.Controls.Add($lblDatabase, 0, 5)
$connLayout.Controls.Add($txtDatabase, 1, 5)

$lblTrusted = New-Label 'Trusted/Windows Auth (DB_TRUSTED_CONNECTION):'
$chkTrusted = New-Object System.Windows.Forms.CheckBox
$chkTrusted.Checked = $true
$connLayout.Controls.Add($lblTrusted, 0, 6)
$connLayout.Controls.Add($chkTrusted, 1, 6)

$lblUser = New-Label 'User (DB_USER):'
$txtUser = New-Object System.Windows.Forms.TextBox
$txtUser.Dock = 'Fill'
$connLayout.Controls.Add($lblUser, 0, 7)
$connLayout.Controls.Add($txtUser, 1, 7)

$lblPassword = New-Label 'Password (DB_PASSWORD):'
$txtPassword = New-Object System.Windows.Forms.TextBox
$txtPassword.Dock = 'Fill'
$txtPassword.UseSystemPasswordChar = $true
$connLayout.Controls.Add($lblPassword, 0, 8)
$connLayout.Controls.Add($txtPassword, 1, 8)

$lblEncrypt = New-Label 'Encrypt / Azure SQL (DB_ENCRYPT):'
$chkEncrypt = New-Object System.Windows.Forms.CheckBox
$connLayout.Controls.Add($lblEncrypt, 0, 9)
$connLayout.Controls.Add($chkEncrypt, 1, 9)

$lblSqlcmdStatus = New-Label 'Execution engine:'
$valSqlcmdStatus = New-Object System.Windows.Forms.Label
$valSqlcmdStatus.AutoSize = $true
$valSqlcmdStatus.Margin = New-Object System.Windows.Forms.Padding(3, 8, 3, 3)
$valSqlcmdStatus.Text = 'Checking...'
$connLayout.Controls.Add($lblSqlcmdStatus, 0, 10)
$connLayout.Controls.Add($valSqlcmdStatus, 1, 10)

$btnTestConn = New-Object System.Windows.Forms.Button
$btnTestConn.Text = 'Test Connection'
$btnTestConn.Width = 160
$btnTestConn.Margin = New-Object System.Windows.Forms.Padding(3, 10, 3, 3)
$connLayout.Controls.Add($btnTestConn, 1, 11)

$tabConn.Controls.Add($connLayout)

# ---- Tab 2: Migrations -----------------------------------------------------
$tabMigrations = New-Object System.Windows.Forms.TabPage
$tabMigrations.Text = 'Migrations'

# ---- Tab 3: Seed -----------------------------------------------------------
$tabSeed = New-Object System.Windows.Forms.TabPage
$tabSeed.Text = 'Seed'

$tabControl.Controls.Add($tabConn)
$tabControl.Controls.Add($tabMigrations)
$tabControl.Controls.Add($tabSeed)

# Builds the common "folder + list + buttons" UI used by both the
# Migrations and Seed tabs, and returns a hashtable of the controls so
# the caller can wire up events / refresh logic per tab.
function New-ScriptTabUi {
    param(
        [System.Windows.Forms.TabPage]$Page,
        [string]$DefaultFolder
    )

    $top = New-Object System.Windows.Forms.Panel
    $top.Dock = 'Top'
    $top.Height = 36

    $txtFolder = New-Object System.Windows.Forms.TextBox
    $txtFolder.Left = 10
    $txtFolder.Top = 6
    $txtFolder.Width = 650
    $txtFolder.Anchor = 'Top,Left,Right'
    $txtFolder.Text = $DefaultFolder

    $btnBrowse = New-Object System.Windows.Forms.Button
    $btnBrowse.Text = 'Browse...'
    $btnBrowse.Left = 670
    $btnBrowse.Top = 4
    $btnBrowse.Width = 90
    $btnBrowse.Anchor = 'Top,Right'

    $btnRefresh = New-Object System.Windows.Forms.Button
    $btnRefresh.Text = 'Refresh List'
    $btnRefresh.Left = 770
    $btnRefresh.Top = 4
    $btnRefresh.Width = 100
    $btnRefresh.Anchor = 'Top,Right'

    $top.Controls.AddRange(@($txtFolder, $btnBrowse, $btnRefresh))

    $list = New-Object System.Windows.Forms.ListView
    $list.Dock = 'Fill'
    $list.View = 'Details'
    $list.CheckBoxes = $true
    $list.FullRowSelect = $true
    $list.GridLines = $true
    [void]$list.Columns.Add('Script', 480)
    [void]$list.Columns.Add('Status', 140)
    [void]$list.Columns.Add('Last Applied', 170)

    $bottom = New-Object System.Windows.Forms.Panel
    $bottom.Dock = 'Bottom'
    $bottom.Height = 40

    $btnSelectAll = New-Object System.Windows.Forms.Button
    $btnSelectAll.Text = 'Select All'
    $btnSelectAll.Left = 10
    $btnSelectAll.Top = 5
    $btnSelectAll.Width = 90

    $btnSelectNone = New-Object System.Windows.Forms.Button
    $btnSelectNone.Text = 'Select None'
    $btnSelectNone.Left = 110
    $btnSelectNone.Top = 5
    $btnSelectNone.Width = 90

    $btnRun = New-Object System.Windows.Forms.Button
    $btnRun.Text = 'Run Selected'
    $btnRun.Left = 220
    $btnRun.Top = 5
    $btnRun.Width = 140
    $btnRun.Font = New-Object System.Drawing.Font($btnRun.Font, [System.Drawing.FontStyle]::Bold)

    $bottom.Controls.AddRange(@($btnSelectAll, $btnSelectNone, $btnRun))

    $Page.Controls.Add($list)
    $Page.Controls.Add($bottom)
    $Page.Controls.Add($top)

    return @{
        Folder     = $txtFolder
        Browse     = $btnBrowse
        Refresh    = $btnRefresh
        List       = $list
        SelectAll  = $btnSelectAll
        SelectNone = $btnSelectNone
        Run        = $btnRun
    }
}

$defaultMigrationsFolder = Find-UpwardFolder -StartPath $PSScriptRoot -RelativeTarget 'database\migrations'
if (-not $defaultMigrationsFolder) {
    $defaultMigrationsFolder = Find-UpwardFolder -StartPath (Get-Location).Path -RelativeTarget 'database\migrations'
}
if (-not $defaultMigrationsFolder) {
    $defaultMigrationsFolder = (Get-Location).Path
}
$migrationsUi = New-ScriptTabUi -Page $tabMigrations -DefaultFolder $defaultMigrationsFolder

$defaultSeedFolder = Join-Path (Split-Path -Parent $defaultMigrationsFolder) 'seed'
if (-not (Test-Path -LiteralPath $defaultSeedFolder)) {
    $defaultSeedFolder = $defaultMigrationsFolder
}
$seedUi = New-ScriptTabUi -Page $tabSeed -DefaultFolder $defaultSeedFolder

# ---- Log panel (shared, below the tab control) ----------------------------
$logPanel = New-Object System.Windows.Forms.Panel
$logPanel.Dock = 'Bottom'
$logPanel.Height = 220

$lblLog = New-Object System.Windows.Forms.Label
$lblLog.Text = 'Execution Log'
$lblLog.Dock = 'Top'
$lblLog.Height = 20
$lblLog.Font = New-Object System.Drawing.Font($lblLog.Font, [System.Drawing.FontStyle]::Bold)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ScrollBars = 'Vertical'
$txtLog.ReadOnly = $true
$txtLog.Dock = 'Fill'
$txtLog.Font = New-Object System.Drawing.Font('Consolas', 9)
$txtLog.BackColor = [System.Drawing.Color]::Black
$txtLog.ForeColor = [System.Drawing.Color]::LightGreen

$logPanel.Controls.Add($txtLog)
$logPanel.Controls.Add($lblLog)


# Add the Bottom-docked log panel first, then the Fill-docked tab control,
# so the tab control correctly fills the remaining space above the log.
$form.Controls.Add($logPanel)
$form.Controls.Add($tabControl)

function Write-Log {
    param([string]$Message, [switch]$NoNewline)
    $timestamp = Get-Date -Format 'HH:mm:ss'
    $line = "[$timestamp] $Message"
    if ($txtLog.InvokeRequired) {
        $txtLog.Invoke([Action[string]]{ param($l) $txtLog.AppendText($l + [Environment]::NewLine) }, $line)
    } else {
        $txtLog.AppendText($line + [Environment]::NewLine)
    }
    [System.Windows.Forms.Application]::DoEvents()
}

# -------------------------------------------------------------------------
# Env file wiring
# -------------------------------------------------------------------------

function Refresh-EnvFileList {
    $cmbEnvFile.Items.Clear()
    $files = Find-EnvFiles -Folder $txtEnvFolder.Text
    foreach ($f in $files) {
        [void]$cmbEnvFile.Items.Add($f.Name)
    }
    if ($cmbEnvFile.Items.Count -gt 0) {
        $cmbEnvFile.SelectedIndex = 0
    } else {
        Write-Log "No .env-style files found in: $($txtEnvFolder.Text)"
    }
}

$btnBrowseEnvFolder.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.SelectedPath = $txtEnvFolder.Text
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $txtEnvFolder.Text = $dlg.SelectedPath
        Refresh-EnvFileList
    }
})

$btnLoadEnv.Add_Click({
    if ($cmbEnvFile.SelectedItem) {
        $path = Join-Path $txtEnvFolder.Text $cmbEnvFile.SelectedItem
        $values = Parse-EnvFile -Path $path

        # Generic lookup: try the exact key, case-insensitively.
        function Get-EnvVal($table, $key, $fallback = '') {
            foreach ($k in $table.Keys) {
                if ($k -ieq $key) { return $table[$k] }
            }
            return $fallback
        }

        $txtServer.Text   = Get-EnvVal $values 'DB_SERVER' $txtServer.Text
        $txtPort.Text     = Get-EnvVal $values 'DB_PORT' ''
        $txtDatabase.Text = Get-EnvVal $values 'DB_NAME' $txtDatabase.Text
        $trustedVal       = Get-EnvVal $values 'DB_TRUSTED_CONNECTION' ''
        if ($trustedVal -ne '') { $chkTrusted.Checked = ($trustedVal -ieq 'true') }
        $txtUser.Text     = Get-EnvVal $values 'DB_USER' ''
        $txtPassword.Text = Get-EnvVal $values 'DB_PASSWORD' ''
        $encryptVal       = Get-EnvVal $values 'DB_ENCRYPT' ''
        if ($encryptVal -ne '') { $chkEncrypt.Checked = ($encryptVal -ieq 'true') }

        Write-Log "Loaded env file: $path"
    }
})

Refresh-EnvFileList

# Detect sqlcmd / Invoke-Sqlcmd availability up front
$script:SqlcmdCmd = Test-SqlcmdAvailable
if ($script:SqlcmdCmd) {
    $valSqlcmdStatus.Text = "sqlcmd.exe found ($($script:SqlcmdCmd.Source))"
} elseif (Test-InvokeSqlcmdAvailable) {
    $valSqlcmdStatus.Text = 'sqlcmd.exe NOT found -- falling back to Invoke-Sqlcmd (SqlServer module)'
} else {
    $valSqlcmdStatus.Text = 'NEITHER sqlcmd.exe NOR the SqlServer module (Invoke-Sqlcmd) found -- install one to run scripts'
    $valSqlcmdStatus.ForeColor = [System.Drawing.Color]::Red
}

function Get-CurrentConnSettings {
    return @{
        Server   = $txtServer.Text.Trim()
        Port     = $txtPort.Text.Trim()
        Database = $txtDatabase.Text.Trim()
        Trusted  = $chkTrusted.Checked
        User     = $txtUser.Text
        Password = $txtPassword.Text
        Encrypt  = $chkEncrypt.Checked
    }
}

# Runs a single .sql file (or inline SQL text) against the configured
# connection. Returns $true on success, $false on failure. Streams
# output into the log as it runs (sqlcmd path) or after completion
# (Invoke-Sqlcmd path, which does not stream natively).
function Invoke-SqlScriptFile {
    param(
        [string]$FilePath,
        [switch]$IsInlineCommand,  # when set, $FilePath is actually a -Q command string, not a file
        [string]$DatabaseOverride  # connect to this database instead of the configured one (e.g. 'master')
    )

    $c = Get-CurrentConnSettings
    $effectiveDatabase = if ($DatabaseOverride) { $DatabaseOverride } else { $c.Database }

    if ($script:SqlcmdCmd) {
        $argArray = Build-SqlcmdArgs -Server $c.Server -Port $c.Port -Database $effectiveDatabase `
            -Trusted $c.Trusted -User $c.User -Password $c.Password -Encrypt $c.Encrypt

        if ($IsInlineCommand) {
            $argArray += @('-Q', $FilePath)
        } else {
            $argArray += @('-i', $FilePath)
        }
        $argArray += @('-b')   # exit with error code on SQL error, so we can detect failure

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $script:SqlcmdCmd.Source
        foreach ($a in $argArray) { [void]$psi.ArgumentList.Add($a) }
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true

        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi

        # NOTE: earlier versions of this tool captured output via
        # Register-ObjectEvent (OutputDataReceived/ErrorDataReceived) with
        # an -Action scriptblock calling Write-Log. That scriptblock runs
        # in a separate PowerShell event-subscriber scope that does NOT see
        # functions defined in this script's scope -- Write-Log was
        # effectively undefined there, the event action failed silently
        # (PowerShell swallows errors inside event subscriber actions by
        # default), and every line of sqlcmd's real output/error text was
        # lost. This surfaced as "Connection FAILED -- see log above for
        # details" with nothing actually in the log above it. Fixed by
        # reading stdout/stderr synchronously after the process exits
        # instead -- simpler, and immune to that scoping pitfall.
        [void]$proc.Start()
        $stdout = $proc.StandardOutput.ReadToEnd()
        $stderr = $proc.StandardError.ReadToEnd()
        $proc.WaitForExit()

        if ($stdout) {
            foreach ($line in ($stdout -split "`r?`n")) {
                if ($line) { Write-Log $line }
            }
        }
        if ($stderr) {
            foreach ($line in ($stderr -split "`r?`n")) {
                if ($line) { Write-Log "STDERR: $line" }
            }
        }
        if ($proc.ExitCode -ne 0) {
            Write-Log "sqlcmd exited with code $($proc.ExitCode)."
        }

        return ($proc.ExitCode -eq 0)
    }
    elseif (Test-InvokeSqlcmdAvailable) {
        Import-Module SqlServer -ErrorAction SilentlyContinue
        try {
            $invokeParams = @{
                ServerInstance = if ($c.Port) { "$($c.Server),$($c.Port)" } else { $c.Server }
                Database       = $effectiveDatabase
                ErrorAction    = 'Stop'
            }
            if ($IsInlineCommand) {
                $invokeParams['Query'] = $FilePath
            } else {
                $invokeParams['InputFile'] = $FilePath
            }
            if (-not $c.Trusted) {
                $invokeParams['Username'] = $c.User
                $invokeParams['Password'] = $c.Password
            }
            if ($c.Encrypt) {
                $invokeParams['Encrypt'] = 'Mandatory'
                $invokeParams['TrustServerCertificate'] = $true
            }
            $result = Invoke-Sqlcmd @invokeParams -Verbose 4>&1
            foreach ($line in $result) { Write-Log ($line | Out-String).Trim() }
            return $true
        } catch {
            Write-Log "ERROR: $($_.Exception.Message)"
            return $false
        }
    }
    else {
        Write-Log 'ERROR: No SQL execution engine available (sqlcmd.exe or SqlServer module).'
        return $false
    }
}

function Ensure-HistoryTable {
    Write-Log 'Ensuring dbo.__ScriptRunnerHistory exists...'
    $ok = Invoke-SqlScriptFile -FilePath $HistoryTableDdl -IsInlineCommand
    if (-not $ok) {
        Write-Log 'WARNING: could not verify/create history table -- status tracking may not work.'
    }
    return $ok
}

function Load-History {
    $script:HistoryCache = @{}
    $c = Get-CurrentConnSettings
    if (-not $c.Server -or -not $c.Database) { return }

    # Use a delimiter-friendly SELECT so we can parse it back out simply.
    $query = "SET NOCOUNT ON; SELECT ScriptName + '||' + CONVERT(VARCHAR(33), AppliedAt, 126) + '||' + CAST(Success AS VARCHAR(1)) + '||' + Checksum FROM dbo.__ScriptRunnerHistory t WHERE t.Id IN (SELECT MAX(Id) FROM dbo.__ScriptRunnerHistory GROUP BY ScriptName);"

    if ($script:SqlcmdCmd) {
        $argArray = Build-SqlcmdArgs -Server $c.Server -Port $c.Port -Database $c.Database `
            -Trusted $c.Trusted -User $c.User -Password $c.Password -Encrypt $c.Encrypt
        $argArray += @('-Q', $query, '-h', '-1', '-W')

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $script:SqlcmdCmd.Source
        foreach ($a in $argArray) { [void]$psi.ArgumentList.Add($a) }
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true

        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $stdout = $proc.StandardOutput.ReadToEnd()
        $proc.WaitForExit()

        foreach ($line in ($stdout -split "`r?`n")) {
            if ($line -notmatch '\|\|') { continue }
            # NOTE: $line.Split('||') would split on each char ('|'), not the
            # 2-char sequence, so use a regex split instead.
            $segs = $line -split '\|\|'
            if ($segs.Count -lt 4) { continue }
            $name = $segs[0].Trim()
            if ($name.Length -eq 0) { continue }
            $script:HistoryCache[$name.ToLowerInvariant()] = @{
                AppliedAt = $segs[1].Trim()
                Success   = ($segs[2].Trim() -eq '1')
                Checksum  = $segs[3].Trim()
            }
        }
    }
}

function Refresh-ScriptList {
    param($Ui)

    $Ui.List.Items.Clear()
    $folder = $Ui.Folder.Text
    if (-not (Test-Path -LiteralPath $folder)) {
        Write-Log "Folder does not exist: $folder"
        return
    }

    $files = Get-ChildItem -LiteralPath $folder -Filter '*.sql' -File -ErrorAction SilentlyContinue |
        Sort-Object { Get-NaturalSortKey $_.Name }

    foreach ($file in $files) {
        $item = New-Object System.Windows.Forms.ListViewItem($file.Name)
        $historyKey = $file.Name.ToLowerInvariant()
        $status = 'Not Applied'
        $lastApplied = ''

        if ($script:HistoryCache.ContainsKey($historyKey)) {
            $entry = $script:HistoryCache[$historyKey]
            $lastApplied = $entry.AppliedAt
            if (-not $entry.Success) {
                $status = 'Failed (last run)'
            } else {
                $currentHash = Get-FileSha256 -Path $file.FullName
                if ($currentHash -ieq $entry.Checksum) {
                    $status = 'Applied'
                } else {
                    $status = 'Changed since applied'
                }
            }
        }

        [void]$item.SubItems.Add($status)
        [void]$item.SubItems.Add($lastApplied)
        $item.Tag = $file.FullName

        switch ($status) {
            'Applied'               { $item.ForeColor = [System.Drawing.Color]::DarkGreen }
            'Changed since applied' { $item.ForeColor = [System.Drawing.Color]::DarkOrange }
            'Failed (last run)'     { $item.ForeColor = [System.Drawing.Color]::Red }
            default                 { $item.ForeColor = [System.Drawing.Color]::Black }
        }

        [void]$Ui.List.Items.Add($item)
    }

    Write-Log "Listed $($files.Count) script(s) in: $folder"
}

function Record-HistoryEntry {
    param([string]$ScriptName, [string]$Checksum, [bool]$Success)

    $successBit = if ($Success) { 1 } else { 0 }
    $escapedName = $ScriptName.Replace("'", "''")
    $query = "INSERT INTO dbo.__ScriptRunnerHistory (ScriptName, AppliedAt, Success, Checksum) VALUES ('$escapedName', SYSDATETIME(), $successBit, '$Checksum');"
    Invoke-SqlScriptFile -FilePath $query -IsInlineCommand | Out-Null
}

function Run-SelectedScripts {
    param($Ui)

    $c = Get-CurrentConnSettings
    if (-not $c.Server -or -not $c.Database) {
        [System.Windows.Forms.MessageBox]::Show('Please fill in Server and Database on the Connection tab first.', 'Missing connection info', 'OK', 'Warning') | Out-Null
        return
    }

    $checked = @($Ui.List.CheckedItems)
    if ($checked.Count -eq 0) {
        [System.Windows.Forms.MessageBox]::Show('No scripts selected.', 'Nothing to run', 'OK', 'Information') | Out-Null
        return
    }

    # Already-applied-with-no-change scripts get a confirmation prompt.
    $alreadyApplied = $checked | Where-Object { $_.SubItems[1].Text -eq 'Applied' }
    if ($alreadyApplied.Count -gt 0) {
        $names = ($alreadyApplied | ForEach-Object { $_.Text }) -join "`n"
        $confirm = [System.Windows.Forms.MessageBox]::Show(
            "The following script(s) are already marked Applied:`n`n$names`n`nRe-run them anyway?",
            'Already applied', 'YesNo', 'Warning')
        if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) {
            Write-Log 'Run cancelled by user (already-applied confirmation declined).'
            return
        }
    }

    # Sort the checked items by filename (natural order) regardless of
    # check order, so execution always follows filename order.
    $ordered = $checked | Sort-Object { Get-NaturalSortKey $_.Text }

    Ensure-HistoryTable | Out-Null
    Load-History

    Write-Log "=== Starting run of $($ordered.Count) script(s) ==="

    $stopped = $false
    foreach ($item in $ordered) {
        $path = $item.Tag
        $name = $item.Text
        Write-Log "--- Running: $name ---"

        $checksum = Get-FileSha256 -Path $path
        $success = Invoke-SqlScriptFile -FilePath $path

        if ($success) {
            Write-Log "--- SUCCESS: $name ---"
            Record-HistoryEntry -ScriptName $name -Checksum $checksum -Success $true
        } else {
            Write-Log "--- FAILED: $name -- stopping batch. No further scripts in this run will execute. ---"
            Record-HistoryEntry -ScriptName $name -Checksum $checksum -Success $false
            $stopped = $true
            break
        }
    }

    if (-not $stopped) {
        Write-Log '=== All selected scripts completed successfully. ==='
    }

    Load-History
    Refresh-ScriptList -Ui $Ui
}

# -------------------------------------------------------------------------
# Wire up per-tab events
# -------------------------------------------------------------------------

foreach ($pair in @(@{ Ui = $migrationsUi }, @{ Ui = $seedUi })) {
    $ui = $pair.Ui

    $ui.Browse.Add_Click({
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.SelectedPath = $ui.Folder.Text
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $ui.Folder.Text = $dlg.SelectedPath
            Refresh-ScriptList -Ui $ui
        }
    }.GetNewClosure())

    $ui.Refresh.Add_Click({
        Load-History
        Refresh-ScriptList -Ui $ui
    }.GetNewClosure())

    $ui.SelectAll.Add_Click({
        foreach ($i in $ui.List.Items) { $i.Checked = $true }
    }.GetNewClosure())

    $ui.SelectNone.Add_Click({
        foreach ($i in $ui.List.Items) { $i.Checked = $false }
    }.GetNewClosure())

    $ui.Run.Add_Click({
        Run-SelectedScripts -Ui $ui
    }.GetNewClosure())
}

$btnTestConn.Add_Click({
    $c = Get-CurrentConnSettings
    if (-not $c.Server) {
        [System.Windows.Forms.MessageBox]::Show('Please fill in Server first.', 'Missing info', 'OK', 'Warning') | Out-Null
        return
    }

    # Stage 1: can we reach the server at all? Probe against 'master', not
    # the configured target database -- the target database often doesn't
    # exist yet (e.g. a fresh LocalDB instance before migration 001, which
    # itself runs "USE master; ... CREATE DATABASE ...", has no -d flag at
    # all per its own header comment). Testing against a not-yet-created
    # database would always fail here with a confusing "login failed"
    # error that has nothing to do with the server/credentials being wrong.
    Write-Log "Testing server connectivity: $($c.Server) (database: master) ..."
    $serverOk = Invoke-SqlScriptFile -FilePath 'SELECT @@VERSION AS Version;' -IsInlineCommand -DatabaseOverride 'master'

    if (-not $serverOk) {
        Write-Log 'Server connection FAILED -- see log above for details (check Server/Port/credentials/trusted-auth, and that the SQL Server/LocalDB instance is actually running).'
        [System.Windows.Forms.MessageBox]::Show('Could not reach the server. See the log panel for details.', 'Failed', 'OK', 'Error') | Out-Null
        return
    }
    Write-Log 'Server connection OK.'

    # Stage 2: does the configured target database exist? This is
    # informational, not a failure -- a database that doesn't exist yet is
    # the expected, normal state before you've run your creation script.
    if ($c.Database) {
        $checkQuery = "SET NOCOUNT ON; SELECT CASE WHEN DB_ID('$($c.Database.Replace("'", "''"))') IS NOT NULL THEN 1 ELSE 0 END;"
        Write-Log "Checking whether database '$($c.Database)' exists ..."
        $dbCheckOk = Invoke-SqlScriptFile -FilePath $checkQuery -IsInlineCommand -DatabaseOverride 'master'
        if ($dbCheckOk) {
            Write-Log "Database '$($c.Database)' check complete (see output above -- '1' = exists, '0' = not created yet)."
        }
        [System.Windows.Forms.MessageBox]::Show(
            "Server connection succeeded.`n`nCheck the log panel to see whether database '$($c.Database)' already exists. If not, that's expected before you've run your database-creation script -- run it first (it connects to master itself and doesn't need the target database to exist yet).",
            'Server reachable', 'OK', 'Information') | Out-Null
    } else {
        [System.Windows.Forms.MessageBox]::Show('Server connection succeeded. No target database configured -- fine if you plan to run a creation script first.', 'Server reachable', 'OK', 'Information') | Out-Null
    }
})

# Initial population
Refresh-ScriptList -Ui $migrationsUi
Refresh-ScriptList -Ui $seedUi

Write-Log 'DB Script Runner ready.'
if (-not $script:SqlcmdCmd -and -not (Test-InvokeSqlcmdAvailable)) {
    Write-Log 'WARNING: install sqlcmd (via "SQL Server Command Line Utilities" / Azure CLI / SSMS tools) or the PowerShell SqlServer module (Install-Module SqlServer) to actually run scripts.'
}

[void]$form.ShowDialog()
