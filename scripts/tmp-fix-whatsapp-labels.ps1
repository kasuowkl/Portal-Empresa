$path = 'public/fragmentos/whatsapp.html'
$content = Get-Content -Path $path -Raw

$content = $content.Replace(
@"
    { id: 'agenda', icon: 'fas fa-tasks', label: 'Ag. Tarefas', descricao: 'Ative os eventos e selecione os destinatarios clicando nos chips.', legenda: '<i class="fas fa-info-circle" style="color:#25d366"></i> <b>Atribuido para</b> = usuario responsavel pela tarefa Â· <b>Criado por</b> = usuario que criou a tarefa', secoes: [] },
"@,
@"
    { id: 'agenda', icon: 'fas fa-tasks', label: 'Ag. Tarefas', descricao: 'Ative os eventos e selecione os destinatarios clicando nos chips.', legenda: '<i class="fas fa-info-circle" style="color:#25d366"></i> <b>Atribuido para</b> = usuario responsavel pela tarefa - <b>Criado por</b> = usuario que criou a tarefa - <b>Compartilhados com edicao</b> = usuarios da lista com permissao de editar', secoes: [] },
"@
)

$content = $content.Replace(
@"
    { id: 'financeiro', icon: 'fas fa-wallet', label: 'Financeiro', descricao: 'Ative os eventos e selecione os destinatarios clicando nos chips.', legenda: '<i class="fas fa-info-circle" style="color:#25d366"></i> <b>Criado por</b> = usuario que lancou o item Ã‚Â· <b>Compartilhados com edicao</b> = usuarios da agenda com permissao de editar Ã‚Â· <b>Gestores do setor</b> = responsaveis do setor relacionado, quando houver', secoes: [] },
"@,
@"
    { id: 'financeiro', icon: 'fas fa-wallet', label: 'Financeiro', descricao: 'Ative os eventos e selecione os destinatarios clicando nos chips.', legenda: '<i class="fas fa-info-circle" style="color:#25d366"></i> <b>Criado por</b> = usuario que lancou o item - <b>Compartilhados com edicao</b> = usuarios da agenda com permissao de editar - <b>Gestores do setor</b> = responsaveis do setor relacionado, quando houver', secoes: [] },
"@
)

$content = $content.Replace(
@"
    { id: 'contabil', icon: 'fas fa-file-invoice-dollar', label: 'Ag. Contabil', descricao: 'Ative os eventos e selecione os destinatarios clicando nos chips.', legenda: '<i class="fas fa-info-circle" style="color:#25d366"></i> Estrutura pronta para configurar eventos da Agenda Contabil no mesmo padrao do Email.', secoes: [] },
"@,
@"
    { id: 'contabil', icon: 'fas fa-file-invoice-dollar', label: 'Ag. Contabil', descricao: 'Ative os eventos e selecione os destinatarios clicando nos chips.', legenda: '<i class="fas fa-info-circle" style="color:#25d366"></i> <b>Criado por</b> = usuario que cadastrou o item - <b>Compartilhados com edicao</b> = usuarios da agenda com permissao de editar - <b>Gestores do setor</b> = responsaveis do setor relacionado, quando houver', secoes: [] },
"@
)

$content = $content.Replace(
@"
    { id: 'contatos', icon: 'fas fa-address-book', label: 'Contatos', descricao: 'Ative os eventos e selecione os destinatarios clicando nos chips.', legenda: '<i class="fas fa-info-circle" style="color:#25d366"></i> Estrutura pronta para alertas da Agenda de Contatos.', secoes: [] },
"@,
@"
    { id: 'contatos', icon: 'fas fa-address-book', label: 'Contatos', descricao: 'Ative os eventos e selecione os destinatarios clicando nos chips.', legenda: '<i class="fas fa-info-circle" style="color:#25d366"></i> <b>Criado por</b> = usuario que cadastrou o contato - <b>Compartilhados com edicao</b> = usuarios da lista com permissao de editar - <b>Gestores do setor</b> = responsaveis do setor relacionado, quando houver', secoes: [] },
"@
)

Set-Content -Path $path -Value $content -Encoding UTF8
