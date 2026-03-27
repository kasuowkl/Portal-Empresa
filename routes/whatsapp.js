const express = require('express');
const router = express.Router();
const verificarLogin = require('../middleware/verificarLogin');
const path = require('path');

const WA_PUBLIC = path.join(__dirname, '../whatsApp/public');

// ── Páginas ─────────────────────────────────────────────────
router.get('/whatsapp', verificarLogin, (req, res) => {
  res.sendFile(path.join(WA_PUBLIC, 'index.html'));
});

router.get('/whatsapp/admin', verificarLogin, (req, res) => {
  res.sendFile(path.join(WA_PUBLIC, 'admin.html'));
});

router.get('/whatsapp/aprovacoes', verificarLogin, (req, res) => {
  res.sendFile(path.join(WA_PUBLIC, 'aprovacoesWhatsApp.html'));
});

// ── Arquivos estáticos (CSS, JS, imagens) ───────────────────
router.use('/whatsapp', express.static(WA_PUBLIC));

module.exports = router;
