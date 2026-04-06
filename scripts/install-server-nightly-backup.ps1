param(
    [string]$Server = "user@192.168.0.80",
    [string]$Password = "P@ssw0rd2024",
    [string]$RemoteScriptPath = "/var/www/html/wkl/Portal/scripts/server-nightly-backup.sh",
    [string]$RemoteDbScriptPath = "/var/www/html/wkl/Portal/scripts/server-nightly-db-backup.js",
    [string]$CronSchedule = "30 2 * * *",
    [string]$CronScheduleDb = "45 2 * * *"
)

$ErrorActionPreference = "Stop"

function Get-PuttyTool {
    param([string]$ExecutableName)

    $candidate = Join-Path "C:\Program Files\PuTTY" $ExecutableName
    if (-not (Test-Path $candidate)) {
        throw "Nao encontrei $ExecutableName em '$candidate'."
    }
    return $candidate
}

function Assert-Success {
    param(
        [int]$ExitCode,
        [string]$Message
    )

    if ($ExitCode -ne 0) {
        throw $Message
    }
}

$localScript = Join-Path $PSScriptRoot "server-nightly-backup.sh"
if (-not (Test-Path $localScript)) {
    throw "Nao encontrei o script local em '$localScript'."
}

$localDbScript = Join-Path $PSScriptRoot "server-nightly-db-backup.js"
if (-not (Test-Path $localDbScript)) {
    throw "Nao encontrei o script local em '$localDbScript'."
}

$plink = Get-PuttyTool -ExecutableName "plink.exe"
$pscp = Get-PuttyTool -ExecutableName "pscp.exe"

$remoteDir = ($RemoteScriptPath -replace '/[^/]+$', '')
Write-Host "Preparando pasta remota..." -ForegroundColor Cyan
& $plink -ssh $Server -pw $Password "mkdir -p '$remoteDir'"
Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao preparar a pasta remota."

Write-Host "Enviando script de backup agendado..." -ForegroundColor Cyan
& $pscp -pw $Password $localScript "$Server`:$RemoteScriptPath"
Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao enviar o script para o servidor."

Write-Host "Enviando script de backup do banco..." -ForegroundColor Cyan
& $pscp -pw $Password $localDbScript "$Server`:$RemoteDbScriptPath"
Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao enviar o script de backup do banco para o servidor."

$cronCommand = "$CronSchedule $RemoteScriptPath >> /var/www/html/wkl/Portal/logs/nightly-backup.log 2>&1"
$cronDbCommand = "$CronScheduleDb node $RemoteDbScriptPath >> /var/www/html/wkl/Portal/logs/nightly-db-backup.log 2>&1"
$remoteInstall = "chmod +x '$RemoteScriptPath' && (crontab -l 2>/dev/null | grep -v 'server-nightly-backup.sh' | grep -v 'server-nightly-db-backup.js'; echo '$cronCommand'; echo '$cronDbCommand') | crontab - && crontab -l | grep -E 'server-nightly-backup.sh|server-nightly-db-backup.js'"

Write-Host "Instalando rotina no crontab..." -ForegroundColor Cyan
& $plink -ssh $Server -pw $Password $remoteInstall
Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao instalar o crontab do backup agendado."

Write-Host "Rotina agendada instalada com sucesso." -ForegroundColor Green
