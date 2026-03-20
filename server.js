const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

let sock = null;
let currentQR = null;
let isConnected = false;

app.get('/', (req, res) => {
    res.send('🤖 Servidor TRBot IA está Online (Versão Estável)!');
});

async function startWhatsApp(phoneNumber = null, res = null) {
    // 1. Limpa ligações antigas da memória
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.ws.close(); } catch (e) {}
        sock = null;
    }

    // 2. Apaga ficheiros de sessão corrompidos
    if (fs.existsSync('auth_info_baileys')) {
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
    }

    currentQR = null;
    isConnected = false;

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    // 3. Inicia a ligação de forma segura e estável
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        // Assinatura de navegador simples e compatível
        browser: ["Windows", "Chrome", "110.0.5481.192"],
        // Evita o travamento na tela "Conectando..." do telemóvel
        markOnlineOnConnect: false, 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;
        
        if (qr) {
            try { currentQR = await QRCode.toDataURL(qr); } catch (err) {}
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            console.log('Ligação fechada. Aguardando nova tentativa...');
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ Conexão estabelecida com sucesso!');
        }
    });

    // 4. Gera o código de emparelhamento se o número for fornecido
    if (phoneNumber) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                if (res && !res.headersSent) res.json({ code: formattedCode });
            } catch (err) {
                console.error(err);
                if (res && !res.headersSent) res.status(500).json({ error: 'Erro ao pedir código à Meta. Tente com ou sem o 9.' });
            }
        }, 3000); 
    } else {
        if (res && !res.headersSent) res.json({ message: 'A iniciar gerador de QR...' });
    }
}

// --- ROTAS ---
app.post('/api/pair-code', async (req, res) => {
    const phoneNumber = req.body.phone;
    if (!phoneNumber) return res.status(400).json({ error: 'Número obrigatório.' });
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    await startWhatsApp(cleanNumber, res);
});

app.post('/api/start-qr', async (req, res) => {
    await startWhatsApp(null, res);
});

app.get('/api/qr', (req, res) => {
    if (currentQR) res.json({ qr: currentQR });
    else res.status(404).json({ error: 'A aguardar...' });
});

app.get('/api/status', (req, res) => {
    res.json({ connected: isConnected, hasQR: !!currentQR });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor a rodar na porta ${PORT}`));
