// 1. Instalar as dependências necessárias no seu computador/servidor:
// npm install express cors @whiskeysockets/baileys pino qrcode

const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const QRCode = require('qrcode'); // Biblioteca para gerar o QR Code

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

let sock = null;
let currentQR = null;
let isConnected = false;

// Rota de saúde para o Render e UptimeRobot
app.get('/', (req, res) => {
    res.send('🤖 Servidor TRBot IA está Online (Suporta QR Code e Código de Associação)!');
});

// Função centralizada para iniciar o WhatsApp Web (serve para ambos os métodos)
async function startWhatsApp(phoneNumber = null, res = null) {
    // Limpa conexões antigas
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.ws.close(); } catch (e) {}
        sock = null;
    }

    // Apaga sessão antiga para evitar conflitos com a Meta
    if (fs.existsSync('auth_info_baileys')) {
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        console.log('Sessão anterior apagada. Iniciando conexão limpa...');
    }

    currentQR = null;
    isConnected = false;

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    console.log(`A utilizar WhatsApp Web versão v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu('Chrome'), 
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
    });

    sock.ev.on('creds.update', saveCreds);

    // Escuta os eventos da conexão (QR Code ou Concluído)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('Novo QR Code recebido da Meta.');
            try {
                // Converte o texto do QR para uma imagem (Base64)
                currentQR = await QRCode.toDataURL(qr);
            } catch (err) {
                console.error('Erro ao gerar imagem QR:', err);
            }
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            console.log('Ligação fechada. Motivo:', lastDisconnect?.error?.output?.statusCode);
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ WhatsApp conectado com sucesso!');
        }
    });

    // MODO: Código de Emparelhamento Numérico
    if (phoneNumber) {
        setTimeout(async () => {
            try {
                if (sock.authState.creds.registered) {
                    if (res && !res.headersSent) return res.status(400).json({ error: 'Dispositivo já está associado.' });
                    return;
                }
                
                console.log(`A pedir código numérico para: ${phoneNumber}`);
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`Código gerado: ${formattedCode}`);
                if (res && !res.headersSent) res.json({ code: formattedCode });
            } catch (err) {
                console.error('Erro na Meta (Código Numérico):', err);
                if (res && !res.headersSent) res.status(500).json({ error: 'O WhatsApp rejeitou o código. Tente retirar ou colocar o 9º dígito.' });
            }
        }, 3000); 
    } 
    // MODO: QR Code
    else {
        if (res && !res.headersSent) {
            res.json({ message: 'A iniciar gerador de QR Code...' });
        }
    }
}

// --- ROTAS DA NOSSA API ---

// 1. Iniciar conexão via Código Numérico
app.post('/api/pair-code', async (req, res) => {
    const phoneNumber = req.body.phone;
    if (!phoneNumber) return res.status(400).json({ error: 'Número obrigatório.' });
    
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    await startWhatsApp(cleanNumber, res);
});

// 2. Iniciar conexão via QR Code
app.post('/api/start-qr', async (req, res) => {
    await startWhatsApp(null, res);
});

// 3. Buscar a imagem do QR Code
app.get('/api/qr', (req, res) => {
    if (currentQR) {
        res.json({ qr: currentQR });
    } else {
        res.status(404).json({ error: 'A aguardar QR Code da Meta...' });
    }
});

// 4. Verificar se a conexão foi concluída
app.get('/api/status', (req, res) => {
    res.json({ connected: isConnected, hasQR: !!currentQR });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor a rodar na porta ${PORT}`));
