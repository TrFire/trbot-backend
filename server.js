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
    res.send('🤖 Servidor TRBot IA está Online (Versão Definitiva de Conexão)!');
});

async function startWhatsApp(phoneNumber = null, res = null) {
    // 1. Limpeza agressiva e segura de tentativas anteriores
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.ws.close(); } catch (e) {}
        sock = null;
    }

    try {
        if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
            console.log('Sessão limpa.');
        }
    } catch (e) {
        console.error('Erro ao limpar pasta de sessão:', e);
    }

    currentQR = null;
    isConnected = false;

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    // 2. Iniciar a ligação
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"], // A melhor assinatura para evitar bloqueios da Meta
        markOnlineOnConnect: false, // Previne o telemóvel de travar no "Conectando..."
        generateHighQualityLinkPreview: false,
        syncFullHistory: false // Mantém a memória do Render leve
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;
        
        // 3. SEGREDO: Só gera QR Code se o utilizador NÃO tiver pedido código numérico!
        if (qr && !phoneNumber) { 
            console.log('A receber QR Code da Meta...');
            try { currentQR = await QRCode.toDataURL(qr); } catch (err) {}
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            console.log('Ligação fechada. Motivo:', lastDisconnect?.error?.output?.statusCode);
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ Conexão estabelecida com sucesso!');
        }
    });

    // 4. Se o utilizador pediu Código Numérico
    if (phoneNumber) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`Código Numérico gerado: ${formattedCode}`);
                if (res && !res.headersSent) res.json({ code: formattedCode });
            } catch (err) {
                console.error('Erro ao gerar código:', err);
                if (res && !res.headersSent) res.status(500).json({ error: 'Erro. Tente colocar ou retirar o 9º dígito do seu número.' });
            }
        }, 2500); 
    } 
    // Se o utilizador pediu QR Code
    else {
        if (res && !res.headersSent) res.json({ message: 'A aguardar QR Code da Meta...' });
    }
}

// --- ROTAS DA API ---
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
