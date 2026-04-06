param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,

    [Parameter(Mandatory = $true)]
    [string]$TargetPath,

    [string]$Server = "user@192.168.0.80",
    [string]$Password = "P@ssw0rd2024",

    [switch]$RestartPortal
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

function Quote-Single {
    param([string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

$plink = Get-PuttyTool -ExecutableName "plink.exe"

$quotedBackupPath = Quote-Single -Value $BackupPath
$quotedTargetPath = Quote-Single -Value $TargetPath

$remoteCommand = @"
if [ ! -f $quotedBackupPath ]; then
  echo 'BACKUP_NOT_FOUND'
  exit 2
fi
cp $quotedBackupPath $quotedTargetPath
"@

Write-Host "Restaurando backup no servidor..." -ForegroundColor Cyan
& $plink -ssh $Server -pw $Password $remoteCommand
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao restaurar '$BackupPath' para '$TargetPath'."
}

if ($RestartPortal) {
    Write-Host "Reiniciando portal..." -ForegroundColor Cyan
    & $plink -ssh $Server -pw $Password "pm2 restart portal"
    if ($LASTEXITCODE -ne 0) {
        throw "O backup foi restaurado, mas houve falha ao reiniciar o portal."
    }
}

Write-Host "Restauracao concluida para: $TargetPath" -ForegroundColor Green
