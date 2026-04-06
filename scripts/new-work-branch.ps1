param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [string]$Base = "master",

    [ValidateSet("feature", "fix", "chore", "hotfix")]
    [string]$Type = "feature",

    [switch]$AllowDirty,

    [switch]$Push
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

function Normalize-BranchName {
    param([string]$Value)

    $normalized = $Value.ToLowerInvariant().Trim()
    $normalized = $normalized -replace '[^a-z0-9]+', '-'
    $normalized = $normalized.Trim('-')

    if ([string]::IsNullOrWhiteSpace($normalized)) {
        throw "O nome informado gerou uma branch vazia. Use algo como 'base-conhecimento-colagem'."
    }

    return $normalized
}

function Get-GitStatusShort {
    $result = git status --porcelain
    Assert-Success -ExitCode $LASTEXITCODE -Message "Nao foi possivel consultar o estado do Git."
    return $result
}

$branchSuffix = Normalize-BranchName -Value $Name
$branchName = "$Type/$branchSuffix"

$dirtyEntries = Get-GitStatusShort
if ($dirtyEntries -and -not $AllowDirty) {
    throw "Ha alteracoes locais pendentes. Faca commit/stash antes ou rode novamente com -AllowDirty se quiser prosseguir mesmo assim."
}

Write-Host "Atualizando referencia local da base '$Base'..." -ForegroundColor Cyan
git fetch origin $Base
Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao buscar a base '$Base' no remoto."

Write-Host "Trocando para '$Base'..." -ForegroundColor Cyan
git checkout $Base
Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao trocar para a base '$Base'."

git show-ref --verify --quiet "refs/heads/$branchName"
if ($LASTEXITCODE -eq 0) {
    Write-Host "A branch '$branchName' ja existe. Trocando para ela..." -ForegroundColor Yellow
    git checkout $branchName
    Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao trocar para a branch existente '$branchName'."
}
else {
    Write-Host "Criando branch '$branchName'..." -ForegroundColor Cyan
    git checkout -b $branchName
    Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao criar a branch '$branchName'."
}

if ($Push) {
    Write-Host "Publicando branch no remoto..." -ForegroundColor Cyan
    git push -u origin $branchName
    Assert-Success -ExitCode $LASTEXITCODE -Message "Falha ao publicar a branch '$branchName'."
}

Write-Host "Branch pronta: $branchName" -ForegroundColor Green
