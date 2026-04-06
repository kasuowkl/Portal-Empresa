param(
    [Parameter(Mandatory = $true)]
    [string]$LocalPath,

    [Parameter(Mandatory = $true)]
    [string]$RemotePath,

    [string]$Server = "user@192.168.0.80",
    [string]$Password = "P@ssw0rd2024",
    [string]$BackupRoot = "/var/www/html/wkl/Portal/_backups",

    [switch]$AutoCommit,
    [string]$CommitMessage,

    [switch]$RestartPortal
)

$ErrorActionPreference = "Stop"

function Assert-Success {
    param(
        [int]$ExitCode,
        [string]$Message
    )

    if ($ExitCode -ne 0) {
        throw $Message
    }
}

function Get-PuttyTool {
    param([string]$ExecutableName)

    $candidate = Join-Path "C:\Program Files\PuTTY" $ExecutableName
    if (-not (Test-Path $candidate)) {
        throw "Nao encontrei $ExecutableName em '$candidate'."
    }
    return $candidate
}

function Get-RemoteDirectory {
    param([string]$Path)
    return ($Path -replace '/[^/]+$', '')
}

function Get-RemoteFileName {
    param([string]$Path)
    return ($Path -replace '^.*/', '')
}

function Quote-Single {
    param([string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Get-RelativeGitPath {
    param([string]$FullPath)

    $repoRoot = (git rev-parse --show-toplevel).Trim()
    Assert-Success -ExitCode $LASTEXITCODE -Message "Nao foi possivel localizar a raiz do repositorio Git."

    $resolvedRepo = [System.IO.Path]::GetFullPath($repoRoot)
    $resolvedFile = [System.IO.Path]::GetFullPath($FullPath)

    if (-not $resolvedFile.StartsWith($resolvedRepo, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "O arquivo '$FullPath' nao esta dentro do repositorio Git."
    }

    return [System.IO.Path]::GetRelativePath($resolvedRepo, $resolvedFile)
}

function Commit-FileIfNeeded {
    param(
        [string]$FullPath,
        [string]$Message
    )

    $relativePath = Get-RelativeGitPath -FullPath $FullPath
    $status = git status --porcelain -- $relativePath
    Assert-Success -ExitCode $LASTEXITCODE -Message "Nao foi possivel consultar o status Git de '$relativePath'."

    if (-not $status) {
        Write-Host "Sem alteracoes Git para commit em '$relativePath'." -ForegroundColor Yellow
        return
    }

    git add -- $relativePath
    Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao adicionar '$relativePath' ao stage."

    $finalMessage = $Message
    if ([string]::IsNullOrWhiteSpace($finalMessage)) {
        $finalMessage = "publish: atualiza $relativePath"
    }

    git commit -m $finalMessage
    Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao criar commit automatico para '$relativePath'."
}

if (-not (Test-Path $LocalPath)) {
    throw "Arquivo local nao encontrado: $LocalPath"
}

$plink = Get-PuttyTool -ExecutableName "plink.exe"
$pscp = Get-PuttyTool -ExecutableName "pscp.exe"

$localFullPath = (Resolve-Path $LocalPath).Path

if ($AutoCommit) {
    Write-Host "Criando commit automatico antes da publicacao..." -ForegroundColor Cyan
    Commit-FileIfNeeded -FullPath $localFullPath -Message $CommitMessage
}

$remoteDir = Get-RemoteDirectory -Path $RemotePath
$remoteFile = Get-RemoteFileName -Path $RemotePath
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"

$portalRoot = "/var/www/html/wkl/Portal/"
$relativeRemoteDir = $remoteDir
if ($remoteDir.StartsWith($portalRoot)) {
    $relativeRemoteDir = $remoteDir.Substring($portalRoot.Length).TrimStart('/')
}
else {
    $relativeRemoteDir = $remoteDir.TrimStart('/')
}

$backupDir = "$BackupRoot/$relativeRemoteDir"
$backupFile = "$backupDir/$timestamp" + "__" + $remoteFile

$quotedRemoteDir = Quote-Single -Value $remoteDir
$quotedRemotePath = Quote-Single -Value $RemotePath
$quotedBackupDir = Quote-Single -Value $backupDir
$quotedBackupFile = Quote-Single -Value $backupFile

$remoteCommand = @"
mkdir -p $quotedRemoteDir $quotedBackupDir
if [ -f $quotedRemotePath ]; then cp $quotedRemotePath $quotedBackupFile; fi
"@

Write-Host "Criando backup remoto antes da publicacao..." -ForegroundColor Cyan
& $plink -ssh $Server -pw $Password $remoteCommand
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao criar backup remoto de '$RemotePath'."
}

Write-Host "Enviando arquivo para o servidor..." -ForegroundColor Cyan
& $pscp -pw $Password $localFullPath "$Server`:$RemotePath"
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao publicar '$localFullPath' em '$RemotePath'."
}

if ($RestartPortal) {
    Write-Host "Reiniciando portal..." -ForegroundColor Cyan
    & $plink -ssh $Server -pw $Password "pm2 restart portal"
    if ($LASTEXITCODE -ne 0) {
        throw "Arquivo publicado, mas houve falha ao reiniciar o portal."
    }
}

Write-Host "Publicado com backup: $backupFile" -ForegroundColor Green
