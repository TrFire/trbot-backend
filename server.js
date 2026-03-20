const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
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
    res.send('🤖 Servidor TRBot IA está Online (Otimizado para conexões rápidas)!');
});

async function startWhatsApp(phoneNumber = null, res = null) {
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
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Windows", "Chrome", "110.0.5481.192"], // Assinatura leve de Windows
        
        // --- AS TRÊS LINHAS MÁGICAS QUE RESOLVEM O TRAVAMENTO ---
        syncFullHistory: false, 
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        // --------------------------------------------------------
        
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            try { currentQR = await QRCode.toDataURL(qr); } catch (err) {}
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ WhatsApp conectado com sucesso e sem travamentos!');
        }
    });

    if (phoneNumber) {
        setTimeout(async () => {
            try {
                if (sock.authState.creds.registered) {
                    if (res && !res.headersSent) return res.status(400).json({ error: 'Dispositivo já associado.' });
                    return;
                }
                
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                if (res && !res.headersSent) res.json({ code: formattedCode });
            } catch (err) {
                if (res && !res.headersSent) res.status(500).json({ error: 'Erro ao gerar código.' });
            }
        }, 3000); 
    } else {
        if (res && !res.headersSent) res.json({ message: 'A iniciar gerador de QR Code...' });
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
    else res.status(404).json({ error: 'A aguardar QR Code...' });
});

app.get('/api/status', (req, res) => {
    res.json({ connected: isConnected, hasQR: !!currentQR });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor a rodar na porta ${PORT}`));
