param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

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

function Commit-FilesIfNeeded {
    param(
        [string[]]$Files,
        [string]$Message
    )

    $relativeFiles = @()
    foreach ($file in $Files) {
        $relativeFiles += Get-RelativeGitPath -FullPath $file
    }

    $status = git status --porcelain -- $relativeFiles
    Assert-Success -ExitCode $LASTEXITCODE -Message "Nao foi possivel consultar o status Git dos arquivos selecionados."

    if (-not $status) {
        Write-Host "Nenhuma alteracao pendente para commit automatico." -ForegroundColor Yellow
        return
    }

    git add -- $relativeFiles
    Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao adicionar arquivos ao stage."

    $finalMessage = $Message
    if ([string]::IsNullOrWhiteSpace($finalMessage)) {
        $finalMessage = "publish: atualiza lote de arquivos"
    }

    git commit -m $finalMessage
    Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao criar commit automatico do lote."
}

if (-not (Test-Path $ManifestPath)) {
    throw "Manifesto nao encontrado: $ManifestPath"
}

$manifestFullPath = (Resolve-Path $ManifestPath).Path
$manifest = Get-Content $manifestFullPath -Raw | ConvertFrom-Json

if (-not $manifest.items -or $manifest.items.Count -eq 0) {
    throw "O manifesto precisa conter ao menos um item em 'items'."
}

$scriptPath = Join-Path $PSScriptRoot "publish-with-backup.ps1"
if (-not (Test-Path $scriptPath)) {
    throw "Nao encontrei o script base de publicacao em '$scriptPath'."
}

$resolvedItems = @()
foreach ($item in $manifest.items) {
    if (-not $item.localPath -or -not $item.remotePath) {
        throw "Cada item do manifesto precisa ter 'localPath' e 'remotePath'."
    }

    $resolvedLocalPath = (Resolve-Path (Join-Path (Get-Location) $item.localPath)).Path
    $resolvedItems += [PSCustomObject]@{
        LocalPath  = $resolvedLocalPath
        RemotePath = [string]$item.remotePath
    }
}

if ($AutoCommit) {
    Write-Host "Criando commit automatico do lote antes da publicacao..." -ForegroundColor Cyan
    Commit-FilesIfNeeded -Files ($resolvedItems.LocalPath) -Message $CommitMessage
}

foreach ($item in $resolvedItems) {
    $args = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-LocalPath", $item.LocalPath,
        "-RemotePath", $item.RemotePath,
        "-Server", $Server,
        "-Password", $Password,
        "-BackupRoot", $BackupRoot
    )

    & powershell @args
    Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao publicar '$($item.LocalPath)'."
}

if ($RestartPortal) {
    $plink = Get-PuttyTool -ExecutableName "plink.exe"
    Write-Host "Reiniciando portal ao final da publicacao em lote..." -ForegroundColor Cyan
    & $plink -ssh $Server -pw $Password "pm2 restart portal"
    Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao reiniciar o portal apos a publicacao em lote."
}

Write-Host "Publicacao em lote concluida." -ForegroundColor Green
