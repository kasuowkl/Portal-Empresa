# Versionamento e Backup do Portal

Este projeto ja usa `Git` localmente. A forma mais segura de trabalhar daqui para frente e combinar:

- `Git` para historico e reversao local
- `branch` para mudancas maiores
- `backup automatico no servidor` antes de publicar arquivos

## Estrutura recomendada

- `master`
  Versao estavel e mais proxima do que esta publicado.
- `feature/*`
  Melhor para funcionalidades novas e mudancas maiores.
- `fix/*`
  Melhor para correcoes pontuais e urgentes.
- `_backups/` no servidor
  Guarda uma copia publicada antes de cada upload.

## Scripts disponiveis

### Criar branch de trabalho

```powershell
.\scripts\new-work-branch.ps1 -Name "agenda-contabil-relatorios"
```

Exemplo com outro tipo:

```powershell
.\scripts\new-work-branch.ps1 -Type fix -Name "editor-colagem-texto"
```

Exemplo publicando a branch no GitHub:

```powershell
.\scripts\new-work-branch.ps1 -Name "base-conhecimento-colagem" -Push
```

Observacoes:

- por seguranca, o script bloqueia criacao de branch se houver alteracoes locais pendentes
- se voce souber exatamente o que esta fazendo, pode usar `-AllowDirty`

### Publicar arquivo com backup automatico

```powershell
.\scripts\publish-with-backup.ps1 `
  -LocalPath "public/baseConhecimento/index.html" `
  -RemotePath "/var/www/html/wkl/Portal/public/baseConhecimento/index.html"
```

Exemplo com reinicio do Portal:

```powershell
.\scripts\publish-with-backup.ps1 `
  -LocalPath "routes/conhecimento.js" `
  -RemotePath "/var/www/html/wkl/Portal/routes/conhecimento.js" `
  -RestartPortal
```

O script faz:

1. cria a pasta de backup no servidor se nao existir
2. copia o arquivo remoto atual para `_backups/...`
3. envia a nova versao
4. opcionalmente reinicia o Portal

### Publicar varios arquivos de uma vez

Use um manifesto JSON:

```powershell
.\scripts\publish-many-with-backup.ps1 `
  -ManifestPath ".\scripts\publish-manifest.sample.json"
```

Com commit automatico do lote:

```powershell
.\scripts\publish-many-with-backup.ps1 `
  -ManifestPath ".\scripts\publish-manifest.sample.json" `
  -AutoCommit `
  -CommitMessage "ajuda: atualiza paginas de versionamento"
```

Exemplo de backup gerado:

```text
/var/www/html/wkl/Portal/_backups/public/baseConhecimento/2026-04-02_153000__index.html
```

### Restaurar um arquivo a partir do backup

```powershell
.\scripts\restore-from-backup.ps1 `
  -BackupPath "/var/www/html/wkl/Portal/_backups/public/baseConhecimento/2026-04-02_153000__index.html" `
  -TargetPath "/var/www/html/wkl/Portal/public/baseConhecimento/index.html" `
  -RestartPortal
```

### Instalar rotina agendada no servidor

```powershell
.\scripts\install-server-nightly-backup.ps1
```

Esse script:

1. envia `server-nightly-backup.sh` para o Ubuntu
2. envia `server-nightly-db-backup.js` para o Ubuntu
3. marca o shell script como executavel
4. instala dois `crontabs` diarios
5. grava log em `logs/nightly-backup.log` e `logs/nightly-db-backup.log`

## Fluxo recomendado

### 1. Antes de comecar uma alteracao maior

Crie uma branch:

```powershell
.\scripts\new-work-branch.ps1 -Name "agenda-contabil-notificacoes"
```

### 2. Durante o trabalho

Veja o estado atual:

```powershell
git status
```

Veja o que mudou:

```powershell
git diff
```

Faca commits pequenos e claros:

```powershell
git add public/baseConhecimento/index.html
git commit -m "baseConhecimento: corrige colagem de texto"
```

### 3. Antes de publicar no servidor

Publique sempre com backup:

```powershell
.\scripts\publish-with-backup.ps1 `
  -LocalPath "public/baseConhecimento/index.html" `
  -RemotePath "/var/www/html/wkl/Portal/public/baseConhecimento/index.html"
```

Se forem varios arquivos relacionados:

```powershell
.\scripts\publish-many-with-backup.ps1 `
  -ManifestPath ".\scripts\publish-manifest.sample.json"
```

## Como reverter

### Reverter localmente para um commit anterior

Ver historico:

```powershell
git log --oneline --decorate -n 15
```

Voltar um arquivo especifico:

```powershell
git checkout HEAD~1 -- public/baseConhecimento/index.html
```

### Restaurar do backup do servidor

Liste backups:

```bash
ls -R /var/www/html/wkl/Portal/_backups
```

Copie o backup de volta:

```powershell
.\scripts\restore-from-backup.ps1 `
  -BackupPath "/var/www/html/wkl/Portal/_backups/public/baseConhecimento/2026-04-02_153000__index.html" `
  -TargetPath "/var/www/html/wkl/Portal/public/baseConhecimento/index.html" `
  -RestartPortal
```

Backups noturnos do servidor ficam em:

```text
/var/www/html/wkl/Portal/_backups/nightly
```

Backups JSON do banco ficam em:

```text
/var/www/html/wkl/Portal/_backups/db-json
```

Pagina visual no Portal:

```text
/backups
```

## Recomendacao de uso comigo

Quando quiser maxima seguranca, me peca neste formato:

```text
crie uma branch nova para esta mudanca
faca backup no servidor antes de publicar
```

Assim eu sigo sempre o fluxo seguro.
