const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
    res.send('🤖 Servidor TRBot IA está Online (Versão Estável e Anti-Travamento)!');
});

async function startWhatsApp(phoneNumber = null, res = null) {
    // 1. Limpeza profunda para evitar o erro "Não foi possível conectar"
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.ws.close(); } catch (e) {}
        sock = null;
    }

    if (fs.existsSync('auth_info_baileys')) {
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
    }

    currentQR = null;
    isConnected = false;

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    // 2. A configuração que o fez chegar ao "Conectando", agora blindada
    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Windows", "Chrome", "120.0.0.0"], // Assinatura comprovada
        
        // 3. O SEGREDO PARA NÃO TRAVAR:
        syncFullHistory: false, 
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        // Esta linha impede que o servidor trave a tentar processar o seu histórico antigo
        getMessage: async () => { return { conversation: 'TRBot Inicialização' }; } 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;
        
        if (qr && !phoneNumber) {
            try { currentQR = await QRCode.toDataURL(qr); } catch (err) {}
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            console.log('Ligação fechada.');
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ WhatsApp conectado com sucesso e sem travamentos!');
        }
    });

    if (phoneNumber) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                if (res && !res.headersSent) res.json({ code: formattedCode });
            } catch (err) {
                console.error('Erro ao pedir código:', err);
                if (res && !res.headersSent) res.status(500).json({ error: 'Erro. Tente retirar ou colocar o 9º dígito.' });
            }
        }, 3000); 
    } else {
        if (res && !res.headersSent) res.json({ message: 'A preparar QR...' });
    }
}

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
