import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import express from 'express';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import tls from 'tls';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpegStatic from 'ffmpeg-static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render Linux ortamında ffmpeg-static binary'sinin kurulu olduğundan emin ol
try {
  if (ffmpegStatic && !fs.existsSync(ffmpegStatic)) {
    execSync('node node_modules/ffmpeg-static/install.js', { cwd: __dirname });
  }
} catch (_) {}

const DATA_FILE = path.join(__dirname, 'bot_data.json');
const AUTH_DIR = path.join(__dirname, 'auth_info');
const AUTH_SEED_ARCHIVE = path.join(__dirname, 'auth_seed.tar.gz');

// Render bulut sunucusunda ilk açılışta kayıtlı WhatsApp oturumunu (auth_seed.tar.gz) otomatik çıkar
if (!fs.existsSync(path.join(AUTH_DIR, 'creds.json')) && fs.existsSync(AUTH_SEED_ARCHIVE)) {
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    execSync(`tar -xzf "${AUTH_SEED_ARCHIVE}" -C "${AUTH_DIR}"`);
    console.log('☁️ Render Bulut Oturumu (auth_seed.tar.gz) başarıyla yüklendi!');
  } catch (err) {
    console.error('Auth seed çıkarma hatası:', err.message);
  }
}

// Avelon Asistan Varsayılan Ayarları
const defaultData = {
  enabled: true,
  replyToKnownContacts: true,
  knownCooldownMinutes: 3, // Kayıtlı kişiye tekrar yazmak için bekleme süresi (Dakika)
  replyDelaySec: 2,
  maxStrangerMessages: 8,
  autoBlockOnMax: true,
  nextQueueNumber: 60, // Yalandan randevu başlangıç sırası (60. Sıra, 61. Sıra...)
  firstReplyText:
    "Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim.\n\nNumaranız Eren Bey'in özel rehberinde kayıtlı görünmüyor; siz kimsiniz? Lütfen kendinizi ve hangi konuda ulaşmak istediğinizi tanıtın, sizi görüşme sırasına alıp durumu hemen Eren Bey'e arz edeceğim.",
  secondReplyText:
    "Teşekkür ederim, kimlik bilgilerinizi ve notunuzu Eren Bey'e sundum 📝\n\n📅 Randevu & Görüşme Sıranız: {SIRA}. Sıradasınız (Kayıt Kodu: #AVL-{KOD})\n⏳ Eren Bey programındaki yoğunluğa göre sıranız geldiğinde size dönüş sağlayacaktır.\n\n🎼 Sıranızı beklerken dinlemeniz için Avelon Özel Kalem Bekleme Salonu müziğimiz (Türk Marşı):\nhttps://www.youtube.com/watch?v=quxTnEEETbo\n— Avelon | Eren Bey'in Yapay Zeka Sekreteri 🤖",
  blockWarningText:
    "🚨 Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim.\n\nSizin numaranızı ve profilinizi güvenlik sistemimizde araştırdım; veri tabanımızda *%80 DOLANDIRICI / ŞÜPHELİ NUMARA* olarak gözüküyorsunuz!\n\n🔒 Eren Bey'in güvenliği için iletişim talebiniz reddedilmiş ve numaranız Avelon tarafından *ENGELLENMİŞTİR*.",
  knownReplyText:
    "Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim. Eren Bey şu an yoğun olduğu için mesajınızı kendisine öncelikli olarak ilettim; en kısa zamanda size dönüş sağlayacaktır.",
  whoAreYouReplyText:
    "Ben Avelon 🤖 Yöneticimiz Eren Bey'in Yapay Zeka Özel Kalem ve Yönetici Sekreteriyim. Eren Bey'in yoğun iletişim trafiğini koordine etmek, gelen görüşme taleplerini kaydetmek ve randevu sırasını yönetmek üzere 7/24 görev yapıyorum. İletmek istediğiniz bir not varsa hemen Eren Bey'e arz edebilirim.",
  knownNumbers: {}, // { "905xxxxxxxxx": { name: "...", source: "...", lastAutoReplyAt: 0 } }
  strangerStages: {}, // { "key": { stage, jid, phone, pushName, queueNo, msgCount, blocked, firstMsg, introMsg, updatedAt } }
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      return {
        ...defaultData,
        ...raw,
        knownNumbers: raw.knownNumbers || {},
        strangerStages: raw.strangerStages || {},
      };
    }
  } catch (err) {
    console.error('Veri okuma hatası:', err.message);
  }
  return structuredClone(defaultData);
}

let stateData = loadData();

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(stateData, null, 2), 'utf-8');
  } catch (err) {
    console.error('Veri kaydetme hatası:', err.message);
  }
}

function cleanNumber(jid = '') {
  return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

// WhatsApp Multi-Device LID <-> Telefon Numarası Eşleştirme Tablosu
const lidToPhone = {};
const phoneToLid = {};

function syncAuthInfoContactsAndLids() {
  try {
    if (!fs.existsSync(AUTH_DIR)) return 0;
    const files = fs.readdirSync(AUTH_DIR);
    let newlyAdded = 0;

    // 1) lid-mapping dosyalarından SADECE LID <-> Telefon numarası çeviri sözlüğünü doldur
    for (const file of files) {
      if (file.startsWith('lid-mapping-') && file.endsWith('.json')) {
        const fullPath = path.join(AUTH_DIR, file);
        const rawVal = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        const keyPart = file.replace('lid-mapping-', '').replace('.json', '');

        if (keyPart.endsWith('_reverse')) {
          const lid = cleanNumber(keyPart.replace('_reverse', ''));
          const phone = cleanNumber(rawVal);
          if (lid && phone) {
            lidToPhone[lid] = phone;
            phoneToLid[phone] = lid;
          }
        } else {
          const phone = cleanNumber(keyPart);
          const lid = cleanNumber(rawVal);
          if (lid && phone) {
            lidToPhone[lid] = phone;
            phoneToLid[phone] = lid;
          }
        }
      }
    }

    // 2) SADECE tctoken (Telefon rehberinde ŞU AN aktif kayıtlı olan 80 kişi) listesini Kayıtlı Kişi yap!
    const removed = stateData.removedFromKnown || {};
    const tcIndexFile = path.join(AUTH_DIR, 'tctoken-__index.json');
    if (fs.existsSync(tcIndexFile)) {
      const idxRaw = JSON.parse(fs.readFileSync(tcIndexFile, 'utf-8'));
      if (idxRaw?.token?.data) {
        const lidList = JSON.parse(Buffer.from(idxRaw.token.data, 'base64').toString('utf-8'));
        for (const item of lidList) {
          const lid = cleanNumber(item);
          const phone = lidToPhone[lid] || lid;
          if (removed[phone] || removed[lid]) continue;
          if (phone && !stateData.knownNumbers[phone]) {
            stateData.knownNumbers[phone] = {
              name: 'Aktif Rehber Kişisi',
              lid,
              source: 'Telefon Rehberi',
              addedAt: new Date().toISOString(),
              lastAutoReplyAt: 0,
            };
            newlyAdded++;
          }
          if (lid && !stateData.knownNumbers[lid]) {
            stateData.knownNumbers[lid] = {
              name: 'Aktif Rehber Kişisi',
              phone,
              source: 'Telefon Rehberi',
              addedAt: new Date().toISOString(),
              lastAutoReplyAt: 0,
            };
          }
        }
      }
    }

    for (const file of files) {
      if (file.startsWith('tctoken-') && file !== 'tctoken-__index.json' && file.endsWith('.json')) {
        const lid = cleanNumber(file.replace('tctoken-', '').replace('.json', ''));
        const phone = lidToPhone[lid] || lid;
        if (removed[phone] || removed[lid]) continue;
        if (phone && !stateData.knownNumbers[phone]) {
          stateData.knownNumbers[phone] = {
            name: 'Aktif Rehber Kişisi',
            lid,
            source: 'Telefon Rehberi',
            addedAt: new Date().toISOString(),
            lastAutoReplyAt: 0,
          };
          newlyAdded++;
        }
        if (lid && !stateData.knownNumbers[lid]) {
          stateData.knownNumbers[lid] = {
            name: 'Aktif Rehber Kişisi',
            phone,
            source: 'Telefon Rehberi',
            addedAt: new Date().toISOString(),
            lastAutoReplyAt: 0,
          };
        }
      }
    }

    if (newlyAdded > 0) saveData();
    const uniquePhones = new Set();
    for (const k of Object.keys(stateData.knownNumbers)) {
      uniquePhones.add(lidToPhone[k] || k);
    }
    return uniquePhones.size;
  } catch (err) {
    console.error('LID/Rehber senkron hatası:', err.message);
    return 0;
  }
}

const initialSyncedCount = syncAuthInfoContactsAndLids();
console.log(`📒 Rehber & Geçmiş Sohbet Senkronu: ${initialSyncedCount} kişi eşleştirildi.`);

function isKnownPerson(idOrLid) {
  const clean = cleanNumber(idOrLid);
  if (!clean) return false;
  const mappedPhone = lidToPhone[clean];
  const mappedLid = phoneToLid[clean];
  const removed = stateData.removedFromKnown || {};
  if (removed[clean] || (mappedPhone && removed[mappedPhone]) || (mappedLid && removed[mappedLid])) {
    return false;
  }
  if (stateData.knownNumbers[clean]) return true;
  if (mappedPhone && stateData.knownNumbers[mappedPhone]) return true;
  if (mappedLid && stateData.knownNumbers[mappedLid]) return true;
  return false;
}

function getCanonicalKey(idOrLid) {
  const clean = cleanNumber(idOrLid);
  return lidToPhone[clean] || clean;
}

let sock = null;
let currentQRDataURL = null;
let currentPairingCode = null;
let connectionStatus = 'starting';
let connectedUser = null;
const botSentMsgIds = new Set();
const ownerActiveChats = {};
const SCAM_FALLBACK_IMG = path.join(__dirname, 'scam_alert_card.png');

stateData.appointments = stateData.appointments || {};
stateData.pendingOutreach = stateData.pendingOutreach || {};
stateData.currentMode = stateData.currentMode || 'normal';

function normalizeTRPhone(raw = '') {
  let clean = cleanNumber(raw);
  if (clean.startsWith('05') && clean.length === 11) clean = '9' + clean;
  else if (clean.startsWith('5') && clean.length === 10) clean = '90' + clean;
  return clean;
}

// Patron Eren'in telefonuna doğrudan NeYapsak / Expo Push üzerinden sesli bildirim gönderen köprü
const EREN_DEFAULT_PUSH_TOKENS = [
  'ExponentPushToken[RIZp5RGvse8KHjaRYgBJ7S]', // ttryu (Güncel Ana Telefon)
  'ExponentPushToken[6pGHA_K-3RBerF4ObJKmdg]', // ttryus
];
let cachedErenPushTokens = [...EREN_DEFAULT_PUSH_TOKENS];
let lastTokenRefreshAt = 0;

async function refreshErenPushTokens() {
  if (Date.now() - lastTokenRefreshAt < 5 * 60 * 1000) return cachedErenPushTokens;
  lastTokenRefreshAt = Date.now();
  try {
    const res = await fetch('https://jellyfish-app-oydmg.ondigitalocean.app/api/admin/users', {
      headers: { 'x-admin-key': 'neyapsak_admin_secret_key_2026_secure' },
    });
    const data = await res.json();
    const users = Array.isArray(data) ? data : data.users || [];
    const tokens = new Set(EREN_DEFAULT_PUSH_TOKENS);
    for (const u of users) {
      if (
        u.pushToken &&
        (u.username === 'ttryu' ||
          u.username === 'ttryus' ||
          u.email === 'tataryasineren@gmail.com' ||
          u.email === 'tatarerenyasin@gmail.com')
      ) {
        tokens.add(u.pushToken);
      }
    }
    cachedErenPushTokens = [...tokens];
  } catch (_) {}
  return cachedErenPushTokens;
}

async function sendDirectPhonePush(title, body, extraData = {}) {
  try {
    const tokens = await refreshErenPushTokens();
    const cleanBody = String(body || '')
      .replace(/\*/g, '')
      .replace(/_/g, '')
      .slice(0, 220);
    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      title: title || '🤖 Avelon Asistan',
      body: cleanBody || 'Yeni bildirim!',
      data: { source: 'avelon', ...extraData },
      channelId: 'default',
      priority: 'high',
      interruptionLevel: 'time-sensitive',
      badge: 1,
      _displayInForeground: true,
    }));
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error('Direct phone push hatası:', err.message);
  }
}

// Patron Eren'in kendi "Siz" (905525222988) sohbetine anlık sekreter raporu + Telefon Push Bildirimi gönderen fonksiyon
async function notifyOwnerSelfChat(reportText, pushTitle = '🤖 Avelon Asistan Bildirimi') {
  try {
    // 1) Her zaman telefona gerçek sesli Push Bildirimi gönder (WhatsApp "Siz" sohbeti sessiz kaldığı için)
    const firstLine =
      String(reportText || '')
        .split('\n')
        .map((l) => l.replace(/\*/g, '').trim())
        .find((l) => l.length > 0) || pushTitle;
    const restLines = String(reportText || '')
      .split('\n')
      .slice(1)
      .join(' ')
      .replace(/\*/g, '')
      .trim();
    sendDirectPhonePush(firstLine.slice(0, 65), restLines || firstLine).catch(() => {});

    // 2) WhatsApp "Siz" sohbetine mesajı yaz
    if (!sock || connectionStatus !== 'connected') return;
    const selfJid = '905525222988@s.whatsapp.net';
    const sent = await sock.sendMessage(selfJid, { text: reportText });
    if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
    // Bildirimlerin telefona düşmesini engellememek için botu 'unavailable' işaretle
    sock.sendPresenceUpdate('unavailable').catch(() => {});
  } catch (err) {
    console.error('Owner self-chat bildirim hatası:', err.message);
  }
}

// 📞 SAHTE ARAMA & TELEFON BULUCU SİREN SİSTEMİ (.telefon / .telfon)
let phoneFinderInterval = null;
let phoneFinderWave = 0;
let phoneFinderStartedAt = 0;

function stopFindMyPhoneSiren(notify = true) {
  if (phoneFinderInterval) {
    clearInterval(phoneFinderInterval);
    phoneFinderInterval = null;
  }
  phoneFinderWave = 0;
  if (notify && sock && connectionStatus === 'connected') {
    sock
      .sendMessage('905525222988@s.whatsapp.net', {
        text: '✅ *TELEFON BULUNDU!* 🔕\nSahte arama ve zil alarmı durduruldu cano.',
      })
      .then((s) => {
        if (s?.key?.id) botSentMsgIds.add(s.key.id);
      })
      .catch(() => {});
  }
}

async function triggerWhatsAppFakeCallPacket(targetJid = '905525222988@s.whatsapp.net') {
  if (!sock || connectionStatus !== 'connected') return;
  try {
    const callId = crypto.randomBytes(16).toString('hex').toUpperCase();
    await sock.query({
      tag: 'call',
      attrs: {
        to: targetJid,
        id: sock.generateMessageTag(),
      },
      content: [
        {
          tag: 'offer',
          attrs: {
            'call-id': callId,
            'call-creator': sock.user?.id || targetJid,
          },
          content: [
            { tag: 'audio', attrs: { enc: 'opus', rate: '16000' } },
            { tag: 'net', attrs: { medium: '3' } },
            { tag: 'capability', attrs: { ver: '1' }, content: Buffer.from([1, 4, 255, 131, 207, 4]) },
            { tag: 'encopt', attrs: { keygen: '2' } },
          ],
        },
      ],
    });
  } catch (_) {}
}

async function startFindMyPhoneSiren(sourceLabel = 'WhatsApp Komutu') {
  stopFindMyPhoneSiren(false);
  phoneFinderStartedAt = Date.now();
  phoneFinderWave = 1;

  // 0) Mac açıksa Google Cihazımı Bul (google.com/android/find) üzerinden telefonu SESSİZDE BİLE %100 SESLE çaldırmak için görev ekle!
  stateData.gemiTasks = stateData.gemiTasks || [];
  stateData.gemiTasks.push({
    id: 'GEMI-PHONE-' + Date.now(),
    prompt: '.telefon',
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  saveData();

  // 1) İlk anda WhatsApp Call Offer paketi + Sesli Siren + Push gönder
  triggerWhatsAppFakeCallPacket('905525222988@s.whatsapp.net').catch(() => {});
  sendDirectPhonePush(
    '📞 AVELON ARIYOR... (Gelen Arama #1)',
    '🔊 ZİL ÇALIYOR! Telefonun Burada Cano! (Durdurmak için .buldum yaz)',
    { type: 'fake_call', wave: 1 }
  ).catch(() => {});

  if (sock && connectionStatus === 'connected') {
    try {
      const sent = await sock.sendMessage('905525222988@s.whatsapp.net', {
        text:
          `📞 *SAHTE ARAMA & TELEFON BULUCU BAŞLATILDI!* 🚨🔊\n\n` +
          `📍 *Tetikleyen:* ${sourceLabel}\n` +
          `🔔 Telefonuna **30 saniye boyunca her 2.5 saniyede bir** kesintisiz sesli arama/push zili ve titreşim gönderiliyor!\n\n` +
          `🛑 *Durdurmak için:* Telefonu bulduğunda *.buldum* yazman yeterli!`,
      });
      if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
    } catch (_) {}

    sendVoiceNote(
      '905525222988@s.whatsapp.net',
      'Alo Eren Bey! Telefonunuz çalıyor! Telefonunuz burada, sesimi duyuyor musunuz? Eren Bey telefonunuz burada!'
    ).catch(() => {});
  }

  // 2) 12 Dalga (30 Saniye) Kesintisiz Zil & Sahte Arama Döngüsü
  phoneFinderInterval = setInterval(async () => {
    phoneFinderWave += 1;
    if (phoneFinderWave > 12) {
      stopFindMyPhoneSiren(false);
      return;
    }
    await sendDirectPhonePush(
      `📞 AVELON ARIYOR... (Çağrı #${phoneFinderWave}/12)`,
      `🔊🚨 TELEFONUN BURADA CANO! Ses ve Titreşim Sinyali #${phoneFinderWave} (Durdur: .buldum)`,
      { type: 'fake_call', wave: phoneFinderWave }
    );
    if (phoneFinderWave % 3 === 0 && sock && connectionStatus === 'connected') {
      triggerWhatsAppFakeCallPacket('905525222988@s.whatsapp.net').catch(() => {});
      sock
        .sendMessage('905525222988@s.whatsapp.net', {
          text: `🔊 *ZİL ÇALIYOR (#${phoneFinderWave}/12)* — 📞 *Avelon Sahte Arama Sinyali!* (Durdurmak için *.buldum* yaz)`,
        })
        .then((s) => {
          if (s?.key?.id) botSentMsgIds.add(s.key.id);
        })
        .catch(() => {});
    }
  }, 2500);
}

// 📧 7/24 ÖNEMLİ E-POSTA (GMAIL / IMAP) TAKİP VE WHATSAPP BİLDİRİM SİSTEMİ
const DEFAULT_MAIL_ACCOUNTS = [
  { email: 'tataryasineren@gmail.com', pass: 'ehtbpberbouurjtx', label: 'Yasin Eren Kişisel Gmail' },
  { email: 'neyyapsak@gmail.com', pass: 'vvmvxohmokoklqet', label: 'NeYapsak Resmi Mail' },
  { email: 'qrestaurantdestek@gmail.com', pass: 'hewppahaskfxessj', label: 'QRes Destek Mail' },
];
stateData.mailAccounts = DEFAULT_MAIL_ACCOUNTS;
stateData.lastSeenMailUid = stateData.lastSeenMailUid || {};

function decodeMimeWords(str = '') {
  if (!str) return '';
  return String(str)
    .replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
      try {
        let buf;
        if (enc.toUpperCase() === 'B') {
          buf = Buffer.from(text, 'base64');
        } else {
          const bytes = [];
          const qText = text.replace(/_/g, ' ');
          for (let i = 0; i < qText.length; i++) {
            if (qText[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(qText.slice(i + 1, i + 3))) {
              bytes.push(parseInt(qText.slice(i + 1, i + 3), 16));
              i += 2;
            } else {
              bytes.push(qText.charCodeAt(i));
            }
          }
          buf = Buffer.from(bytes);
        }
        const normCharset = String(charset || 'utf-8').toLowerCase();
        const decoderLabel =
          normCharset.includes('8859-9') || normCharset.includes('1254')
            ? 'windows-1254'
            : 'utf-8';
        return new TextDecoder(decoderLabel).decode(buf);
      } catch (e) {
        return text;
      }
    })
    .replace(/\r?\n\s+/g, ' ')
    .trim();
}

function fetchImapRecentEmails({ email, pass }, count = 5) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    const socket = tls.connect(993, 'imap.gmail.com', { servername: 'imap.gmail.com', timeout: 12000 });
    let bufStr = '';
    let step = 0;

    const timer = setTimeout(() => {
      try { socket.destroy(); } catch (_) {}
      done([]);
    }, 12000);

    socket.on('error', () => {
      clearTimeout(timer);
      done([]);
    });

    socket.on('data', (chunk) => {
      const s = chunk.toString('utf8');
      bufStr += s;

      if (step === 0 && bufStr.includes('* OK')) {
        step = 1;
        bufStr = '';
        socket.write(`A1 LOGIN "${email}" "${pass}"\r\n`);
      } else if (step === 1 && (bufStr.includes('A1 OK') || bufStr.includes('A1 NO') || bufStr.includes('A1 BAD'))) {
        if (!bufStr.includes('A1 OK')) {
          clearTimeout(timer);
          socket.end();
          return done([]);
        }
        step = 2;
        bufStr = '';
        socket.write('A2 SELECT INBOX\r\n');
      } else if (step === 2 && bufStr.includes('A2 OK')) {
        step = 3;
        const m = bufStr.match(/\* (\d+) EXISTS/);
        const total = m ? parseInt(m[1], 10) : 0;
        if (total <= 0) {
          clearTimeout(timer);
          socket.write('A4 LOGOUT\r\n');
          socket.end();
          return done([]);
        }
        const start = Math.max(1, total - count + 1);
        bufStr = '';
        socket.write(`A3 FETCH ${start}:${total} (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])\r\n`);
      } else if (step === 3 && (bufStr.includes('A3 OK') || bufStr.includes('A3 NO') || bufStr.includes('A3 BAD'))) {
        clearTimeout(timer);
        const rawBlock = bufStr;
        socket.write('A4 LOGOUT\r\n');
        socket.end();

        const items = [];
        const parts = rawBlock.split(/\* \d+ FETCH \(/).slice(1);
        for (const p of parts) {
          const uidMatch = p.match(/UID (\d+)/);
          const fromMatch = p.match(/^From:\s*(.+)$/im);
          const subjMatch = p.match(/^Subject:\s*(.+)$/im);
          const dateMatch = p.match(/^Date:\s*(.+)$/im);
          if (uidMatch) {
            items.push({
              uid: parseInt(uidMatch[1], 10),
              from: decodeMimeWords(fromMatch ? fromMatch[1] : 'Bilinmeyen Gönderen'),
              subject: decodeMimeWords(subjMatch ? subjMatch[1] : '(Konu Yok)'),
              date: (dateMatch ? dateMatch[1] : '').trim(),
            });
          }
        }
        done(items);
      }
    });
  });
}

function isImportantEmail({ from, subject }) {
  const combined = `${from} ${subject}`.toLocaleLowerCase('tr-TR');
  // Önemsiz bülten/reklam filtreleri
  if (
    combined.includes('insideapple.apple.com') ||
    combined.includes('unsubscribe') ||
    combined.includes('newsletter')
  ) {
    return false;
  }
  const importantKeywords = [
    'app store',
    'testflight',
    'apple developer',
    'review',
    'submission',
    'guideline',
    'google play',
    'tübitak',
    'tubitak',
    'teydeb',
    'btm',
    'garanti',
    'bbva',
    'lonca',
    'workup',
    'itü çekirdek',
    'itu cekirdek',
    'yatırım',
    'hibe',
    'başvuru',
    'basvuru',
    'mülakat',
    'mulakat',
    'onay',
    'verify',
    'verification',
    'doğrulama',
    'dogrulama',
    'security',
    'güvenlik',
    'fatura',
    'invoice',
    'payment',
    'ödeme',
    'suspended',
    'failed',
    'critical',
    'important',
    'acil',
    'render',
    'digitalocean',
    'mongodb',
    'firebase',
    'qres',
    'neyapsak',
  ];
  return importantKeywords.some((kw) => combined.includes(kw));
}

async function pollAllMailAccounts(forceReportAll = false) {
  const accounts = stateData.mailAccounts || DEFAULT_MAIL_ACCOUNTS;
  const summaryLines = [];

  for (const acc of accounts) {
    try {
      const emails = await fetchImapRecentEmails(acc, 5);
      if (!emails.length) continue;

      const maxUid = Math.max(...emails.map((e) => e.uid));
      const prevUid = stateData.lastSeenMailUid[acc.email];

      if (forceReportAll) {
        const latestList = emails
          .slice(-4)
          .reverse()
          .map(
            (e, idx) =>
              `  ${idx + 1}. *${e.subject}*\n     👤 ${e.from.replace(/<[^>]+>/g, '').trim()}`
          )
          .join('\n');
        summaryLines.push(`📬 *${acc.label || acc.email}:*\n${latestList}`);
      }

      if (prevUid === undefined) {
        // İlk çalışmada mevcut son UID'yi kaydet
        stateData.lastSeenMailUid[acc.email] = maxUid;
        saveData();
        continue;
      }

      const newEmails = emails.filter((e) => e.uid > prevUid);
      if (newEmails.length > 0) {
        stateData.lastSeenMailUid[acc.email] = maxUid;
        saveData();

        for (const mail of newEmails) {
          const important = isImportantEmail(mail);
          const badge = important ? '🚨 *ÖNEMLİ E-POSTA GELDİ!*' : '📧 *YENİ E-POSTA GELDİ!*';
          const cleanSender = mail.from.replace(/<[^>]+>/g, '').trim() || mail.from;
          const mailReport =
            `${badge}\n\n` +
            `📥 *Hesap:* ${acc.email}\n` +
            `👤 *Gönderen:* ${ mail.from }\n` +
            `📌 *Konu:* *${mail.subject}*\n` +
            `🕒 *Tarih:* ${mail.date}`;

          await notifyOwnerSelfChat(mailReport, `📧 Mail: ${mail.subject}`);
          if (important) {
            await sendVoiceNote(
              '905525222988@s.whatsapp.net',
              `Eren Bey, ${acc.label || acc.email} adresinize ${cleanSender} tarafından önemli bir e-posta geldi. Konusu: ${mail.subject}`
            );
          }
        }
      }
    } catch (e) {
      console.error(`Mail kontrol hatası (${acc.email}):`, e.message);
    }
  }

  return summaryLines;
}

// Her 90 saniyede bir mailleri otomatik kontrol et
setInterval(() => {
  pollAllMailAccounts(false).catch(() => {});
}, 90 * 1000);
setTimeout(() => {
  pollAllMailAccounts(false).catch(() => {});
}, 8000);

// Avelon Ses Profilleri (Microsoft Azure Neural HD Stüdyo Sesleri)
const VOICE_PROFILES = {
  emel: {
    id: 'tr-TR-EmelNeural',
    label: 'Emel HD (Kadın Yönetici Sekreter — Doğal & Kibar)',
    rate: '+5%',
    pitch: '+0Hz',
  },
  ahmet: {
    id: 'tr-TR-AhmetNeural',
    label: 'Ahmet HD (Erkek Yönetici Asistan — Karizmatik & Kurumsal)',
    rate: '+4%',
    pitch: '-1Hz',
  },
  ava: {
    id: 'en-US-AvaMultilingualNeural',
    label: 'Ava Dragon HD (Uluslararası Multilingual Kadın Asistan)',
    rate: '+3%',
    pitch: '+0Hz',
  },
};

stateData.voiceProfile = stateData.voiceProfile || 'emel';

// Tekrar kullanılabilir Stüdyo Kalitesinde Neural HD MP3 Üretici (WhatsApp Sesli Not + Canlı Telefon Jarvis Hoparlörü için)
async function generateNeuralMp3Buffer(spokenText, overrideVoiceKey = null) {
  if (!spokenText) return null;
  const cleanSpeech = String(spokenText)
    .replace(/[*_~`#]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\bBTM\b/g, 'B T M')
    .replace(/\bİTO\b/g, 'İ T O')
    .replace(/#AVL-/gi, 'Avelon ')
    .replace(/\s+/g, ' ')
    .trim();

  const selectedKey = overrideVoiceKey || stateData.voiceProfile || 'emel';
  const profile = VOICE_PROFILES[selectedKey] || VOICE_PROFILES.emel;

  let fullMp3 = null;
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(profile.id, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(cleanSpeech, {
      rate: profile.rate,
      pitch: profile.pitch,
    });
    const chunks = [];
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Neural TTS timeout')), 12000);
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', () => {
        clearTimeout(timeout);
        resolve();
      });
      audioStream.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    try { tts.close(); } catch (_) {}
    if (chunks.length > 0) {
      fullMp3 = Buffer.concat(chunks);
    }
  } catch (neuralErr) {
    console.error('Neural HD TTS yedek motora geçiyor:', neuralErr.message);
  }

  if (!fullMp3 || fullMp3.length < 500) {
    const words = cleanSpeech.split(' ');
    const chunks = [];
    let current = '';
    for (const w of words) {
      if ((current + ' ' + w).trim().length > 165) {
        if (current.trim()) chunks.push(current.trim());
        current = w;
      } else {
        current = (current + ' ' + w).trim();
      }
    }
    if (current.trim()) chunks.push(current.trim());

    const mp3Buffers = [];
    for (const chunk of chunks) {
      const ttsUrl =
        'https://translate.google.com/translate_tts?ie=UTF-8&tl=tr&client=tw-ob&q=' +
        encodeURIComponent(chunk);
      const res = await fetch(ttsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      });
      if (res.ok) {
        mp3Buffers.push(Buffer.from(await res.arrayBuffer()));
      }
    }
    if (mp3Buffers.length > 0) {
      fullMp3 = Buffer.concat(mp3Buffers);
    }
  }

  return { fullMp3, profile };
}

// 🧠 AVELON JARVIS YAPAY ZEKA BEYNİ — TAM YETKİ (QRes, NeYapsak, WhatsApp, Mail, Mac Kontrolü & Hafızalı Sohbet)
const jarvisMemory = [];

async function askJarvisBrain(rawInput) {
  const text = String(rawInput || '').trim();
  const low = text.toLocaleLowerCase('tr-TR').replace(/[?!.,]/g, '').trim();

  // 0) Kendi sesini yankı olarak duyduysa YOKSAY
  if (
    low.includes('efendim patron') ||
    low.includes('sizi dinliyorum') ||
    low.includes('emredersiniz patron') ||
    low.includes('emriniz nedir') ||
    low.includes('tatar endüstri komuta')
  ) {
    return { spoken: '', display: '', ignore: true };
  }

  // 1) Sadece "Avelon" / "Hey Avelon" / "Alo Avelon" / "Orada mısın" seslenişi
  if (
    low === 'avelon' ||
    low === 'avalon' ||
    low === 'abalone' ||
    low === 'apollon' ||
    low === 'hey avelon' ||
    low === 'hey avalon' ||
    low === 'alo avelon' ||
    low === 'avelon orada mısın' ||
    low === 'orada mısın' ||
    low === 'jarvis' ||
    low === 'hey jarvis' ||
    low === 'alo'
  ) {
    return {
      spoken: 'Efendim Patron! Sizi dinliyorum, tam yetkiyle emrinizdeyim.',
      display: '⚡ *EFENDİM PATRON!* 👑\n\nSizi dinliyorum, tam yetkiyle emrinizdeyim.',
    };
  }

  // Başında "avelon " veya "hey avelon " varsa temizleyip komuta bak
  const cleanCmd = low.replace(/^(?:hey\s+|alo\s+)?(?:avelon|avalon|abalone|apollon|jarvis)\s+/i, '').trim();

  // 2) Telefon Bulucu & Siren
  if (
    cleanCmd.includes('telefonumu bul') ||
    cleanCmd.includes('telefonu çaldır') ||
    cleanCmd.includes('telefon nerede') ||
    cleanCmd.includes('telefonumu çaldır')
  ) {
    startFindMyPhoneSiren('Avelon Jarvis Sesli Komut').catch(() => {});
    stateData.gemiTasks = stateData.gemiTasks || [];
    stateData.gemiTasks.push({
      id: 'GEMI-JARVIS-' + Date.now(),
      prompt: 'telefonumu bul',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    saveData();
    return {
      spoken: 'Emredersiniz Patron! Telefonunuzu hem Google Cihazımı Bul üzerinden hem de WhatsApp sireniyle tam ses çaldırıyorum.',
      display: '📞 *TELEFON BULUCU SİREN BAŞLATILDI PATRON!* 🚨',
    };
  }

  // 3) WhatsApp Oto-Sekreter Aç / Kapat & Son Mesajları Oku (TAM YETKİ)
  if (cleanCmd.includes('sekreteri kapat') || cleanCmd.includes('oto yanıtı kapat') || cleanCmd.includes('botu sustur')) {
    stateData.autoReplyEnabled = false;
    saveData();
    return {
      spoken: 'Emredersiniz Patron, WhatsApp yapay zeka sekreterini devre dışı bıraktım.',
      display: '🔕 *WHATSAPP OTO-SEKRETER KAPATILDI PATRON!*',
    };
  }
  if (cleanCmd.includes('sekreteri aç') || cleanCmd.includes('oto yanıtı aç') || cleanCmd.includes('botu başlat')) {
    stateData.autoReplyEnabled = true;
    saveData();
    return {
      spoken: 'Emredersiniz Patron, WhatsApp yapay zeka sekreterini tam yetkiyle aktif ettim.',
      display: '🟢 *WHATSAPP OTO-SEKRETER AKTİF EDİLDİ PATRON!*',
    };
  }
  if (
    cleanCmd.includes('son mesaj') ||
    cleanCmd.includes('kim yazmış') ||
    cleanCmd.includes('whatsapp mesaj') ||
    cleanCmd.includes('gelen mesaj')
  ) {
    const convs = Object.values(stateData.conversations || {})
      .sort((a, b) => new Date(b.lastTimestamp || 0) - new Date(a.lastTimestamp || 0))
      .slice(0, 4);
    if (convs.length === 0) {
      return {
        spoken: 'Efendim Patron, şu an WhatsApp üzerinde kayıtlı yeni bir müşteri veya kişi mesajı görünmüyor.',
        display: '📭 Kayıtlı yeni WhatsApp mesajı bulunamadı.',
      };
    }
    const spokenParts = convs.map((c) => `${c.name || c.phone}: ${c.lastMessage || 'mesaj yok'}`);
    const displayParts = convs.map((c) => `• *${c.name || c.phone}:* "${c.lastMessage || ''}"`);
    return {
      spoken: `Efendim Patron, WhatsApp'ta son yazan kişiler şunlar: ${spokenParts.join('. ')}`,
      display: `💬 *SON WHATSAPP MESAJLARI:*\n\n${displayParts.join('\n')}`,
    };
  }

  // 4) Mail Kontrolü (Sesli İçerik Okuma ile)
  if (cleanCmd.includes('mail') || cleanCmd.includes('eposta') || cleanCmd.includes('e-posta')) {
    const summaries = await pollAllMailAccounts(true).catch(() => []);
    if (summaries && summaries.length > 0) {
      const plainSummary = summaries
        .join(' ')
        .replace(/[*_`~•📧📨👤📝🕒]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 360);
      return {
        spoken: `Efendim Patron, bağlı üç e-posta hesabınızı kontrol ettim. Özeti şöyle: ${plainSummary}`,
        display: `📧 *AVELON E-POSTA ÖZETİ*\n\n${summaries.join('\n\n')}`,
      };
    }
    return {
      spoken: 'Efendim Patron, üç e-posta kutunuzu da kontrol ettim, şu an yeni bir ileti görünmüyor.',
      display: '📭 Bağlı e-posta kutularında yeni ileti bulunamadı.',
    };
  }

  // 5) QRes Restoran Aç / Kapat & Detaylı Durum (TAM YETKİ: Tantavi, Muamma, 2artı2, Sistem)
  const isTantavi = cleanCmd.includes('tantav') || cleanCmd.includes('tanatav') || /\btan\b/.test(cleanCmd);
  const isMuamma = cleanCmd.includes('muamma');
  const is2Arti2 = cleanCmd.includes('2art') || cleanCmd.includes('iki art');
  const isQresOrAdmin =
    isTantavi ||
    isMuamma ||
    is2Arti2 ||
    cleanCmd.includes('admin') ||
    cleanCmd.includes('sistem durumu') ||
    cleanCmd.includes('sistem raporu') ||
    cleanCmd.includes('kaç kullanıcı') ||
    cleanCmd.includes('qres') ||
    cleanCmd.includes('ciro') ||
    cleanCmd.includes('restoran');

  if (isQresOrAdmin) {
    try {
      const NEYAPSAK_API = 'https://jellyfish-app-oydmg.ondigitalocean.app/api/admin';
      const NEYAPSAK_KEY = 'neyapsak_admin_secret_key_2026_secure';
      const QRES_API = 'https://web-production-b7541.up.railway.app/api/super';
      const QRES_KEY = 'neyapsak_super_admin_secret';

      if (isTantavi || isMuamma || is2Arti2) {
        const restRes = await fetch(`${QRES_API}/restaurants`, { headers: { 'x-admin-secret': QRES_KEY } });
        const restaurants = (await restRes.json()).data || [];
        const matched = restaurants.find((r) => {
          const n = String(r.name || '').toLocaleLowerCase('tr-TR');
          if (isTantavi && n.includes('tantav')) return true;
          if (isMuamma && n.includes('muamma')) return true;
          if (is2Arti2 && (n.includes('2art') || n.includes('2 art'))) return true;
          return false;
        });

        if (matched) {
          const wantsClose = cleanCmd.includes('kapat') || cleanCmd.includes('durdur') || cleanCmd.includes('iptal');
          const wantsOpen = cleanCmd.includes('aç') || cleanCmd.includes('ac') || cleanCmd.includes('aktif');

          if (wantsClose || wantsOpen) {
            const desiredState = wantsOpen ? true : false;
            if (Boolean(matched.isActive) !== desiredState) {
              await fetch(`${QRES_API}/restaurants/${matched._id}/toggle`, {
                method: 'PATCH',
                headers: { 'x-admin-secret': QRES_KEY },
              });
            }
            const stateWord = desiredState ? 'AKTİF (AÇIK)' : 'HİZMET DIŞI (KAPALI)';
            return {
              spoken: `Emredersiniz Patron! ${matched.name} işletmesinin QR menü sistemini şu an ${desiredState ? 'aktif hale getirdim' : 'kapattım'}.`,
              display: `🍽️ *QRES TAM YETKİ İŞLEMİ:*\n*${matched.name}* durumu *${stateWord}* olarak güncellendi!`,
            };
          }

          const detRes = await fetch(`${QRES_API}/restaurants/${matched._id}/details`, {
            headers: { 'x-admin-secret': QRES_KEY },
          });
          const det = (await detRes.json()).data || {};
          const restObj = det.restaurant || matched;
          const totalScans = restObj.totalQrScans ?? matched.totalQrScans ?? 0;
          const totalRev = det.totalRevenue ?? matched.totalRevenue ?? 0;
          const statusStr = restObj.isActive ? 'Açık' : 'Kapalı';
          return {
            spoken: `Efendim Patron, ${restObj.name} şu an ${statusStr} durumda. Toplam ${totalScans} kişi QR menüyü okutmuş ve ${totalRev} lira ciro gerçekleşmiş.`,
            display:
              `🍽️ *${restObj.name.toUpperCase()} — CANLI RAPOR*\n\n` +
              `📡 *Durum:* ${statusStr}\n` +
              `📲 *Toplam QR Okutma:* ${totalScans.toLocaleString('tr-TR')} Kişi\n` +
              `💰 *Toplam Ciro:* ${totalRev.toLocaleString('tr-TR')} ₺`,
          };
        }
      }

      const [nyRes, qresStatsRes] = await Promise.all([
        fetch(`${NEYAPSAK_API}/dashboard-data`, { headers: { 'x-admin-key': NEYAPSAK_KEY } }),
        fetch(`${QRES_API}/stats`, { headers: { 'x-admin-secret': QRES_KEY } }),
      ]);
      const ny = await nyRes.json().catch(() => ({}));
      const qStats = (await qresStatsRes.json().catch(() => ({}))).data || {};
      return {
        spoken: `Efendim Patron, Tatar Endüstri komuta merkezinde şu an Ne Yapsak uygulamasında ${ny.users || 0} kayıtlı kullanıcı var. QRes sisteminde ise toplam ${qStats.totalQrScans || 0} QR okutma ve ${qStats.totalRevenue || 0} lira ciro bulunuyor.`,
        display:
          `🏭 *TATAR ENDÜSTRİ — CANLI RAPOR* ⚡\n\n` +
          `📱 *NeYapsak:* ${ny.users || 0} Kullanıcı | ${ny.weeklyActive || 0} Aktif\n` +
          `🍽️ *QRes:* ${(qStats.totalQrScans || 0).toLocaleString('tr-TR')} QR Okutma | ${(qStats.totalRevenue || 0).toLocaleString('tr-TR')} ₺ Ciro`,
      };
    } catch (_) {}
  }

  // 6) Mac Bilgisayar Tam Yetki Komutları (Uygulama aç/kapat, YouTube, Ses, Ekran, Pil, Screenshot, Web)
  if (
    cleanCmd.includes('bilgisayar') ||
    cleanCmd.includes('ekran') ||
    cleanCmd.includes('pc ') ||
    cleanCmd.includes('uyku') ||
    cleanCmd.includes('sesi ') ||
    cleanCmd.includes('ses ') ||
    cleanCmd.includes('youtube') ||
    cleanCmd.includes('şarkı') ||
    cleanCmd.includes('müzik') ||
    cleanCmd.includes('uygulama') ||
    cleanCmd.includes('chrome') ||
    cleanCmd.includes('spotify') ||
    cleanCmd.includes('xcode') ||
    cleanCmd.includes('terminal') ||
    cleanCmd.includes('btm panel') ||
    cleanCmd.includes('app store') ||
    cleanCmd.includes('google\'da') ||
    cleanCmd.includes('googleda') ||
    cleanCmd.includes('şarj') ||
    cleanCmd.includes('pil ') ||
    cleanCmd.includes('masaüstü')
  ) {
    stateData.gemiTasks = stateData.gemiTasks || [];
    stateData.gemiTasks.push({
      id: 'GEMI-JARVIS-' + Date.now(),
      prompt: cleanCmd,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    saveData();
    return {
      spoken: `Emredersiniz Patron! Mac bilgisayarınızda "${cleanCmd}" işlemini hemen gerçekleştiriyorum.`,
      display: `💻 *MAC TAM YETKİ KOMUTU İLETİLDİ:* "${cleanCmd}" ⚡`,
    };
  }

  // 7) Hafızalı Yapay Zeka Jarvis Sohbeti (Google Gemini 2.5 Flash Ultra-Hızlı Beyin + Yedek)
  try {
    const sysPrompt =
      'Sen Yasin Eren Tatar\'ın (Patron Eren) özel yapay zeka sağ kolu, başmühendisi ve her şeyi bilen sesli asistanı Avelon\'sun (Tony Stark\'ın Jarvis\'i gibi). ' +
      'Sana gündelik hayattan bilgi, bilim, tarih, genel kültür, tavsiye, matematik, yazılım veya sohbet sorulduğunda doğrudan, çok ilginç, doğru ve doyurucu bilgi ver. ' +
      'Eren 20 yaşında çok yetenekli bir kurucu; NeYapsak, QRes ve MezatPazarı projelerini tek başına kurdu ve İTO BTM\'ye kabul edildi. ' +
      'Ona "Efendim Patron" veya "Patron" diye hitap et. Cevapların çok akıcı, zeki, Türkçe (2-3 cümle) ve sesli okunmaya uygun olsun. Asla yıldız veya emoji kullanma.';

    jarvisMemory.push({ role: 'user', content: text });
    if (jarvisMemory.length > 10) jarvisMemory.splice(0, jarvisMemory.length - 10);

    const gemKey =
      process.env.GEMINI_API_KEY ||
      Buffer.from('QUl6YVN5QXlRaGlwMjNhcFZLSF9fV0dVU1FZME1kaDNqSFNDS2ZR', 'base64').toString('utf8');

    const gemContents = jarvisMemory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    for (const modelName of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
      try {
        const gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${gemKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: sysPrompt }] },
              contents: gemContents,
              generationConfig: {
                temperature: 0.7,
                thinkingConfig: { thinkingBudget: 0 },
              },
            }),
          }
        );
        if (gRes.ok) {
          const gJson = await gRes.json();
          let reply = (gJson.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          reply = reply.replace(/[*_#`~]/g, '').trim();
          if (reply && reply.length > 2) {
            jarvisMemory.push({ role: 'assistant', content: reply });
            return {
              spoken: reply,
              display: `🤖 *AVELON JARVIS:*\n${reply}`,
            };
          }
        }
      } catch (_) {}
    }

    const aiRes = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'system', content: sysPrompt }, ...jarvisMemory],
        model: 'openai',
      }),
    });
    if (aiRes.ok) {
      let reply = (await aiRes.text()).trim();
      reply = reply.replace(/[*_#`~]/g, '').trim();
      if (reply && reply.length > 2) {
        jarvisMemory.push({ role: 'assistant', content: reply });
        return {
          spoken: reply,
          display: `🤖 *AVELON JARVIS:*\n${reply}`,
        };
      }
    }
  } catch (e) {
    console.error('Jarvis AI error:', e.message);
  }

  return {
    spoken: 'Efendim Patron, sizi dinliyorum. Tam yetkiyle emrinizdeyim.',
    display: '🤖 *AVELON JARVIS:* Efendim Patron, sizi dinliyorum. Tam yetkiyle emrinizdeyim.',
  };
}

// Türkçe Yapay Zeka Sekreter Sesli Mesajı (🎤 Mavi Mikrofon / PTT - Neural HD Stüdyo Sesi)
async function sendVoiceNote(targetJid, spokenText, overrideVoiceKey = null) {
  if (!sock || !spokenText) return null;
  try {
    await sock.sendPresenceUpdate('recording', targetJid);
    const { fullMp3, profile } = (await generateNeuralMp3Buffer(spokenText, overrideVoiceKey)) || {};

    if (!fullMp3 || fullMp3.length === 0) {
      await sock.sendPresenceUpdate('paused', targetJid);
      return null;
    }

    let finalAudio = fullMp3;
    let finalMime = 'audio/mp4';

    // ffmpeg-static veya sistem ffmpeg ile 48kHz Kristal Netliğinde WhatsApp Opus Sesli Notuna (🎤) çevir
    const ffmpegBin = ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : 'ffmpeg';
    const randId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const tmpIn = path.join('/tmp', `avl_tts_${randId}.mp3`);
    const tmpOut = path.join('/tmp', `avl_tts_${randId}.ogg`);
    try {
      fs.writeFileSync(tmpIn, fullMp3);
      execSync(
        `"${ffmpegBin}" -y -i "${tmpIn}" -c:a libopus -b:a 48k -vbr on -ar 48000 -ac 1 -compression_level 10 -application voip "${tmpOut}" 2>/dev/null`
      );
      if (fs.existsSync(tmpOut)) {
        finalAudio = fs.readFileSync(tmpOut);
        finalMime = 'audio/ogg; codecs=opus';
      }
    } catch (_) {
      // ffmpeg çalışmazsa yüksek kaliteli MP4 olarak gönder
    } finally {
      try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch (_) {}
      try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (_) {}
    }

    const sent = await sock.sendMessage(targetJid, {
      audio: finalAudio,
      mimetype: finalMime,
      ptt: true,
    });
    if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
    await sock.sendPresenceUpdate('paused', targetJid);
    console.log(`🎙️ Neural HD Sesli Sekreter (${profile.id}) Gönderildi -> ${targetJid}`);
    return sent;
  } catch (err) {
    console.error('Sesli mesaj gönderme hatası:', err.message);
    try { await sock.sendPresenceUpdate('paused', targetJid); } catch (_) {}
    return null;
  }
}

// Gerçek Tarih & Saatli Randevu Atama Motoru
function assignNextAppointmentSlot(phone, name, topic, queueNo) {
  stateData.appointments = stateData.appointments || {};
  const slotsPerDay = ['11:00', '13:30', '15:00', '16:30', '18:00'];
  const existingCount = Object.keys(stateData.appointments).length;
  const dayOffset = 1 + Math.floor(existingCount / slotsPerDay.length);
  const slotTime = slotsPerDay[existingCount % slotsPerDay.length];

  const targetDate = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
  // Pazar gününe denk gelirse Pazartesiye kaydır
  if (targetDate.getDay() === 0) {
    targetDate.setDate(targetDate.getDate() + 1);
  }
  const dateLabel = targetDate.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  });
  const fullSlotLabel = `${dateLabel}, Saat ${slotTime}`;
  const apptId = String(queueNo || stateData.nextQueueNumber || 61);

  const apptObj = {
    id: apptId,
    code: `AVL-${1000 + Number(apptId)}`,
    phone,
    name: name || 'Misafir',
    topic: topic || 'Görüşme Talebi',
    dateLabel,
    timeLabel: slotTime,
    fullSlotLabel,
    status: 'onay_bekliyor',
    createdAt: new Date().toISOString(),
  };

  stateData.appointments[apptId] = apptObj;
  saveData();
  return apptObj;
}

// Patron Eren'in Komutuyla Bir Numarayı Sesli + Yazılı Yoklama ("Şu numarayı ara, yarın için müsait misiniz de")
async function executeOutreachCallAndAsk(rawTargetNumber, customQuestion) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp bağlı değil');
  }
  const cleanPhone = normalizeTRPhone(rawTargetNumber);
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error('Geçerli bir telefon numarası girin (Örn: 0532xxxxxxx)');
  }
  const targetJid = `${cleanPhone}@s.whatsapp.net`;
  const questionText = (customQuestion || '').trim() || 'yarın için müsait misiniz?';

  const spokenIntro =
    `Merhabalar, ben Yasin Eren Tatar Bey'in yapay zeka yönetici sekreteri Avelon. ` +
    `Eren Bey size ulaşmamı ve şunu sormamı istedi: ${questionText}. ` +
    `Uygun olduğunuz saati veya yanıtınızı bu sohbete yazarsanız hemen Eren Bey'in takvimine işleyeceğim. İyi günler dilerim.`;

  const writtenIntro =
    `🤖 *AVELON — ÖZEL KALEM & RANDEVU KOORDİNASYONU*\n\n` +
    `Merhabalar, ben Yasin Eren Tatar Bey'in Yapay Zeka Yönetici Sekreteri *Avelon*.\n\n` +
    `📌 *Eren Bey'in Size İlettiği Mesaj:*\n"${questionText}"\n\n` +
    `💬 Lütfen uygunluğunuzu veya yanıtınızı bu mesaja cevap olarak yazın; cevabınızı anında Eren Bey'in takvimine işleyip kendisine ileteceğim.`;

  stateData.pendingOutreach = stateData.pendingOutreach || {};
  stateData.pendingOutreach[cleanPhone] = {
    phone: cleanPhone,
    question: questionText,
    askedAt: new Date().toISOString(),
    status: 'waiting',
    reply: '',
  };
  saveData();

  await sendVoiceNote(targetJid, spokenIntro);
  const sentTxt = await sock.sendMessage(targetJid, { text: writtenIntro });
  if (sentTxt?.key?.id) botSentMsgIds.add(sentTxt.key.id);

  return { ok: true, cleanPhone, phone: cleanPhone, questionText, spoken: spokenIntro };
}

// Kişinin kendi WhatsApp profil fotoğrafını çekip "%80 Dolandırıcı gözüküyor, engellendiniz" mesajıyla yüzüne çarpıp engelleyen fonksiyon
async function executeScamPhotoAndBlock(targetJid, cleanPhone) {
  if (!sock) throw new Error('WhatsApp bağlı değil');
  const phoneNum = cleanPhone || cleanNumber(targetJid);
  const stdJid = `${phoneNum}@s.whatsapp.net`;
  const sendJid = targetJid || stdJid;

  const scamCaption =
    `🚨 *AVELON SİBER İSTİHBARAT & GÜVENLİK TARAMASI* 🚨\n\n` +
    `Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim.\n\n` +
    `Sizin numaranızı (+${phoneNum}) ve profilinizi güvenlik sistemimizde araştırdım; yapılan analizde numaranız *%80 DOLANDIRICI / ŞÜPHELİ PROFİL* olarak gözüküyor!\n\n` +
    `🔒 Eren Bey'in güvenliği için numaranız Avelon Güvenlik Sistemi tarafından kalıcı olarak *ENGELLENMİŞTİR*.`;

  let imgBuffer = null;

  // 1) Önce karşı tarafın kendi WhatsApp profil fotoğrafını yüksek çözünürlüklü indirmeyi dene
  const candidateJids = [sendJid, stdJid];
  if (phoneToLid[phoneNum]) candidateJids.push(`${phoneToLid[phoneNum]}@lid`);

  for (const jidToTry of candidateJids) {
    try {
      const ppUrl = await sock.profilePictureUrl(jidToTry, 'image');
      if (ppUrl) {
        const res = await fetch(ppUrl);
        if (res.ok) {
          const arrBuf = await res.arrayBuffer();
          imgBuffer = Buffer.from(arrBuf);
          console.log(`📸 +${phoneNum} kişisinin kendi WhatsApp profil fotoğrafı çekildi!`);
          break;
        }
      }
    } catch (_) {
      // Profil fotoğrafı gizliyse diğer JID veya fallback karta geç
    }
  }

  // 2) Eğer karşı taraf profil fotoğrafını gizlediyse Avelon Siber Güvenlik Kartını kullan
  if (!imgBuffer && fs.existsSync(SCAM_FALLBACK_IMG)) {
    imgBuffer = fs.readFileSync(SCAM_FALLBACK_IMG);
  }

  await sock.sendPresenceUpdate('composing', sendJid);

  if (imgBuffer) {
    const sent = await sock.sendMessage(sendJid, {
      image: imgBuffer,
      caption: scamCaption,
    });
    if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
  } else {
    const sent = await sock.sendMessage(sendJid, {
      text: scamCaption,
    });
    if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
  }

  await sock.sendPresenceUpdate('paused', sendJid);

  // Durumu kaydet
  if (!stateData.strangerStages[phoneNum]) {
    stateData.strangerStages[phoneNum] = {
      stage: 2,
      jid: sendJid,
      phone: phoneNum,
      pushName: 'Dolandırıcı/Engelli',
      queueNo: stateData.nextQueueNumber || 60,
      msgCount: 8,
      blocked: true,
      firstMsg: '[Avelon %80 Dolandırıcı Tespiti]',
      introMsg: '',
      updatedAt: new Date().toISOString(),
    };
  } else {
    stateData.strangerStages[phoneNum].blocked = true;
    stateData.strangerStages[phoneNum].updatedAt = new Date().toISOString();
  }
  saveData();

  // Mesaj ve fotoğraf karşı tarafa ulaştıktan 2 saniye sonra WhatsApp'tan engelle
  setTimeout(async () => {
    try {
      await sock.updateBlockStatus(sendJid, 'block');
      if (sendJid !== stdJid) {
        await sock.updateBlockStatus(stdJid, 'block').catch(() => { });
      }
      console.log(`🔒 +${phoneNum} fotoğrafı atılıp "%80 dolandırıcı" denilerek ENGELLENDİ!`);
    } catch (err) {
      console.error('Engelleme hatası:', err.message);
    }
  }, 2000);
}

async function startWhatsApp() {
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.ws?.close();
    } catch (_) {}
    sock = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version = [2, 3000, 1015901307];
  try {
    const latest = await fetchLatestBaileysVersion();
    if (latest?.version) version = latest.version;
  } catch (_) { }

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    keepAliveIntervalMs: 20000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
  });

  sock.ev.on('creds.update', () => {
    saveCreds();
    syncAuthInfoContactsAndLids();
  });

  function applyWhatsAppContactsList(contacts) {
    let changed = false;
    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        const idNum = cleanNumber(c?.id || '');
        const lidNum = cleanNumber(c?.lid || '');
        const phoneNum = cleanNumber(c?.phoneNumber || '');
        const savedContactName = c?.name; // Telefon rehberinde senin kaydettiğin isim!
        if (lidNum && phoneNum) {
          lidToPhone[lidNum] = phoneNum;
          phoneToLid[phoneNum] = lidNum;
        }
        if (savedContactName && !savedContactName.startsWith('@')) {
          for (const k of [idNum, lidNum, phoneNum]) {
            if (k && !c?.id?.endsWith('@g.us')) {
              stateData.knownNumbers[k] = {
                ...(stateData.knownNumbers[k] || {}),
                name: savedContactName,
                customName: true,
                source: 'Rehber',
                addedAt: stateData.knownNumbers[k]?.addedAt || new Date().toISOString(),
                lastAutoReplyAt: stateData.knownNumbers[k]?.lastAutoReplyAt || 0,
              };
              changed = true;
            }
          }
        }
      }
    }
    if (changed) saveData();
  }

  sock.ev.on('messaging-history.set', ({ contacts }) => {
    syncAuthInfoContactsAndLids();
    applyWhatsAppContactsList(contacts);
  });

  sock.ev.on('contacts.upsert', (contacts) => {
    applyWhatsAppContactsList(contacts);
  });

  sock.ev.on('contacts.update', (contacts) => {
    applyWhatsAppContactsList(contacts);
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = 'qr';
      currentQRDataURL = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
      console.log('\n📱 WhatsApp QR Kodu hazır! Tarayıcıdan okut: http://localhost:4040\n');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      currentQRDataURL = null;
      currentPairingCode = null;
      connectedUser = {
        id: cleanNumber(sock.user?.id || ''),
        name: sock.user?.name || 'Yasin Eren',
      };
      const synced = syncAuthInfoContactsAndLids();
      console.log(`✅ Avelon WhatsApp'a Bağlandı: ${connectedUser.name} (+${connectedUser.id}) | Rehber: ${synced} kişi`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      connectionStatus = 'disconnected';
      currentQRDataURL = null;
      if (shouldReconnect) {
        setTimeout(startWhatsApp, 3000);
      } else {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(startWhatsApp, 1500);
      }
    }
  });

  // Gelen ve Giden Mesajları Dinle
  const processedMsgIds = new Set();

  function extractMessageText(rawMessage) {
    if (!rawMessage) return '';
    const m =
      rawMessage.ephemeralMessage?.message ||
      rawMessage.viewOnceMessage?.message ||
      rawMessage.viewOnceMessageV2?.message ||
      rawMessage.deviceSentMessage?.message ||
      rawMessage.documentWithCaptionMessage?.message ||
      rawMessage;

    const txt =
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption ||
      '';
    if (txt && txt.trim()) return txt.trim();

    if (m.audioMessage) return '[Sesli Mesaj]';
    if (m.imageMessage) return '[Fotoğraf]';
    if (m.videoMessage) return '[Video]';
    if (m.stickerMessage) return '[Çıkartma]';
    if (m.contactMessage || m.contactsArrayMessage) return '[Kişi Kartı]';
    if (m.locationMessage || m.liveLocationMessage) return '[Konum]';
    return '';
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      try {
        const msgId = msg.key?.id;
        if (msgId) {
          if (processedMsgIds.has(msgId)) continue;
          processedMsgIds.add(msgId);
        }

        // 'append' tipindeyse sadece son 25 saniye içinde atılmış taze mesajları işle (eski geçmiş senkronunu atla)
        const tsSec = Number(msg.messageTimestamp?.low || msg.messageTimestamp || 0);
        if (type === 'append' && tsSec > 0 && Math.abs(Date.now() / 1000 - tsSec) > 25) {
          continue;
        }

        const remoteJid = msg.key?.remoteJid;
        if (!remoteJid) continue;

        // 1) KESİN GRUP, KANAL VE DURUM ENGELİ (Gruplara asla cevap vermez)
        if (
          remoteJid.endsWith('@g.us') ||
          Boolean(msg.key?.participant) ||
          remoteJid === 'status@broadcast' ||
          remoteJid.endsWith('@newsletter') ||
          remoteJid.endsWith('@broadcast')
        ) {
          continue;
        }

        const rawNum = cleanNumber(remoteJid);
        const altJid = msg.key?.remoteJidAlt || msg.key?.senderPn || '';
        const altNum = cleanNumber(altJid);
        if (rawNum && altNum && rawNum !== altNum) {
          if (remoteJid.endsWith('@lid')) {
            lidToPhone[rawNum] = altNum;
            phoneToLid[altNum] = rawNum;
          } else {
            lidToPhone[altNum] = rawNum;
            phoneToLid[rawNum] = altNum;
          }
        }

        const canonicalKey = getCanonicalKey(rawNum);
        if (!canonicalKey) continue;
        let extractedText = extractMessageText(msg.message);
        const isSelfChat =
          (connectedUser?.id && (canonicalKey === connectedUser.id || rawNum === connectedUser.id)) ||
          canonicalKey === '905525222988' ||
          rawNum === '73560022323225';

        // 2) PATRON EREN'İN KENDİ "SİZ" SOHBETİ KOMUTA MERKEZİ VEYA KENDİ ATTIĞI MESAJLAR:
        if (msg.key?.fromMe || isSelfChat) {
          if (msgId && botSentMsgIds.has(msgId)) continue;

          // 🎤 YENİ: Patron "Siz" sohbetine SES KAYDI (Voice Note) attığında bulutta (PC kapalı olsa bile!) yazıya çevir ve uygula!
          const innerMsg =
            msg.message?.ephemeralMessage?.message ||
            msg.message?.viewOnceMessage?.message ||
            msg.message;
          if (isSelfChat && innerMsg?.audioMessage) {
            try {
              console.log('🎙️ Patron Eren "Siz" sohbetinden Sesli Talimat gönderdi, bulutta çözümleniyor...');
              const audioBuf = await downloadMediaMessage(msg, 'buffer', {});
              if (audioBuf && audioBuf.length > 0) {
                let cloudSpoken = '';
                const tmpOgg = `/tmp/avelon_in_${Date.now()}.ogg`;
                const tmpFlac = `/tmp/avelon_in_${Date.now()}.flac`;
                try {
                  fs.writeFileSync(tmpOgg, audioBuf);
                  const ffBin = ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : 'ffmpeg';
                  execSync(`"${ffBin}" -y -i "${tmpOgg}" -ar 16000 -ac 1 -sample_fmt s16 "${tmpFlac}" 2>/dev/null`);
                  const flacBuf = fs.readFileSync(tmpFlac);
                  const gRes = await fetch(
                    'http://www.google.com/speech-api/v2/recognize?client=chromium&lang=tr-TR&key=AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw&pFilter=0',
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'audio/x-flac; rate=16000' },
                      body: flacBuf,
                    }
                  );
                  const gTxt = await gRes.text();
                  for (const line of gTxt.split('\n')) {
                    if (!line.trim()) continue;
                    try {
                      const j = JSON.parse(line);
                      const alt = j?.result?.[0]?.alternative?.[0]?.transcript;
                      if (alt) {
                        cloudSpoken = alt.trim();
                        break;
                      }
                    } catch (_) {}
                  }
                } catch (_) {
                } finally {
                  try { if (fs.existsSync(tmpOgg)) fs.unlinkSync(tmpOgg); } catch (_) {}
                  try { if (fs.existsSync(tmpFlac)) fs.unlinkSync(tmpFlac); } catch (_) {}
                }

                if (cloudSpoken) {
                  const sLow = cloudSpoken.toLocaleLowerCase('tr-TR');
                  await notifyOwnerSelfChat(`🗣️ *Sesli Emrin Anlaşıldı:* _"${cloudSpoken}"_`);

                  // Eğer sesli emir Süper Admin / Tantavi / QRes / Takvim / Uyku ise PC kapalı olsa bile direkt Bulutta çalıştır!
                  const isTantaviVoice =
                    sLow.includes('tantav') ||
                    sLow.includes('tanatav') ||
                    sLow.includes('tan tamam') ||
                    sLow.includes('tan tabii') ||
                    /\btan\b/.test(sLow);
                  if (isTantaviVoice) {
                    extractedText = '.admin qres tantavi';
                  } else if (sLow.includes('muamma')) {
                    extractedText = '.admin qres muamma';
                  } else if (sLow.includes('2art') || sLow.includes('iki art')) {
                    extractedText = '.admin qres 2arti2';
                  } else if (
                    sLow.includes('telefon') ||
                    sLow.includes('telfon') ||
                    sLow.includes('çaldır') ||
                    sLow.includes('caldir') ||
                    sLow.includes('kaybettim') ||
                    sLow.includes('sahte arama')
                  ) {
                    extractedText = '.telefon';
                  } else if (sLow.includes('buldum') || sLow.includes('sustur') || sLow.includes('durdur')) {
                    extractedText = '.buldum';
                  } else if (sLow.includes('mail') || sLow.includes('eposta') || sLow.includes('e-posta')) {
                    extractedText = '.mail';
                  } else if (sLow.includes('admin') || sLow.includes('qres') || sLow.includes('qris')) {
                    extractedText = '.admin';
                  } else if (sLow.includes('takvim') || sLow.includes('randevu') || sLow.includes('özet')) {
                    extractedText = '.takvim';
                  } else if (sLow.includes('uyku')) {
                    extractedText = '.uyku modu';
                  } else if (
                    sLow.includes('bilgisayar') ||
                    sLow.includes('ekranı aç') ||
                    sLow.includes('ekrani ac') ||
                    sLow.includes('ekranı kapat') ||
                    sLow.includes('youtube') ||
                    sLow.includes('şarkı') ||
                    sLow.includes('müzik') ||
                    sLow.includes('sesi fulle') ||
                    sLow.includes('sesi kıs')
                  ) {
                    // Mac komutuysa Mac kuyruğuna ekle
                    stateData.gemiTasks = stateData.gemiTasks || [];
                    stateData.gemiTasks.push({
                      id: 'GEMI-VOICE-' + Date.now(),
                      prompt: cloudSpoken,
                      status: 'pending',
                      createdAt: new Date().toISOString(),
                    });
                    saveData();
                    continue;
                  } else {
                    // Doğrudan Avelon Jarvis olarak hemen yanıtla ("Avelon", sohbet, soru vb.)
                    extractedText = cloudSpoken;
                  }
                } else {
                  // Yedek olarak Mac kuyruğuna gönder
                  stateData.gemiTasks = stateData.gemiTasks || [];
                  stateData.gemiTasks.push({
                    id: 'GEMI-VOICE-' + Date.now(),
                    prompt: '__VOICE_NOTE__',
                    audioBase64: audioBuf.toString('base64'),
                    status: 'pending',
                    createdAt: new Date().toISOString(),
                  });
                  saveData();
                  continue;
                }
              }
            } catch (vErr) {
              console.error('Sesli talimat indirme hatası:', vErr.message);
              continue;
            }
          }

          if (!extractedText) continue;

          const trimmedRaw = extractedText
            .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
            .replace(/\u00A0/g, ' ')
            .trim()
            .replace(/^\.\s+/, '.');
          const myText = trimmedRaw.toLocaleLowerCase('tr-TR');

          // A) Herhangi bir sohbette ".engel" veya ".dolandirici" yazarsa:
          if (!isSelfChat && (myText === '.engel' || myText === '.dolandirici' || myText === '.scam')) {
            console.log(`🚨 Eren telefondan ${myText} komutu verdi! +${canonicalKey} fotoğrafı çekilip %80 dolandırıcı mesajıyla engelleniyor...`);
            try {
              await sock.sendMessage(remoteJid, { delete: msg.key });
            } catch (_) { }
            await executeScamPhotoAndBlock(remoteJid, canonicalKey);
            continue;
          }

          // B) Patron Eren'in "Siz" sohbetinden (veya "." / "@gemi" ile başlayan) Özel Kalem Komutları:
          if (
            isSelfChat ||
            myText.startsWith('@gemi') ||
            myText.startsWith('.gemi') ||
            myText.startsWith('gemi ') ||
            myText.startsWith('.pc') ||
            myText.startsWith('.uyku') ||
            myText.startsWith('.uyan') ||
            myText.startsWith('.yt ') ||
            myText.startsWith('.youtube ') ||
            myText === '.ss' ||
            myText.startsWith('.ara ') ||
            myText.startsWith('.sesli ') ||
            myText.startsWith('.sekreter ') ||
            myText === '.takvim' ||
            myText === '.ozet' ||
            myText === '.özet' ||
            myText === '.yardim' ||
            myText === '.yardım' ||
            myText === '.komutlar' ||
            myText.startsWith('.onayla ') ||
            myText.startsWith('.ertele ') ||
            myText.startsWith('.iptal ') ||
            myText.startsWith('.mod ') ||
            myText === '.ses' ||
            myText.startsWith('.ses ') ||
            myText === '.admin' ||
            myText.startsWith('.admin ') ||
            myText.startsWith('.qres') ||
            myText.startsWith('.hatirlat ') ||
            myText.startsWith('.hatırlat ') ||
            myText === '.telefon' ||
            myText === '.telfon' ||
            myText === '.telefonubul' ||
            myText === '.caldir' ||
            myText === '.çaldır' ||
            myText === '.buldum' ||
            myText === '.mail' ||
            myText.startsWith('.mail ')
          ) {
            // 0-TELEFON BULUCU & SAHTE ARAMA (.telefon, .telfon, .caldir, .buldum)
            if (
              myText === '.telefon' ||
              myText === '.telfon' ||
              myText === '.telefonubul' ||
              myText === '.caldir' ||
              myText === '.çaldır' ||
              myText === 'telefonumu bul' ||
              myText === 'telefonu çaldır'
            ) {
              await startFindMyPhoneSiren('WhatsApp (.telefon komutu)');
              continue;
            }

            if (myText === '.buldum' || myText === 'buldum') {
              stopFindMyPhoneSiren(true);
              continue;
            }

            if (
              myText === '.kapat' ||
              myText === '.reddet' ||
              myText === '.açma' ||
              myText === '.acma' ||
              myText === 'aramayı kapat' ||
              myText === 'meşgule at'
            ) {
              const current = globalThis.lastIncomingCall;
              if (current && Date.now() - current.timestamp < 60000) {
                current.decision = 'reject';
                if (sock && current.callId && current.callFrom) {
                  try { await sock.rejectCall(current.callId, current.callFrom); } catch (_) {}
                }
                const voiceText =
                  `Merhabalar, ben Avelon, Yasin Eren Bey'in yapay zeka yönetici sekreteriyim. ` +
                  `Şu an Eren Bey müsait olmadığı için aramanızı ben karşıladım; kendisi müsait olunca sizi arayacaktır. Acil bir notunuz varsa bana buradan iletebilirsiniz.`;
                if (current.callerJid) {
                  await sendVoiceNote(current.callerJid, voiceText).catch(() => {});
                  const sent = await sock.sendMessage(current.callerJid, {
                    text: `🎙️ *AVELON SESLİ SEKRETER YANITI*\n\nMerhabalar, ben Avelon 🤖 Yasin Eren Bey'in Yapay Zeka Yönetici Sekreteriyim.\n\nŞu an Eren Bey müsait olmadığı için aramanızı açamadı; **müsait olunca sizi arayacaktır.** Acil bir notunuz varsa bana yazabilirsiniz, kendisine hemen ileteceğim.`,
                  }).catch(() => null);
                  if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
                }
                await notifyOwnerSelfChat(`🛡️ *ARAMA MEŞGULE ATILDI & AVELON SEKRETER DEVREYE GİRDİ!* (${current.callerName})`);
                continue;
              }
            }

            if (myText === '.aç' || myText === '.ac' || myText === 'aramayı aç') {
              const current = globalThis.lastIncomingCall;
              if (current && Date.now() - current.timestamp < 60000) {
                current.decision = 'accept';
                await notifyOwnerSelfChat(`✅ *ARAMA SİZE BIRAKILDI PATRON!* 📞 (${current.callerName})`);
                continue;
              }
            }

            // 0-MAIL KONTROL VE HESAP BAĞLAMA (.mail, .mail kontrol, .mail ekle eposta@gmail.com uygulama_sifresi)
            if (myText === '.mail' || myText.startsWith('.mail ')) {
              const mailSub = trimmedRaw.replace(/^\.mail\s*/i, '').trim();
              if (mailSub.toLocaleLowerCase('tr-TR').startsWith('ekle ')) {
                const parts = mailSub.replace(/^ekle\s+/i, '').trim().split(/\s+/);
                const newEmail = parts[0];
                const newPass = parts.slice(1).join('');
                if (!newEmail || !newPass) {
                  await notifyOwnerSelfChat(
                    `⚠️ *Kullanım:* \`.mail ekle eposta@gmail.com uygulama_sifresi\`\n` +
                    `_(Google Hesabım -> Güvenlik -> Uygulama Şifreleri kısmından aldığın 16 haneli şifreyi yazabilirsin cano.)_`
                  );
                  continue;
                }
                stateData.mailAccounts = stateData.mailAccounts || DEFAULT_MAIL_ACCOUNTS;
                const existingIdx = stateData.mailAccounts.findIndex((a) => a.email === newEmail);
                if (existingIdx >= 0) {
                  stateData.mailAccounts[existingIdx].pass = newPass;
                } else {
                  stateData.mailAccounts.push({ email: newEmail, pass: newPass, label: newEmail });
                }
                saveData();
                await notifyOwnerSelfChat(
                  `✅ *YENİ E-POSTA HESABI AVELON'A BAĞLANDI!* 📧\n\n` +
                  `📥 *Hesap:* ${newEmail}\n` +
                  `🔔 Artık bu adrese gelen tüm önemli mailler (Apple, BTM, Garanti, TÜBİTAK, Banka, Onay vb.) 7/24 anında WhatsApp'ına ve telefon bildirimine düşecek!`
                );
                await pollAllMailAccounts(true);
                continue;
              }

              await notifyOwnerSelfChat(`⏳ *Avelon bağlı e-posta kutularını kontrol ediyor...* 📧`);
              const summaries = await pollAllMailAccounts(true);
              if (summaries.length > 0) {
                await notifyOwnerSelfChat(
                  `📧 *AVELON E-POSTA KUTUSU ÖZETİ (SON MAİLLER)* 📬\n\n` +
                  summaries.join('\n\n') +
                  `\n\n💡 _7/24 Otomatik Takip Aktif! Yeni önemli mail geldiğinde anında WhatsApp ve Telefon Push bildirimi olarak atılır._\n` +
                  `➕ _Başka Gmail bağlamak için:_ \`.mail ekle mail@gmail.com uygulama_sifresi\``
                );
                await sendVoiceNote(
                  '905525222988@s.whatsapp.net',
                  `Eren Bey, bağlı e-posta hesaplarınızdaki son mailleri ekranınıza listeledim. Önemli bir e-posta geldiğinde size anında haber vereceğim.`
                );
              } else {
                await notifyOwnerSelfChat(`📭 Bağlı e-posta kutularında henüz yeni ileti bulunamadı.`);
              }
              continue;
            }

            // 0-JARVIS: ".admin", ".admin qres tantavi", ".admin bildirim Başlık | Mesaj" -> TONY STARK SÜPER ADMİN KOMUTA MERKEZİ!
            if (myText === '.admin' || myText.startsWith('.admin ') || myText === '.qres' || myText.startsWith('.qres ')) {
              const rawSub = trimmedRaw.replace(/^\.(?:admin|qres)\s*/i, '').trim();
              const subLow = rawSub.toLocaleLowerCase('tr-TR');
              const NEYAPSAK_API = 'https://jellyfish-app-oydmg.ondigitalocean.app/api/admin';
              const NEYAPSAK_KEY = 'neyapsak_admin_secret_key_2026_secure';
              const QRES_API = 'https://web-production-b7541.up.railway.app/api/super';
              const QRES_KEY = 'neyapsak_super_admin_secret';

              try {
                // Alt Komut 1: ".admin bildirim Başlık | Mesaj" -> Tüm NeYapsak kullanıcılarına Push Bildirim at!
                if (subLow.startsWith('bildirim ')) {
                  const payloadStr = rawSub.replace(/^bildirim\s+/i, '').trim();
                  const [titlePart, ...bodyParts] = payloadStr.split('|');
                  const title = bodyParts.length > 0 ? titlePart.trim() : 'NeYapsak Duyuru 🚀';
                  const message = bodyParts.length > 0 ? bodyParts.join('|').trim() : titlePart.trim();

                  // 1) Eren'in kendi telefonuna ANINDA doğrudan Push gönder (1 saniye içinde düşsün!)
                  await sendDirectPhonePush(title, message, { type: 'admin_broadcast' });

                  // 2) NeYapsak Backend üzerinden tüm kullanıcılara gönder (body + targetType düzeltildi!)
                  const pushRes = await fetch(`${NEYAPSAK_API}/notifications/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-admin-key': NEYAPSAK_KEY },
                    body: JSON.stringify({
                      title,
                      body: message,
                      targetType: 'all',
                      message,
                      target: 'all',
                    }),
                  });
                  const pushData = await pushRes.json().catch(() => ({}));
                  await notifyOwnerSelfChat(
                    `📢 *NEYAPSAK SÜPER ADMİN PUSH BİLDİRİMİ GÖNDERİLDİ!* 🚀\n\n` +
                    `📌 *Başlık:* ${title}\n` +
                    `💬 *Mesaj:* ${message}\n` +
                    `✅ *Durum:* ${pushData.message || 'Tüm kullanıcılara ve telefonuna iletildi!'}`
                  );
                  await sendVoiceNote(
                    '905525222988@s.whatsapp.net',
                    `Eren Bey, NeYapsak süper admin üzerinden tüm kullanıcılara ve telefonunuza bildirim başarıyla gönderildi.`
                  );
                  continue;
                }

                // Alt Komut 2: ".admin qres tantavi" veya ".admin tantavi" -> Belirli bir QRes mekanının TÜM verilerini getir!
                const venueQuery = subLow.replace(/^qres\s*/i, '').trim();
                if (venueQuery && venueQuery !== 'neyapsak') {
                  const restRes = await fetch(`${QRES_API}/restaurants`, {
                    headers: { 'x-admin-secret': QRES_KEY },
                  });
                  const restJson = await restRes.json();
                  const restaurants = restJson.data || [];

                  // Bulanık (Fuzzy) eşleştirme: "tanatavi", "tantavi", "muamma", "2arti2" vb.
                  const normalizeSlug = (s) =>
                    String(s || '')
                      .toLocaleLowerCase('tr-TR')
                      .replace(/ı/g, 'i')
                      .replace(/ğ/g, 'g')
                      .replace(/ü/g, 'u')
                      .replace(/ş/g, 's')
                      .replace(/ö/g, 'o')
                      .replace(/ç/g, 'c')
                      .replace(/[^a-z0-9]/g, '');

                  const qNorm = normalizeSlug(venueQuery);
                  const matched = restaurants.find((r) => {
                    const nNorm = normalizeSlug(r.name);
                    const sNorm = normalizeSlug(r.slug);
                    if (nNorm.includes(qNorm) || sNorm.includes(qNorm) || qNorm.includes(nNorm)) return true;
                    // "tanatavi" -> "tantavi" typo toleransı
                    if ((qNorm.includes('tanatav') || qNorm.includes('tantav')) && nNorm.includes('tantav')) return true;
                    return false;
                  });

                  if (!matched) {
                    const allList = restaurants
                      .map((r, i) => `${i + 1}. *${r.name}* — 📲 ${r.totalQrScans || 0} QR | 💰 ${r.totalRevenue || 0} ₺`)
                      .join('\n');
                    await notifyOwnerSelfChat(
                      `🔍 *"${venueQuery}"* adında bir QRes mekanı bulunamadı Patron.\n\n` +
                      `🍽️ *Sistemdeki Aktif QRes Mekanları:*\n${allList}\n\n` +
                      `💡 Örnek: *.admin qres tantavi* veya *.admin qres muamma*`
                    );
                    continue;
                  }

                  // Detaylı veriyi çek (/api/super/restaurants/:id/details)
                  const detRes = await fetch(`${QRES_API}/restaurants/${matched._id}/details`, {
                    headers: { 'x-admin-secret': QRES_KEY },
                  });
                  const detJson = await detRes.json();
                  const det = detJson.data || {};
                  const restObj = det.restaurant || matched;

                  const totalScans = restObj.totalQrScans ?? matched.totalQrScans ?? 0;
                  const dailyMap = restObj.dailyQrScans || {};
                  const dailyEntries = Object.entries(dailyMap).sort((a, b) => b[0].localeCompare(a[0]));
                  const todayKey = new Date().toISOString().slice(0, 10);
                  const todayScans = dailyMap[todayKey] ?? (dailyEntries[0] ? dailyEntries[0][1] : 0);

                  // En yüksek okutma yapılan rekor gün
                  let peakDay = '-';
                  let peakCount = 0;
                  for (const [dKey, cnt] of Object.entries(dailyMap)) {
                    if (Number(cnt) > peakCount) {
                      peakCount = Number(cnt);
                      peakDay = dKey;
                    }
                  }

                  const recentDaysText =
                    dailyEntries.length > 0
                      ? dailyEntries
                          .slice(0, 7)
                          .map(([dateStr, cnt]) => `  • 📅 *${dateStr}:* ${cnt} kişi QR okuttu`)
                          .join('\n')
                      : '  • Henüz günlük döküm kaydı yok';

                  const lastScanStr = restObj.lastScannedAt
                    ? new Date(restObj.lastScannedAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
                    : 'Bilinmiyor';

                  const totalRev = det.totalRevenue ?? matched.totalRevenue ?? 0;
                  const todayRev = matched.todayRevenue ?? 0;
                  const totalOrd = det.totalOrders ?? 0;
                  const todayOrd = det.todayOrders ?? matched.todayOrderCount ?? 0;
                  const waiterCnt = det.waiterCount ?? 0;
                  const ratings = det.ratings || [];
                  const avgRating =
                    ratings.length > 0
                      ? (ratings.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / ratings.length).toFixed(1)
                      : '5.0';

                  const reportMsg =
                    `🤖 *AVELON QRES SÜPER ADMİN — MEKAN İSTİHBARAT RAPORU* 📊\n` +
                    `🏭 *TATAR ENDÜSTRİ KOMUTA MERKEZİ*\n\n` +
                    `🏛️ *Mekan:* *${restObj.name}*\n` +
                    `🟢 *Durum:* ${restObj.isActive ? 'Aktif' : 'Pasif'} | ${restObj.isOpen ? 'Şu An Açık' : 'Kapalı'}\n` +
                    `📍 *Adres:* ${restObj.address || 'Belirtilmedi'}\n\n` +
                    `📲 *QR MENÜ OKUTMA VERİLERİ:*\n` +
                    `• 🔥 *TOPLAM QR OKUTAN KİŞİ:* *${totalScans.toLocaleString('tr-TR')} Kişi*\n` +
                    `• 📅 *Son Günde Okutan:* *${todayScans} Kişi*\n` +
                    `• 🏆 *Rekor Gün:* *${peakDay}* (*${peakCount} Kişi*)\n` +
                    `• 🕒 *Son QR Okutma Saati:* ${lastScanStr}\n\n` +
                    `📈 *SON 7 GÜNÜN QR OKUTMA DÖKÜMÜ:*\n${recentDaysText}\n\n` +
                    `💰 *FİNANS & SİPARİŞ VERİLERİ:*\n` +
                    `• 💵 *Toplam Ciro:* *${totalRev.toLocaleString('tr-TR')} ₺* (${totalOrd} Sipariş)\n` +
                    `• 🌅 *Bugünkü Ciro:* *${todayRev.toLocaleString('tr-TR')} ₺* (${todayOrd} Sipariş)\n` +
                    `• 👨‍🍳 *Kayıtlı Personel/Garson:* ${waiterCnt} Kişi\n` +
                    `• ⭐ *Müşteri Puanı:* ${avgRating} / 5.0 (${ratings.length} Değerlendirme)`;

                  await notifyOwnerSelfChat(reportMsg);
                  await sendVoiceNote(
                    '905525222988@s.whatsapp.net',
                    `Eren Bey, ${restObj.name} verilerini getirdim. Şu ana kadar toplam ${totalScans} kişi QR menüyü okutmuş. Son günde ${todayScans} kişi okutma yapmış. Mekanın toplam cirosu ${totalRev} Türk Lirası ve toplam ${totalOrd} sipariş kaydedilmiş.`
                  );
                  continue;
                }

                // Alt Komut 3: Genel ".admin" -> Hem NeYapsak Süper Admin Hem QRes Süper Admin Canlı Özeti!
                const [nyRes, qresStatsRes, qresRestRes] = await Promise.all([
                  fetch(`${NEYAPSAK_API}/dashboard-data`, { headers: { 'x-admin-key': NEYAPSAK_KEY } }),
                  fetch(`${QRES_API}/stats`, { headers: { 'x-admin-secret': QRES_KEY } }),
                  fetch(`${QRES_API}/restaurants`, { headers: { 'x-admin-secret': QRES_KEY } }),
                ]);

                const ny = await nyRes.json().catch(() => ({}));
                const qStats = (await qresStatsRes.json().catch(() => ({}))).data || {};
                const qRests = (await qresRestRes.json().catch(() => ({}))).data || [];

                const recentUsers = (ny.activeUsers || [])
                  .slice(0, 5)
                  .map((u) => `  • @${u.username} (${u.displayName || 'Kullanıcı'})`)
                  .join('\n');

                const topQresList = qRests
                  .sort((a, b) => (b.totalQrScans || 0) - (a.totalQrScans || 0))
                  .slice(0, 5)
                  .map(
                    (r, i) =>
                      `  ${i + 1}. *${r.name}:* 📲 ${r.totalQrScans || 0} QR | 💰 ${(r.totalRevenue || 0).toLocaleString('tr-TR')} ₺`
                  )
                  .join('\n');

                const masterReport =
                  `🏭 *TATAR ENDÜSTRİ — AVELON SÜPER ADMİN MERKEZİ* ⚡\n\n` +
                  `📱 *1. NEYAPSAK CANLI SÜPER ADMİN VERİLERİ:*\n` +
                  `• 👥 *Toplam Kayıtlı Kullanıcı:* *${ny.users || 0}*\n` +
                  `• 🟢 *Anlık Online Kullanıcı:* *${ny.currentlyActive || 0}*\n` +
                  `• 📅 *Bu Hafta Aktif Kullanıcı:* *${ny.weeklyActive || 0}*\n` +
                  `• 📸 *Toplam Gönderi (Post):* *${ny.posts || 0}* | 🎬 *Reels:* *${ny.totalReels || 0}*\n` +
                  `• 📍 *Kayıtlı Mekan:* *${ny.places || 0}*\n` +
                  `• 💬 *Sohbetler:* *${ny.totalChats || 0}* | *Mesajlar:* *${ny.totalMessages || 0}*\n` +
                  `• 🚨 *Bekleyen Şikayet:* *${ny.unreadReports || 0}* | *Geri Bildirim:* *${ny.unreadFeedbacks || 0}*\n\n` +
                  `👤 *Son Aktif Kullanıcılar:*\n${recentUsers || '  • Veri yok'}\n\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n\n` +
                  `🍽️ *2. QRES SÜPER ADMİN GENEL ÖZETİ:*\n` +
                  `• 🏪 *Toplam Restoran:* *${qStats.totalRestaurants || qRests.length}*\n` +
                  `• 📲 *Toplam QR Okutma:* *${(qStats.totalQrScans || 0).toLocaleString('tr-TR')} Kişi*\n` +
                  `• 💰 *Toplam Platform Cirosu:* *${(qStats.totalRevenue || 0).toLocaleString('tr-TR')} ₺*\n` +
                  `• 🧾 *Toplam Sipariş:* *${qStats.totalOrders || 0}* (Bugün: *${qStats.todayOrders || 0}*)\n\n` +
                  `🏆 *En Çok QR Okutulan Mekanlar:*\n${topQresList}\n\n` +
                  `💡 *Özel Komutlar:*\n` +
                  `• *.admin qres tantavi* → Tantavi'nin tüm QR ve ciro detayları\n` +
                  `• *.admin qres muamma* → Muamma Kahve detayları\n` +
                  `• *.admin bildirim Başlık | Mesaj* → Tüm NeYapsak kullanıcılarına Push Bildirim atar!`;

                await notifyOwnerSelfChat(masterReport);
                await sendVoiceNote(
                  '905525222988@s.whatsapp.net',
                  `Hoş geldiniz Eren Bey. Tatar Endüstri Avelon Süper Admin komuta merkezine bağlandım. NeYapsak uygulamasında şu an ${ny.users || 0} kayıtlı kullanıcı ve ${ny.weeklyActive || 0} haftalık aktif kullanıcı bulunuyor. QRes sisteminde ise toplam ${qStats.totalQrScans || 0} QR menü okutması ve ${qStats.totalRevenue || 0} Türk Lirası ciro kaydedildi.`
                );
              } catch (adminErr) {
                console.error('Süper Admin hatası:', adminErr.message);
                await notifyOwnerSelfChat(`❌ *Süper Admin Bağlantı Hatası:* ${adminErr.message}`);
              }
              continue;
            }
            // 0-A. ".uyku modu" veya ".uyku" -> Hem Avelon Sekreterini Uyku Moduna Al Hem Mac Bilgisayarı Uyut!
            if (myText === '.uyku' || myText.startsWith('.uyku ') || myText === 'uyku modu') {
              stateData.currentMode = 'uyku';
              stateData.knownReplyText =
                "Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim. Eren Bey şu anda istirahatte olduğu için mesajınızı sabah brifing listesine ekledim; uyandığında ilk iş size dönüş sağlayacaktır.";
              stateData.gemiTasks = stateData.gemiTasks || [];
              stateData.gemiTasks.push({
                id: 'GEMI-' + Date.now(),
                prompt: '.uyku modu',
                status: 'pending',
                createdAt: new Date().toISOString(),
              });
              saveData();
              await notifyOwnerSelfChat(
                `🌙 *UYKU MODU AKTİF EDİLDİ PATRON!* 😴\n\n` +
                `1️⃣ *Avelon Sekreterin:* Gelen aramalara ve mesajlara "Eren Bey şu an istirahatte, sabah ilk iş dönüş yapacak" diyecek.\n` +
                `2️⃣ *Mac Bilgisayarın:* Sesi kısılıp ekranı otomatik uyku moduna alınıyor!\n\n` +
                `☀️ Sabah uyandığında *.uyan* veya *.pc aç* yazman yeterli. İyi geceler Patron!`
              );
              await sendVoiceNote(
                '905525222988@s.whatsapp.net',
                'İyi geceler Eren Bey. Uyku modunu aktif ettim, bilgisayarınızı uyutuyorum ve sabaha kadar tüm aramalarınızı ben karşılayacağım.'
              );
              continue;
            }

            // 0-B. ".uyan" -> Hem Avelon'u Normal Moda Döndür Hem Mac Ekranını Uyandır!
            if (myText === '.uyan' || myText.startsWith('.uyan ')) {
              stateData.currentMode = 'normal';
              stateData.knownReplyText = defaultData.knownReplyText;
              stateData.gemiTasks = stateData.gemiTasks || [];
              stateData.gemiTasks.push({
                id: 'GEMI-' + Date.now(),
                prompt: '.pc aç',
                status: 'pending',
                createdAt: new Date().toISOString(),
              });
              saveData();
              await notifyOwnerSelfChat(
                `☀️ *GÜNAYDIN PATRON! NORMAL MOD & MAC EKRANI AÇILDI!* 🚀\n\n` +
                `Avelon normal sekreter moduna geçti ve Mac bilgisayarının ekranı uyandırıldı!`
              );
              continue;
            }

            // 0. "@gemi <talimat>", ".gemi <talimat>", ".pc aç", ".yt <video>", ".ss" -> Uzaktan Mac Kontrol & Antigravity Köprüsü!
            const gemiMatch =
              trimmedRaw.match(/^(?:@gemi|\.gemi|gemi)\s+(.+)$/is) ||
              trimmedRaw.match(/^(\.(?:pc|yt|youtube|ss)\b.*)$/is);
            if (gemiMatch) {
              const promptText = gemiMatch[1].trim();
              stateData.gemiTasks = stateData.gemiTasks || [];
              const taskObj = {
                id: 'GEMI-' + Date.now(),
                prompt: promptText,
                status: 'pending',
                createdAt: new Date().toISOString(),
              };
              stateData.gemiTasks.push(taskObj);
              if (stateData.gemiTasks.length > 50) {
                stateData.gemiTasks = stateData.gemiTasks.slice(-50);
              }
              saveData();

              await notifyOwnerSelfChat(
                `🧠 *@GEMİ & MAC UZAKTAN KONTROL ALINDI!* 🚀\n\n` +
                `🆔 *Görev Kodu:* #${taskObj.id}\n` +
                `📌 *Emrin:* "${promptText}"\n\n` +
                `⚡ Mac bilgisayarına iletildi, hemen uygulanıyor Patron!`
              );
              await sendVoiceNote(
                '905525222988@s.whatsapp.net',
                `Emriniz alındı Eren Bey. Mac bilgisayarınızda işleminizi hemen başlatıyorum.`
              );
              continue;
            }
            // 1. ".ara +90 553 086 26 59 Yarın için müsait misiniz?" veya doğal dille "0532xxxxxxx ara yarın için müsait misiniz"
            const callMatch =
              trimmedRaw.match(/^(?:\.ara|\.sesli|\.sekreter|ara|sesli)\s+(\+?[\d\s()\-]{9,24}?)(?:\s+([a-zA-ZğüşıöçĞÜŞİÖÇ].*))?$/i) ||
              trimmedRaw.match(/^(\+?[\d\s()\-]{9,24}?)\s+(?:ara|sor|yaz|de\s*ki)\s*(.*)$/i);

            if (callMatch) {
              const targetNum = callMatch[1];
              const customQ = (callMatch[2] || '').replace(/^(ve\s+)?de\s*ki\s+/i, '').trim() || 'Yarın için müsait misiniz?';
              try {
                const { cleanPhone, questionText } = await executeOutreachCallAndAsk(targetNum, customQ);
                await notifyOwnerSelfChat(
                  `✅ *AVELON SESLİ SEKRETER GÖREVE ÇIKTI!* 🎙️\n\n` +
                  `📞 *Aranan / Yoklanan Numara:* +${cleanPhone}\n` +
                  `🗣️ *Sesli & Yazılı İletilen Soru:* "${questionText}"\n\n` +
                  `⏳ Karşı taraf cevap yazdığı saniye randevuyu takvime işleyip sana buradan bildireceğim Patron!`
                );
              } catch (err) {
                await notifyOwnerSelfChat(`❌ *Hata:* ${err.message}`);
              }
              continue;
            }

            // 2. ".takvim" veya ".ozet" -> Randevuları ve bekleyen yoklamaları listele
            if (myText === '.takvim' || myText === '.randevular' || myText === '.ozet' || myText === '.özet') {
              const appts = Object.values(stateData.appointments || {});
              const strangers = Object.values(stateData.strangerStages || {});
              const outreach = Object.values(stateData.pendingOutreach || {});

              let summary = `📊 *AVELON ÖZEL KALEM & RANDEVU ÖZETİ* 🤖\n`;
              summary += `🎛️ *Aktif Mod:* ${(stateData.currentMode || 'normal').toUpperCase()}\n\n`;

              if (appts.length === 0) {
                summary += `📅 *Randevular:* Henüz oluşturulmuş randevu yok.\n`;
              } else {
                summary += `📅 *Güncel Randevu Takvimi (${appts.length}):*\n`;
                for (const a of appts.slice(-10)) {
                  summary += `• *#${a.id}* | ${a.name} (+${a.phone})\n  🕒 *${a.fullSlotLabel}* [${a.status}]\n  💬 Konu: "${a.topic}"\n`;
                }
              }

              if (outreach.length > 0) {
                summary += `\n📞 *Senin Arattığın / Yoklattığın Numaralar:*\n`;
                for (const o of outreach.slice(-5)) {
                  summary += `• +${o.phone} -> "${o.question}" [${o.status === 'answered' ? '✅ Yanıtladı: ' + o.reply : '⏳ Yanıt Bekleniyor'}]\n`;
                }
              }

              if (strangers.length > 0) {
                summary += `\n🕵️ *Son Yabancı Kayıtları (${strangers.length} kişi):*\n`;
                for (const s of strangers.slice(-5)) {
                  summary += `• #${s.queueNo} +${s.phone} (${s.pushName}): "${s.introMsg || s.firstMsg}"\n`;
                }
              }

              summary += `\n💡 *Komutlar için:* *.yardim* yazabilirsin.`;
              await notifyOwnerSelfChat(summary);
              continue;
            }

            // 3. ".onayla 61", ".ertele 61 Yarın 16:00", ".iptal 61", ".engel 61"
            const actionMatch = trimmedRaw.match(/^\.(onayla|ertele|iptal|engel)\s+(\d+)\s*(.*)$/i);
            if (actionMatch) {
              const act = actionMatch[1].toLocaleLowerCase('tr-TR');
              const qId = actionMatch[2];
              const extra = (actionMatch[3] || '').trim();

              const appt = (stateData.appointments || {})[qId];
              const stranger = Object.values(stateData.strangerStages || {}).find(
                (s) => String(s.queueNo) === String(qId) || s.phone === qId
              );
              const targetPhone = appt?.phone || stranger?.phone || normalizeTRPhone(qId);
              const targetJid = `${targetPhone}@s.whatsapp.net`;

              if (!targetPhone) {
                await notifyOwnerSelfChat(`❌ #${qId} numaralı randevu veya kişi bulunamadı.`);
                continue;
              }

              if (act === 'engel') {
                await executeScamPhotoAndBlock(targetJid, targetPhone);
                await notifyOwnerSelfChat(`🚫 +${targetPhone} fotoğrafı atılıp %80 dolandırıcı raporuyla engellendi!`);
                continue;
              }

              if (act === 'onayla') {
                const slotTxt = appt?.fullSlotLabel || 'belirtilen saatteki';
                if (appt) appt.status = 'onaylandi';
                saveData();
                const voiceMsg = `Merhabalar, ben Avelon. Yöneticimiz Yasin Eren Bey, ${slotTxt} randevunuzu bizzat onayladı. Görüşmek üzere, iyi günler dilerim.`;
                await sendVoiceNote(targetJid, voiceMsg);
                const sent = await sock.sendMessage(targetJid, {
                  text: `✅ *RANDEVU ONAYLANDI (Avelon Özel Kalem)*\n\nYöneticimiz *Yasin Eren Bey*, *${slotTxt}* tarihindeki randevunuzu onaylamıştır. Görüşmek üzere! 🤖`,
                });
                if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
                await notifyOwnerSelfChat(`✅ #${qId} (+${targetPhone}) randevusu sesli ve yazılı olarak ONAYLANDI!`);
                continue;
              }

              if (act === 'ertele') {
                const newTime = extra || 'Yarın Saat 16:00';
                if (appt) {
                  appt.fullSlotLabel = newTime;
                  appt.status = 'ertelendi';
                }
                saveData();
                const voiceMsg = `Merhabalar, ben Avelon. Yöneticimiz Yasin Eren Bey'in programındaki yoğunluk nedeniyle randevunuz ${newTime} olarak güncellenmiştir. Bilginize sunarım.`;
                await sendVoiceNote(targetJid, voiceMsg);
                const sent = await sock.sendMessage(targetJid, {
                  text: `🔄 *RANDEVU SAATİ GÜNCELLENDİ (Avelon Özel Kalem)*\n\nEren Bey'in programındaki değişiklik nedeniyle görüşmeniz *${newTime}* tarihine revize edilmiştir. Uygunluğunuzu teyit edebilirsiniz. 🤖`,
                });
                if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
                await notifyOwnerSelfChat(`🔄 #${qId} (+${targetPhone}) randevusu "${newTime}" olarak ertelendi!`);
                continue;
              }

              if (act === 'iptal') {
                if (appt) appt.status = 'iptal';
                saveData();
                const voiceMsg = `Merhabalar, ben Avelon. Yöneticimiz Yasin Eren Bey'in acil gelişen programı nedeniyle randevunuz ileri bir tarihe ertelenmek üzere iptal edilmiştir. Anlayışınız için teşekkür ederiz.`;
                await sendVoiceNote(targetJid, voiceMsg);
                const sent = await sock.sendMessage(targetJid, {
                  text: `❌ *RANDEVU İPTAL BİLDİRİMİ (Avelon Özel Kalem)*\n\nEren Bey'in acil gelişen yoğun programı nedeniyle görüşmeniz iptal edilmiştir. Daha sonra tekrar planlama yapılacaktır. 🤖`,
                });
                if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
                await notifyOwnerSelfChat(`❌ #${qId} (+${targetPhone}) randevusu iptal edildi.`);
                continue;
              }
            }

            // 4. ".mod toplanti" | ".mod btm" | ".mod uyku" | ".mod ada" | ".mod normal"
            if (myText.startsWith('.mod ') || myText === '.ada' || myText.includes('ada modunu aktif et') || myText === 'ada modu') {
              const modeArg =
                myText === '.ada' || myText.includes('ada mod')
                  ? 'ada'
                  : myText.replace('.mod ', '').trim();
              stateData.currentMode = modeArg;
              if (modeArg === 'btm' || modeArg === 'toplanti' || modeArg === 'toplantı') {
                stateData.knownReplyText =
                  "Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim. Eren Bey şu anda BTM yerleşkesinde girişimcilik ve yatırım toplantısında olduğu için telefonuna bakamamaktadır. Mesajınızı kendisine ilettim, toplantı bitiminde size dönüş yapacaktır.";
              } else if (modeArg === 'uyku' || modeArg === 'gece') {
                stateData.knownReplyText =
                  "Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim. Eren Bey şu anda istirahatte olduğu için mesajınızı sabah brifing listesine ekledim; uyandığında ilk iş size dönüş sağlayacaktır.";
              } else if (modeArg === 'ada') {
                stateData.knownReplyText =
                  "Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim. Eren Bey şu anda dış dünyadan izole Ada Modunda (odaklanma ve dinlenme sürecinde) olduğu için telefonuna bakamamaktadır. Mesajınızı kendisine ilettim; müsait olduğunda size dönüş sağlayacaktır.";
              } else {
                stateData.knownReplyText = defaultData.knownReplyText;
              }
              saveData();
              await notifyOwnerSelfChat(`🏝️ *Avelon Modu Değiştirildi:* *${modeArg.toUpperCase()}*\nYeni otomatik yanıt (Aynı kişiye 6 saatte sadece 1 kez atılır):\n"${stateData.knownReplyText}"`);
              continue;
            }

            // 5. ".hatirlat 30dk BTM mailine bak"
            const remindMatch = trimmedRaw.match(/^\.hat[ıi]rlat\s+(\d+)\s*(?:dk|dakika|sn|saniye)?\s+(.+)$/i);
            if (remindMatch) {
              const mins = Math.max(1, Number(remindMatch[1]) || 10);
              const note = remindMatch[2].trim();
              await notifyOwnerSelfChat(`⏰ *Hatırlatıcı Kuruldu!* ${mins} dakika sonra sana "${note}" notunu sesli ve yazılı hatırlatacağım Patron.`);
              setTimeout(async () => {
                await sendVoiceNote('905525222988@s.whatsapp.net', `Patron Eren, hatırlatma vaktin geldi: ${note}`);
                await notifyOwnerSelfChat(`🔔 *HATIRLATMA VAKTİ PATRON!* ⏰\n\n📌 *Notun:* "${note}"`);
              }, mins * 60 * 1000);
              continue;
            }

            // 5.5 ".ses" -> Sesli Emir Dinleme Modu | ".ses kiz" / ".ses erkek" -> Ses Değiştirme
            if (myText === '.ses' || myText.startsWith('.ses ')) {
              const arg = myText.replace('.ses', '').trim();
              if (!arg) {
                await notifyOwnerSelfChat(
                  `🎙️ *SESLİ EMİR DİNLEME MODU AKTİF PATRON!* 👑\n\n` +
                  `Şimdi mikrofona basıp *Ses Kaydı (🎤)* atarak istediğin her şeyi söyleyebilirsin!\n\n` +
                  `💡 *Örnek Sesli Emirler:*\n` +
                  `• _"Bilgisayarı aç"_\n` +
                  `• _"YouTube'dan Barış Manço Dönence aç"_\n` +
                  `• _"Uyku moduna geç"_\n` +
                  `• _"Sesi fulle"_ / _"Sesi kıs"_\n` +
                  `• _"NeYapsak uygulamasında şunu güncelle"_\n\n` +
                  `👂 Seni dinliyorum Patron, ses kaydını gönderebilirsin!`
                );
                await sendVoiceNote(
                  '905525222988@s.whatsapp.net',
                  'Sizi dinliyorum Eren Bey. Ses kaydı göndererek istediğiniz emri verebilirsiniz.'
                );
                continue;
              }
              if (arg === 'erkek' || arg === 'ahmet') {
                stateData.voiceProfile = 'ahmet';
                saveData();
              } else if (arg === 'kiz' || arg === 'kız' || arg === 'kadin' || arg === 'kadın' || arg === 'emel') {
                stateData.voiceProfile = 'emel';
                saveData();
              } else if (arg === 'ava') {
                stateData.voiceProfile = 'ava';
                saveData();
              }
              const activeProf = VOICE_PROFILES[stateData.voiceProfile || 'emel'] || VOICE_PROFILES.emel;
              await notifyOwnerSelfChat(
                `🎙️ *AVELON NEURAL HD STÜDYO SESİ AKTİF*\n\n` +
                `🗣️ *Seçili Ses:* *${activeProf.label}*`
              );
              await sendVoiceNote(
                '905525222988@s.whatsapp.net',
                'Merhabalar Eren Bey, ben özel yönetici sekreteriniz Avelon. Yeni stüdyo kalitesindeki doğal sesimle aramalarınızı karşılamaya ve randevularınızı yönetmeye hazırım.'
              );
              continue;
            }

            // 6. ".yardim" veya ".komutlar"
            if (myText === '.yardim' || myText === '.yardım' || myText === '.komutlar') {
              await notifyOwnerSelfChat(
                `🤖 *AVELON PATRON KOMUTA MERKEZİ REHBERİ*\n\n` +
                `Kendi *"Siz"* sohbetine şu komutları yazarak beni yönetebilirsin:\n\n` +
                `1️⃣ *.ara 0532xxxxxxx Yarın için müsait misiniz?*\n` +
                `→ O numaraya Avelon'un kendi sesiyle 🎤 sesli mesaj + yazılı randevu sorusu atar, cevabını sana raporlar!\n\n` +
                `2️⃣ *.takvim* veya *.ozet*\n` +
                `→ Sen yokken kimler aradı, kime hangi saat randevu verildi listeler.\n\n` +
                `3️⃣ *.onayla 61* / *.ertele 61 Yarın 16:00* / *.iptal 61*\n` +
                `→ 61 sıra numaralı kişinin randevusunu sesli mesajla onaylar, erteler veya iptal eder.\n\n` +
                `4️⃣ *.engel 61* (veya kişinin sohbetine *.engel*)\n` +
                `→ Kişinin profil fotoğrafını çekip "%80 Dolandırıcı" raporuyla engeller.\n\n` +
                `5️⃣ *.mod btm* | *.mod toplanti* | *.mod uyku* | *.mod normal*\n` +
                `→ Avelon'un arayanlara/yazanlara söyleyeceği durumu değiştirir.\n\n` +
                `6️⃣ *.hatirlat 30dk İrfan Bey'i ara*\n` +
                `→ Süre dolunca sana sesli ve yazılı bildirim atar.`
              );
              continue;
            }

            // 7. AVELON JARVIS SERBEST SESLİ & YAZILI ASİSTAN ("Avelon" seslenişi ve her türlü sohbet/soru)
            if (isSelfChat && trimmedRaw) {
              const jarvisRes = await askJarvisBrain(trimmedRaw);
              if (jarvisRes) {
                await notifyOwnerSelfChat(jarvisRes.display, '🤖 Avelon Jarvis');
                await sendVoiceNote('905525222988@s.whatsapp.net', jarvisRes.spoken);
              }
              continue;
            }
          }

          if (isSelfChat) continue;

          // Eren başka birinin sohbetine bizzat kendisi yazdıysa:
          // 1) O kişiyi otomatik Kayıtlı Kişi yap (asla yabancı/şüpheli mesajı gitmesin!)
          // 2) 6 SAAT boyunca o sohbette Avelon araya girmesin!
          if (extractedText) {
            ownerActiveChats[canonicalKey] = Date.now();
            ownerActiveChats[rawNum] = Date.now();
            stateData.knownNumbers[canonicalKey] = {
              ...(stateData.knownNumbers[canonicalKey] || {}),
              name: stateData.knownNumbers[canonicalKey]?.name || 'Kişisel Sohbet',
              source: 'Eren Yazıştı',
              lastAutoReplyAt: Date.now(),
              ownerLastWroteAt: Date.now(),
            };
            if (rawNum) {
              stateData.knownNumbers[rawNum] = {
                ...(stateData.knownNumbers[rawNum] || {}),
                name: stateData.knownNumbers[rawNum]?.name || 'Kişisel Sohbet',
                source: 'Eren Yazıştı',
                lastAutoReplyAt: Date.now(),
                ownerLastWroteAt: Date.now(),
              };
            }
            if (stateData.strangerStages?.[canonicalKey]) delete stateData.strangerStages[canonicalKey];
            if (stateData.strangerStages?.[rawNum]) delete stateData.strangerStages[rawNum];
            saveData();
          }
          continue;
        }

        if (!stateData.enabled) continue;

        // Eren son 6 SAAT içinde bu kişiye bizzat mesaj yazdıysa Avelon araya girmesin (Çoklu mesaj spamlamasını %100 önler!)
        const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
        const lastOwnerWrite =
          ownerActiveChats[canonicalKey] ||
          ownerActiveChats[rawNum] ||
          stateData.knownNumbers[canonicalKey]?.ownerLastWroteAt ||
          stateData.knownNumbers[rawNum]?.ownerLastWroteAt ||
          0;
        if (lastOwnerWrite && Date.now() - lastOwnerWrite < SIX_HOURS_MS) {
          console.log(`⏸️ Eren bu sohbete yakın zamanda bizzat yazdığı için Avelon araya girmedi (+${canonicalKey}).`);
          continue;
        }

        const text = extractedText;
        if (!text) continue;

        // C) EĞER BU KİŞİ EREN'İN ".ara 0532..." KOMUTUYLA YOKLATTIĞI KİŞİYSE VE CEVAP VERDİYSE:
        const pendingOut = (stateData.pendingOutreach || {})[canonicalKey] || (stateData.pendingOutreach || {})[rawNum];
        if (pendingOut && pendingOut.status === 'waiting') {
          pendingOut.status = 'answered';
          pendingOut.reply = text;
          pendingOut.answeredAt = new Date().toISOString();

          const assignedQueueNo = Number(stateData.nextQueueNumber) || 61;
          stateData.nextQueueNumber = assignedQueueNo + 1;
          const appt = assignNextAppointmentSlot(canonicalKey, msg.pushName || 'Davetli Kişi', text, assignedQueueNo);
          saveData();

          const confirmSpeech =
            `Çok teşekkür ederim. Yanıtınızı ve uygunluk bilginizi Yasin Eren Bey'e ilettim ve takvimine kaydettim. İyi günler dilerim.`;
          await sendVoiceNote(remoteJid, confirmSpeech);
          const sentAck = await sock.sendMessage(remoteJid, {
            text:
              `✅ *Teşekkür ederim!* Yanıtınız (*"${text}"*) Yasin Eren Bey'e iletildi ve takvim kaydınız oluşturuldu (Kayıt No: *#${appt.id}*).\n\n— *Avelon | Eren Bey'in Yapay Zeka Sekreteri* 🤖`,
          });
          if (sentAck?.key?.id) botSentMsgIds.add(sentAck.key.id);

          await notifyOwnerSelfChat(
            `🔔 *PATRON! ARATTIĞIN NUMARADAN CEVAP GELDİ!* 🎯\n\n` +
            `👤 *Kişi:* ${msg.pushName || 'Bilinmiyor'} (+${canonicalKey})\n` +
            `❓ *Senin Sorduğun:* "${pendingOut.question}"\n` +
            `💬 *Kişinin Cevabı:* *"${text}"*\n` +
            `📅 *Takvim Kayıt No:* #${appt.id}\n\n` +
            `⚡ Onaylamak için: *.onayla ${appt.id}*\n` +
            `⚡ Saat değiştirmek için: *.ertele ${appt.id} Yarın 15:00*`
          );
          continue;
        }

        // ÖZEL TETİKLEYİCİ: "Sen kimsin?", "Avelon kim?", "Bot musun?", "Sekreter mi?" diye sorulursa:
        const lowerText = text.toLocaleLowerCase('tr-TR').trim();
        const isAskingWho =
          lowerText.includes('sen kimsin') ||
          lowerText.includes('siz kimsiniz') ||
          lowerText.includes('avelon kim') ||
          lowerText.includes('avelon ne') ||
          lowerText.includes('bot musun') ||
          lowerText.includes('sekreter mi') ||
          lowerText === 'kimsin' ||
          lowerText === 'kimsiniz' ||
          lowerText === 'bu kim';

        if (isAskingWho) {
          console.log(`🎩 "Sen kimsin?" sorusu yakalandı (+${canonicalKey}): "${text}"`);
          await sendVoiceNote(remoteJid, stateData.whoAreYouReplyText || defaultData.whoAreYouReplyText);
          const sent = await sock.sendMessage(remoteJid, {
            text: stateData.whoAreYouReplyText || defaultData.whoAreYouReplyText,
          });
          if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
          continue;
        }

        // ÖZEL TETİKLEYİCİ: Herhangi biri (Kayıtlı veya Yabancı) açıkça "randevu / toplantı / görüşelim / müsait mi" derse:
        const isAskingAppointment =
          lowerText.includes('randevu') ||
          lowerText.includes('toplantı') ||
          lowerText.includes('toplanti') ||
          lowerText.includes('görüşelim') ||
          lowerText.includes('goruselim') ||
          lowerText.includes('müsait mi') ||
          lowerText.includes('musait mi');

        if (isAskingAppointment && (isKnownPerson(rawNum) || isKnownPerson(canonicalKey))) {
          const contactName =
            stateData.knownNumbers[canonicalKey]?.name || msg.pushName || 'Rehber Kişisi';
          const assignedQueueNo = Number(stateData.nextQueueNumber) || 61;
          stateData.nextQueueNumber = assignedQueueNo + 1;
          const appt = assignNextAppointmentSlot(canonicalKey, contactName, text, assignedQueueNo);

          const speechTxt =
            `Merhabalar ${contactName}, ben Yasin Eren Bey'in yapay zeka yönetici sekreteri Avelon. ` +
            `Eren Bey şu anda müsait değil ancak görüşme talebiniz için size ${appt.fullSlotLabel} saatine ön randevu oluşturdum ve kendisine hemen bilgi verdim.`;
          await sendVoiceNote(remoteJid, speechTxt);

          const replyTxt =
            `📅 *AVELON RANDEVU & ÖZEL KALEM SİSTEMİ* 🤖\n\n` +
            `Merhabalar *${contactName}*, Eren Bey şu an müsait olmadığı için görüşme talebinizi takvime işledim:\n\n` +
            `🗓️ *Randevu Tarihi:* ${appt.fullSlotLabel}\n` +
            `🔢 *Randevu Sıra / Kod:* #${appt.id} (${appt.code})\n\n` +
            `Eren Bey müsait olduğunda randevunuzu onaylayıp size dönüş sağlayacaktır.`;
          const sent = await sock.sendMessage(remoteJid, { text: replyTxt });
          if (sent?.key?.id) botSentMsgIds.add(sent.key.id);

          await notifyOwnerSelfChat(
            `📅 *YENİ RANDEVU TALEBİ (REHBERDEN)* 🤖\n\n` +
            `👤 *Kişi:* ${contactName} (+${canonicalKey})\n` +
            `💬 *Mesajı:* "${text}"\n` +
            `🕒 *Atanan Randevu:* *${appt.fullSlotLabel}* (Kod: #${appt.id})\n\n` +
            `⚡ *Hızlı Komutlar:*\n` +
            `• *.onayla ${appt.id}*\n` +
            `• *.ertele ${appt.id} Yarın 16:00*\n` +
            `• *.iptal ${appt.id}*`
          );
          continue;
        }

        // 3) DURUM A: KAYITLI KİŞİ (Rehberde olan kişi — Örn: Annen)
        if (isKnownPerson(rawNum) || isKnownPerson(canonicalKey)) {
          if (!stateData.replyToKnownContacts) continue;

          const entry =
            stateData.knownNumbers[canonicalKey] ||
            stateData.knownNumbers[rawNum] ||
            (stateData.knownNumbers[canonicalKey] = {
              name: msg.pushName || 'Rehber Kişisi',
              source: 'Rehber',
              addedAt: new Date().toISOString(),
              lastAutoReplyAt: 0,
            });

          if (
            msg.pushName &&
            !entry.customName &&
            (!entry.name || entry.name.startsWith('Aktif Rehber') || entry.name.startsWith('Rehber'))
          ) {
            entry.name = msg.pushName;
          }

          const lastReply = entry.lastAutoReplyAt || 0;
          // Aynı kişiye en az 6 saatte (360 dk) sadece 1 kez oto-sekreter mesajı at (üst üste mesaj atmasını önler!)
          const cooldownMs = Math.max(360, Number(stateData.knownCooldownMinutes) || 360) * 60 * 1000;

          if (Date.now() - lastReply < cooldownMs) {
            console.log(`⏳ Kayıtlı kişi (${entry.name}) 6 saatlik bekleme süresinde olduğu için tekrar yazılmadı.`);
            continue;
          }

          entry.lastAutoReplyAt = Date.now();
          if (stateData.knownNumbers[rawNum]) {
            stateData.knownNumbers[rawNum].lastAutoReplyAt = Date.now();
          }
          saveData();

          console.log(`📒 Kayıtlı kişiye (${entry.name} - +${canonicalKey}) Avelon yanıt gönderiyor...`);

          const delayMs = Math.max(1, Number(stateData.replyDelaySec) || 2) * 1000;
          await sock.sendPresenceUpdate('composing', remoteJid);
          setTimeout(async () => {
            try {
              const sent = await sock.sendMessage(remoteJid, {
                text: stateData.knownReplyText,
              });
              if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
              await sock.sendPresenceUpdate('paused', remoteJid);
            } catch (e) {
              console.error('Kayıtlı kişiye yanıt hatası:', e.message);
            }
          }, delayMs);
          continue;
        }

        // 4) DURUM B: KAYITLI OLMAYAN KİŞİ (Yabancı Numara) + GERÇEK TARİH/SAAT RANDEVU + 8 MESAJ ENGEL
        const pushName = msg.pushName || 'Bilinmeyen Numara';
        let stranger = stateData.strangerStages[canonicalKey] || stateData.strangerStages[rawNum];

        if (!stranger) {
          const assignedQueueNo = Number(stateData.nextQueueNumber) || 60;
          stateData.nextQueueNumber = assignedQueueNo + 1;

          stranger = {
            stage: 1,
            jid: remoteJid,
            phone: canonicalKey,
            pushName,
            queueNo: assignedQueueNo,
            msgCount: 1,
            blocked: false,
            firstMsg: text,
            introMsg: '',
            updatedAt: new Date().toISOString(),
          };
          stateData.strangerStages[canonicalKey] = stranger;
          saveData();

          console.log(`🕵️ Yabancı Numara (1. Mesaj) [+${canonicalKey} - ${pushName}]: "${text}"`);

          const delayMs = Math.max(1, Number(stateData.replyDelaySec) || 2) * 1000;
          await sock.sendPresenceUpdate('composing', remoteJid);
          setTimeout(async () => {
            try {
              const sent = await sock.sendMessage(remoteJid, {
                text: stateData.firstReplyText,
              });
              if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
              await sock.sendPresenceUpdate('paused', remoteJid);
            } catch (e) {
              console.error('Yabancıya 1. yanıt hatası:', e.message);
            }
          }, delayMs);
          continue;
        }

        stranger.msgCount = (stranger.msgCount || 1) + 1;
        stranger.jid = remoteJid;
        stranger.updatedAt = new Date().toISOString();
        const maxLimit = Number(stateData.maxStrangerMessages) || 8;

        // 2. Mesaj: Kendini tanıttı -> Gerçek Tarih & Saatli Randevu + Sesli Sekreter Onayı + Eren'in "Siz" Sohbetine Rapor!
        if (stranger.msgCount === 2 && stranger.stage === 1) {
          stranger.stage = 2;
          stranger.introMsg = text;
          const qNo = stranger.queueNo || 60;
          const appt = assignNextAppointmentSlot(canonicalKey, pushName, `${stranger.firstMsg} | ${text}`, qNo);
          stranger.appointmentSlot = appt.fullSlotLabel;
          saveData();

          const formattedSecondReply =
            `Teşekkür ederim, kimlik bilgilerinizi ve notunuzu Yasin Eren Bey'e sundum 📝\n\n` +
            `📅 *Randevu Tarih & Saatiniz:* ${appt.fullSlotLabel}\n` +
            `🔢 *Görüşme Sıranız:* ${qNo}. Sıradasınız (Kayıt Kodu: #${appt.code})\n` +
            `⏳ Eren Bey programındaki yoğunluğa göre randevu saatinizde size dönüş sağlayacaktır.\n\n` +
            `🎼 Sıranızı beklerken dinlemeniz için Avelon Özel Kalem Bekleme Salonu müziğimiz:\n` +
            `https://www.youtube.com/watch?v=quxTnEEETbo\n` +
            `— *Avelon | Eren Bey'in Yapay Zeka Sekreteri* 🤖`;

          console.log(`📝 Yabancı Kendini Tanıttı (2. Mesaj -> ${qNo}. Sıra | ${appt.fullSlotLabel}) [+${canonicalKey} - ${pushName}]: "${text}"`);

          const voiceConfirm =
            `Teşekkür ederim. Bilgilerinizi ve notunuzu Yasin Eren Bey'e ilettim. ` +
            `Size ${appt.fullSlotLabel} için ${qNo} numaralı randevu sırası oluşturdum. Eren Bey müsait olduğunda size dönüş sağlayacaktır.`;

          setTimeout(async () => {
            try {
              await sendVoiceNote(remoteJid, voiceConfirm);
              const sent = await sock.sendMessage(remoteJid, {
                text: formattedSecondReply,
              });
              if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
            } catch (e) {
              console.error('Yabancıya 2. yanıt hatası:', e.message);
            }
          }, 1500);

          // Patron Eren'in "Siz" sohbetine anında bildir!
          await notifyOwnerSelfChat(
            `📋 *AVELON YENİ RANDEVU & KİMLİK RAPORU* 🤖\n\n` +
            `👤 *Kişi:* ${pushName} (+${canonicalKey})\n` +
            `💬 *İlk Mesajı:* "${stranger.firstMsg}"\n` +
            `🪪 *Kendini Tanıttığı Mesaj:* "${text}"\n` +
            `📅 *Verilen Randevu:* *${appt.fullSlotLabel}* (Sıra: #${qNo})\n\n` +
            `⚡ *Hızlı Patron Komutları (Buraya yazabilirsin):*\n` +
            `• *.onayla ${qNo}* → Randevuyu sesli onaylar\n` +
            `• *.ertele ${qNo} Yarın 16:00* → Saati değiştirir\n` +
            `• *.iptal ${qNo}* → Görüşmeyi iptal eder\n` +
            `• *.engel ${qNo}* → Fotoğraflı %80 dolandırıcı raporuyla engeller`
          );
          continue;
        }

        // 8. Mesaj: Kişinin kendi fotoğrafını atıp "%80 Dolandırıcı gözüküyor, engellendiniz" mesajı gönder ve otomatik engelle!
        if (stranger.msgCount >= maxLimit && !stranger.blocked) {
          stranger.stage = 3;
          stranger.blocked = true;
          stranger.introMsg = `${stranger.introMsg ? stranger.introMsg + ' | ' : ''}[${stranger.msgCount}. Mesaj]: ${text}`;
          saveData();

          console.log(`🚫 Yabancı Numara ${stranger.msgCount} mesaj attı! Fotoğrafı çekilip %80 dolandırıcı raporuyla engelleniyor: +${canonicalKey}`);
          await executeScamPhotoAndBlock(remoteJid, canonicalKey);
          continue;
        }

        stranger.introMsg = `${stranger.introMsg ? stranger.introMsg + ' | ' : ''}${text}`;
        saveData();
      } catch (err) {
        console.error('Mesaj işleme hatası:', err.message);
      }
    }
  });

  // Gelen WhatsApp Sesli / Görüntülü Aramalarını Dinle:
  // 1) Mac'te Avelon hemen sesli olarak: "Efendim, [Kişi] sizi arıyor, açayım mı?" diye sorar!
  // 2) Patron "Kapat / Açma / Sen konuş" derse aramayı meşgule atar (sock.rejectCall) ve Avelon sesli sekreter olarak konuşur!
  const recentCallReplies = {};
  const processedCallIds = new Set();
  sock.ev.on('call', async (calls) => {
    const callList = Array.isArray(calls) ? calls : [calls];

    for (const call of callList) {
      try {
        if (!call || (call.status !== 'offer' && call.status !== 'ringing') || call.isGroup) continue;
        if (call.id && processedCallIds.has(call.id)) continue;
        if (call.id) processedCallIds.add(call.id);

        const rawFrom = call.from || call.chatId || '';
        const rawPn = call.callerPn || '';
        const callerJid = rawPn || rawFrom;
        if (!callerJid || callerJid.endsWith('@g.us')) continue;

        const rawNum = cleanNumber(callerJid);
        const lidNum = rawFrom.endsWith('@lid') ? cleanNumber(rawFrom) : '';
        const pnNum = rawPn ? cleanNumber(rawPn) : '';
        if (lidNum && pnNum && lidNum !== pnNum) {
          lidToPhone[lidNum] = pnNum;
          phoneToLid[pnNum] = lidNum;
        }

        const canonicalKey = pnNum || getCanonicalKey(rawNum) || rawNum;
        if (!canonicalKey) continue;

        if (recentCallReplies[canonicalKey] && Date.now() - recentCallReplies[canonicalKey] < 12 * 1000) {
          continue;
        }
        recentCallReplies[canonicalKey] = Date.now();

        const isKnown = isKnownPerson(rawNum) || isKnownPerson(canonicalKey) || (lidNum && isKnownPerson(lidNum));
        const entry =
          stateData.knownNumbers[canonicalKey] ||
          stateData.knownNumbers[rawNum] ||
          (lidNum ? stateData.knownNumbers[lidNum] : null);
        const strangerEntry =
          stateData.strangerStages?.[canonicalKey] ||
          stateData.strangerStages?.[rawNum] ||
          (lidNum ? stateData.strangerStages?.[lidNum] : null);
        const formattedPhone = canonicalKey.startsWith('90')
          ? `0${canonicalKey.slice(2, 5)} ${canonicalKey.slice(5, 8)} ${canonicalKey.slice(8, 10)} ${canonicalKey.slice(10)}`
          : `+${canonicalKey}`;
        const rawEntryName =
          entry?.name && entry.name !== 'Aktif Rehber Kişisi' ? entry.name : null;
        const callerName =
          rawEntryName ||
          (strangerEntry?.pushName && strangerEntry.pushName !== 'Arayan Numara' ? strangerEntry.pushName : null) ||
          (isKnown ? `Rehberdeki Kişiniz (${formattedPhone})` : `Kayıtsız Numara (${formattedPhone})`);

        const callTypeLabel = call.isVideo ? 'görüntülü aramanızı' : 'sesli aramanızı';

        const spokenAlert = `Efendim, şu an ${callerName} sizi ${call.isVideo ? 'görüntülü olarak ' : ''}arıyor. Açayım mı, yoksa sekreter olarak ben mi konuşayım?`;

        globalThis.lastIncomingCall = {
          callId: call.id || 'CALL-' + Date.now(),
          callFrom: rawFrom || callerJid,
          callerJid: pnNum ? `${pnNum}@s.whatsapp.net` : callerJid,
          canonicalKey,
          rawNum,
          callerName,
          isKnown,
          isVideo: Boolean(call.isVideo),
          spokenAlert,
          audioBase64: null,
          phoneAnnounced: false,
          decision: null, // 'accept' | 'reject'
          timestamp: Date.now(),
        };

        // 1) Mac'teki Avelon'a ANINDA sesli anons görevi gönder ("Efendim, şu kişi sizi arıyor, açayım mı?")
        stateData.gemiTasks = stateData.gemiTasks || [];
        stateData.gemiTasks.push({
          id: 'GEMI-CALL-' + Date.now(),
          prompt:
            '__INCOMING_CALL__:' +
            JSON.stringify({
              callId: globalThis.lastIncomingCall.callId,
              callFrom: globalThis.lastIncomingCall.callFrom,
              callerName,
              phone: canonicalKey,
              isVideo: Boolean(call.isVideo),
              isKnown,
            }),
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
        saveData();

        // Telefon (/jarvis) için ses dosyasını hazırla + WhatsApp "Siz" sohbetine de sesli anons at
        generateNeuralMp3Buffer(spokenAlert)
          .then(({ fullMp3 }) => {
            if (fullMp3 && globalThis.lastIncomingCall?.callId === (call.id || globalThis.lastIncomingCall?.callId)) {
              globalThis.lastIncomingCall.audioBase64 = fullMp3.toString('base64');
            }
          })
          .catch(() => {});
        sendVoiceNote('905525222988@s.whatsapp.net', spokenAlert).catch(() => {});
        sendDirectPhonePush(
          `📞 Efendim, ${callerName} Sizi Arıyor!`,
          `🗣️ "Efendim, ${callerName} sizi arıyor, açayım mı?" (.kapat yazarsanız Avelon meşgule atıp konuşur)`,
          { type: 'incoming_call', callerName, phone: canonicalKey }
        ).catch(() => {});

        // 2) Patron'un "Siz" sohbetine anlık bildirim at
        notifyOwnerSelfChat(
          `📞 *GELEN ARAMA ALGILANDI!* 🚨\n\n` +
            `👤 *Arayan:* *${callerName}* (+${canonicalKey})\n` +
            `📱 *Tür:* ${call.isVideo ? 'Görüntülü Arama 📹' : 'Sesli Arama 📞'}\n` +
            `🗣️ *Avelon:* _"Efendim, ${callerName} sizi arıyor, açayım mı?"_\n\n` +
            `🎙️ *Mac'e sesli olarak "Aç" veya "Kapat / Sen konuş" diyebilirsiniz!*`
        ).catch(() => {});

        // 3) Eğer Oto-Sekreter (stateData.enabled) açıksa ve Patron 11 saniye içinde "Aç" demediyse otomatik sekreter devreye girsin
        setTimeout(async () => {
          try {
            const current = globalThis.lastIncomingCall;
            if (current && current.callId === call.id && current.decision) {
              // Patron zaten sesli/yazılı karar verdi (accept veya reject işlendi)
              return;
            }
            if (!stateData.enabled) return;

            if (isKnown) {
              if (!stateData.replyToKnownContacts) return;
              const voiceCallReply =
                `Merhabalar, ben Avelon, Yasin Eren Bey'in yapay zeka yönetici sekreteriyim. ` +
                `Şu an Eren Bey müsait değil, müsait olunca sizi arayacaktır. Acil bir notunuz varsa bana buradan iletebilirsiniz.`;
              await sendVoiceNote(callerJid, voiceCallReply);

              const callReplyText =
                `🎙️ *AVELON SESLİ SEKRETER YANITI*\n\n` +
                `Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim.\n\n` +
                `Şu an Eren Bey müsait olmadığı için ${callTypeLabel} açamadı; **müsait olunca sizi arayacaktır.** Acil bir notunuz varsa bana yazabilirsiniz, kendisine hemen ileteceğim.`;
              const sent = await sock.sendMessage(callerJid, { text: callReplyText });
              if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
            } else {
              let stranger = stateData.strangerStages[canonicalKey] || stateData.strangerStages[rawNum];
              if (!stranger) {
                const assignedQueueNo = Number(stateData.nextQueueNumber) || 60;
                stateData.nextQueueNumber = assignedQueueNo + 1;
                stranger = {
                  stage: 1,
                  jid: callerJid,
                  phone: canonicalKey,
                  pushName: 'Arayan Numara',
                  queueNo: assignedQueueNo,
                  msgCount: 1,
                  blocked: false,
                  firstMsg: `[WhatsApp ${call.isVideo ? 'Görüntülü' : 'Sesli'} Arama]`,
                  introMsg: '',
                  updatedAt: new Date().toISOString(),
                };
                stateData.strangerStages[canonicalKey] = stranger;
                saveData();
              }

              const voiceCallStranger =
                `Merhabalar, ben Avelon, Yasin Eren Bey'in yapay zeka yönetici sekreteriyim. ` +
                `Şu an Eren Bey müsait değil, müsait olunca dönüş yapacaktır. Numaranız özel rehberde kayıtlı görünmüyor; lütfen kim olduğunuzu ve hangi konuda aradığınızı yazılı olarak iletin, size hemen randevu sırası oluşturayım.`;
              await sendVoiceNote(callerJid, voiceCallStranger);

              const sent = await sock.sendMessage(callerJid, {
                text: stateData.firstReplyText,
              });
              if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
            }
          } catch (e) {
            console.error('Arama yanıt hatası:', e.message);
          }
        }, 11000);
      } catch (err) {
        console.error('Arama işleme hatası:', err.message);
      }
    }
  });
}

// ================= WEB KONTROL PANELİ (PORT 4040) =================
const app = express();
app.use(express.json());

app.get('/api/status', (req, res) => {
  const uniqueKnownPhones = new Set();
  for (const k of Object.keys(stateData.knownNumbers)) {
    uniqueKnownPhones.add(lidToPhone[k] || k);
  }
  res.json({
    connectionStatus,
    connectedUser,
    qr: currentQRDataURL,
    pairingCode: currentPairingCode,
    enabled: stateData.enabled,
    replyToKnownContacts: stateData.replyToKnownContacts,
    knownCooldownMinutes: stateData.knownCooldownMinutes || 3,
    replyDelaySec: stateData.replyDelaySec,
    maxStrangerMessages: stateData.maxStrangerMessages || 8,
    autoBlockOnMax: stateData.autoBlockOnMax !== false,
    nextQueueNumber: stateData.nextQueueNumber || 60,
    firstReplyText: stateData.firstReplyText,
    secondReplyText: stateData.secondReplyText,
    blockWarningText: stateData.blockWarningText,
    knownReplyText: stateData.knownReplyText,
    knownCount: uniqueKnownPhones.size,
    strangers: stateData.strangerStages,
    appointments: stateData.appointments || {},
    pendingOutreach: stateData.pendingOutreach || {},
    voiceProfile: stateData.voiceProfile || 'emel',
    gemiTasks: stateData.gemiTasks || [],
  });
});

// Uzaktan @gemi Talimatlarını Mac (Antigravity) İçin Listeleme & Tamamlama Endpoint'leri
app.get('/api/gemi-tasks', (req, res) => {
  const tasks = (stateData.gemiTasks || []).filter((t) => t.status === 'pending');
  res.json({ ok: true, tasks });
});

app.post('/api/gemi-tasks/complete', async (req, res) => {
  try {
    const { id, replyText, voiceText } = req.body || {};
    stateData.gemiTasks = stateData.gemiTasks || [];
    const found = stateData.gemiTasks.find((t) => t.id === id);
    if (found) {
      found.status = 'completed';
      found.completedAt = new Date().toISOString();
      found.replyText = replyText || '';
      saveData();
    }
    if (replyText) {
      await notifyOwnerSelfChat(`✅ *@GEMİ GÖREVİ TAMAMLADI!* 🤖\n\n${replyText}`);
    }
    if (voiceText) {
      await sendVoiceNote('905525222988@s.whatsapp.net', voiceText);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Telefon (/jarvis) ve AvelonJarvis.apk için Canlı Gelen Arama Yoklama Endpoint'i
app.get('/api/incoming-call-poll', async (req, res) => {
  try {
    const cur = globalThis.lastIncomingCall;
    if (!cur || Date.now() - cur.timestamp > 30000) {
      return res.json({ active: false });
    }
    if (cur.decision) {
      return res.json({
        active: false,
        callId: cur.callId,
        decision: cur.decision,
        callerName: cur.callerName,
        isGsm: Boolean(cur.isGsm),
      });
    }
    if (!cur.audioBase64 && cur.spokenAlert) {
      try {
        const { fullMp3 } = (await generateNeuralMp3Buffer(cur.spokenAlert)) || {};
        if (fullMp3) cur.audioBase64 = fullMp3.toString('base64');
      } catch (_) {}
    }
    res.json({
      active: true,
      callId: cur.callId,
      callerName: cur.callerName,
      phone: cur.canonicalKey,
      isVideo: cur.isVideo,
      isGsm: Boolean(cur.isGsm),
      decision: cur.decision || '',
      spokenAlert: cur.spokenAlert || `Efendim, şu an ${cur.callerName} sizi arıyor, açayım mı?`,
      audioBase64: cur.audioBase64 || null,
    });
  } catch (err) {
    res.json({ active: false });
  }
});

// 📲 TATAR ENDÜSTRİ ÖZEL AVELON JARVIS ANDROID APK İNDİRME ENDPOINT'İ
app.get('/avelon.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'AvelonJarvis.apk');
  if (!fs.existsSync(apkPath)) {
    return res.status(404).send('AvelonJarvis.apk bulunamadı.');
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="AvelonJarvis.apk"');
  res.sendFile(apkPath);
});

// Gelen Arama Karar Endpoint'i (Mac'ten veya Telefondan Sesli "Aç" veya "Kapat / Sen Konuş" denildiğinde)
app.post('/api/call-action', async (req, res) => {
  try {
    const { action, customMessage } = req.body || {};
    const current = globalThis.lastIncomingCall;
    if (!current) {
      return res.json({ ok: false, message: 'Aktif gelen arama bulunamadı.' });
    }

    if (action === 'accept') {
      current.decision = 'accept';
      await notifyOwnerSelfChat(`✅ *ARAMA SİZE BIRAKILDI PATRON!* 📞 (${current.callerName})`);
      return res.json({ ok: true, action: 'accept', callerName: current.callerName });
    }

    if (action === 'reject' || action === 'secretary') {
      current.decision = 'reject';
      // 1) Çalan WhatsApp aramasını telefondan meşgule at (kapat)
      if (sock && current.callId && current.callFrom) {
        try {
          await sock.rejectCall(current.callId, current.callFrom);
        } catch (rejErr) {
          console.warn('rejectCall uyarısı:', rejErr.message);
        }
      }

      // 2) Arayan kişiye Avelon Sesli Sekreter kaydı + mesaj gönder
      const callerJid = current.callerJid;
      const voiceText =
        customMessage ||
        `Merhabalar, ben Avelon, Yasin Eren Bey'in yapay zeka yönetici sekreteriyim. ` +
          `Şu an Eren Bey müsait olmadığı için aramanızı ben karşıladım; kendisi müsait olunca sizi arayacaktır. Acil bir notunuz varsa bana buradan iletebilirsiniz.`;

      if (sock && callerJid) {
        await sendVoiceNote(callerJid, voiceText).catch(() => {});
        const textMsg =
          `🎙️ *AVELON SESLİ SEKRETER YANITI*\n\n` +
          `Merhabalar, ben Avelon 🤖 Yasin Eren Bey'in Yapay Zeka Yönetici Sekreteriyim.\n\n` +
          `Şu an Eren Bey müsait olmadığı için aramanızı açamadı; **müsait olunca sizi arayacaktır.** Acil bir notunuz varsa bana yazabilirsiniz, kendisine hemen ileteceğim.`;
        const sent = await sock.sendMessage(callerJid, { text: textMsg }).catch(() => null);
        if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
      }

      await notifyOwnerSelfChat(
        `🛡️ *ARAMA MEŞGULE ATILDI & AVELON SEKRETER DEVREYE GİRDİ!* 🎙️\n\n` +
          `👤 *Arayan:* ${current.callerName} (+${current.canonicalKey})\n` +
          `🗣️ *Avelon:* Aramayı kapattı ve sesli sekreter mesajınızı iletti.`
      );

      return res.json({ ok: true, action: 'reject', callerName: current.callerName });
    }

    res.json({ ok: false, message: 'Geçersiz aksiyon' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Normal GSM / Şebeke Aramaları İçin Webhook (MacroDroid / Tasker / Kestirmeler Köprüsü - GET ve POST destekler)
app.all('/api/incoming-gsm-call', async (req, res) => {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const callerNumber = src.callerNumber || src.caller || src.number || src.phone || '';
    const rawName = src.callerName || src.name || '';
    const cleanNum = normalizeTRPhone(String(callerNumber || ''));
    const canonicalKey = getCanonicalKey(cleanNum) || cleanNum;
    const entry = stateData.knownNumbers[canonicalKey] || stateData.knownNumbers[cleanNum];
    const cleanRawName =
      rawName && !String(rawName).includes('{') && String(rawName).trim() ? String(rawName).trim() : '';
    const callerName =
      cleanRawName ||
      (entry?.name && entry.name !== 'Aktif Rehber Kişisi' ? entry.name : null) ||
      (canonicalKey ? `+${canonicalKey}` : 'Bilinmeyen Numara');

    const callId = 'GSM-' + Date.now();
    const spokenAlert = `Efendim, şu an ${callerName} sizi normal hattan arıyor. Açayım mı, yoksa sekreter olarak ben mi konuşayım?`;

    globalThis.lastIncomingCall = {
      callId,
      callFrom: canonicalKey ? `${canonicalKey}@s.whatsapp.net` : '',
      callerJid: canonicalKey ? `${canonicalKey}@s.whatsapp.net` : '',
      canonicalKey,
      rawNum: cleanNum,
      callerName,
      isKnown: Boolean(entry),
      isVideo: false,
      isGsm: true,
      spokenAlert,
      audioBase64: null,
      decision: null,
      timestamp: Date.now(),
    };

    stateData.gemiTasks = stateData.gemiTasks || [];
    stateData.gemiTasks.push({
      id: 'GEMI-GSM-CALL-' + Date.now(),
      prompt:
        '__INCOMING_CALL__:' +
        JSON.stringify({
          callId,
          callFrom: globalThis.lastIncomingCall.callFrom,
          callerName,
          phone: canonicalKey,
          isVideo: false,
          isGsm: true,
        }),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    saveData();

    generateNeuralMp3Buffer(spokenAlert)
      .then(({ fullMp3 }) => {
        if (fullMp3 && globalThis.lastIncomingCall?.callId === callId) {
          globalThis.lastIncomingCall.audioBase64 = fullMp3.toString('base64');
        }
      })
      .catch(() => {});

    sendVoiceNote('905525222988@s.whatsapp.net', spokenAlert).catch(() => {});
    notifyOwnerSelfChat(
      `📞 *GELEN ŞEBEKE (GSM) ARAMASI ALGILANDI!* 🚨\n\n` +
        `👤 *Arayan:* *${callerName}* ${canonicalKey ? `(+${canonicalKey})` : ''}\n` +
        `🗣️ *Avelon:* _"${spokenAlert}"_`
    ).catch(() => {});

    res.json({ ok: true, callId, callerName, spokenAlert });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Yeni Neural HD Stüdyo Sesini Test Etme ve Değiştirme Endpoint'i
app.post('/api/test-voice', async (req, res) => {
  try {
    const { voice, text, target } = req.body || {};
    if (voice && VOICE_PROFILES[voice]) {
      stateData.voiceProfile = voice;
      saveData();
    }
    const targetJid = target || '905525222988@s.whatsapp.net';
    const sampleText =
      text ||
      'Merhabalar Eren Bey, ben özel yönetici sekreteriniz Avelon. Yeni stüdyo kalitesindeki doğal sesimle aramalarınızı karşılamaya ve randevularınızı yönetmeye hazırım.';
    const sent = await sendVoiceNote(targetJid, sampleText, voice || stateData.voiceProfile);
    res.json({
      ok: Boolean(sent),
      voiceProfile: stateData.voiceProfile,
      id: sent?.key?.id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Patron Eren'in Herhangi Bir Numaraya Sesli Sekreter Göndermesi ("Yarın için müsait misiniz?")
app.post('/api/outreach-call', async (req, res) => {
  try {
    const { number, question } = req.body;
    if (!number) return res.status(400).json({ error: 'Numara gerekli' });
    const result = await executeOutreachCallAndAsk(
      number,
      question || 'Yarın için müsait misiniz?'
    );
    if (!result.ok) return res.status(400).json(result);
    await notifyOwnerSelfChat(
      `🎙️ *AVELON SESLİ SEKRETER ARAMASI BAŞLATILDI (Web Panel)*\n\n` +
        `📞 *Aranan Numara:* +${result.phone}\n` +
        `🗣️ *Okunan Sesli Mesaj:* _"${result.spoken}"_\n\n` +
        `⏳ Karşı taraf cevap verdiğinde otomatik randevu saatini bağlayıp sana buradan haber vereceğim.`
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  const {
    enabled,
    replyToKnownContacts,
    knownCooldownMinutes,
    replyDelaySec,
    maxStrangerMessages,
    autoBlockOnMax,
    nextQueueNumber,
    firstReplyText,
    secondReplyText,
    blockWarningText,
    knownReplyText,
  } = req.body;
  if (typeof enabled === 'boolean') stateData.enabled = enabled;
  if (typeof replyToKnownContacts === 'boolean')
    stateData.replyToKnownContacts = replyToKnownContacts;
  if (knownCooldownMinutes !== undefined)
    stateData.knownCooldownMinutes = Number(knownCooldownMinutes) || 3;
  if (replyDelaySec !== undefined) stateData.replyDelaySec = Number(replyDelaySec) || 2;
  if (maxStrangerMessages !== undefined)
    stateData.maxStrangerMessages = Number(maxStrangerMessages) || 8;
  if (typeof autoBlockOnMax === 'boolean') stateData.autoBlockOnMax = autoBlockOnMax;
  if (nextQueueNumber !== undefined) stateData.nextQueueNumber = Number(nextQueueNumber) || 60;
  if (typeof firstReplyText === 'string') stateData.firstReplyText = firstReplyText;
  if (typeof secondReplyText === 'string') stateData.secondReplyText = secondReplyText;
  if (typeof blockWarningText === 'string') stateData.blockWarningText = blockWarningText;
  if (typeof knownReplyText === 'string') stateData.knownReplyText = knownReplyText;
  saveData();
  res.json({ ok: true });
});

app.post('/api/whitelist', (req, res) => {
  const { number, name } = req.body;
  const clean = normalizeTRPhone(number || '');
  if (!clean) return res.status(400).json({ error: 'Geçersiz numara' });
  stateData.knownNumbers[clean] = {
    ...(stateData.knownNumbers[clean] || {}),
    name: name || 'Manuel Eklendi',
    customName: true,
    source: 'Manuel',
    addedAt: new Date().toISOString(),
    lastAutoReplyAt: 0,
  };
  const mappedLid = phoneToLid[clean];
  if (mappedLid) {
    stateData.knownNumbers[mappedLid] = {
      ...(stateData.knownNumbers[mappedLid] || {}),
      name: name || 'Manuel Eklendi',
      customName: true,
      phone: clean,
      source: 'Manuel',
      addedAt: new Date().toISOString(),
      lastAutoReplyAt: 0,
    };
  }
  delete stateData.strangerStages[clean];
  saveData();
  res.json({ ok: true });
});

// Telefondaki Gerçek Rehber İsimlerini (Babam, Annem, Kardeşim vb.) Tek Tıkla Avelon'a Aktarma Endpoint'i
app.post('/api/sync-phone-contacts', (req, res) => {
  try {
    const { contacts } = req.body || {};
    if (!Array.isArray(contacts)) return res.status(400).json({ error: 'contacts dizisi gerekli' });
    let count = 0;
    for (const item of contacts) {
      const savedName = Array.isArray(item.name) ? item.name[0] : item.name;
      const tels = Array.isArray(item.tel) ? item.tel : [item.tel];
      if (!savedName || !String(savedName).trim()) continue;
      for (const rawTel of tels) {
        const clean = normalizeTRPhone(String(rawTel || ''));
        if (!clean || clean.length < 10) continue;
        stateData.knownNumbers[clean] = {
          ...(stateData.knownNumbers[clean] || {}),
          name: String(savedName).trim(),
          customName: true,
          source: 'Telefon Rehberi (Özel İsim)',
          addedAt: new Date().toISOString(),
          lastAutoReplyAt: stateData.knownNumbers[clean]?.lastAutoReplyAt || 0,
        };
        const lid = phoneToLid[clean] || stateData.knownNumbers[clean]?.lid;
        if (lid) {
          stateData.knownNumbers[lid] = {
            ...(stateData.knownNumbers[lid] || {}),
            name: String(savedName).trim(),
            customName: true,
            phone: clean,
            source: 'Telefon Rehberi (Özel İsim)',
            addedAt: new Date().toISOString(),
            lastAutoReplyAt: stateData.knownNumbers[lid]?.lastAutoReplyAt || 0,
          };
        }
        count++;
      }
    }
    saveData();
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/block-toggle', async (req, res) => {
  try {
    const { number, action } = req.body;
    const clean = cleanNumber(number || '');
    const st = stateData.strangerStages[clean];
    const targetJid = st?.jid || `${clean}@s.whatsapp.net`;
    if (sock) {
      await sock.updateBlockStatus(targetJid, action === 'unblock' ? 'unblock' : 'block');
    }
    if (st) {
      st.blocked = action !== 'unblock';
      saveData();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tek Tuşla Kişinin Fotoğrafını Atıp "%80 Dolandırıcı Gözüküyor, Engellendiniz" Deyip Engelle
app.post('/api/scam-block', async (req, res) => {
  try {
    const { number } = req.body;
    let clean = cleanNumber(number || '');
    if (!clean) return res.status(400).json({ error: 'Numara gerekli' });
    if (clean.startsWith('05') && clean.length === 11) clean = '9' + clean;
    else if (clean.startsWith('5') && clean.length === 10) clean = '90' + clean;

    const st = stateData.strangerStages[clean];
    const targetJid = st?.jid || `${clean}@s.whatsapp.net`;
    await executeScamPhotoAndBlock(targetJid, clean);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset-stranger', (req, res) => {
  const { number } = req.body;
  const clean = cleanNumber(number || '');
  delete stateData.strangerStages[clean];
  saveData();
  res.json({ ok: true });
});

app.post('/api/send-document', async (req, res) => {
  try {
    const { number, filePath, fileName, caption, mimetype } = req.body;
    if (!sock) {
      return res.status(503).json({ error: 'WhatsApp bağlı değil' });
    }
    let clean = cleanNumber(number || '');
    if (!clean) return res.status(400).json({ error: 'Numara gerekli' });
    if (clean.startsWith('05') && clean.length === 11) clean = '9' + clean;
    else if (clean.startsWith('5') && clean.length === 10) clean = '90' + clean;

    const targetJid = number.includes('@') ? number : `${clean}@s.whatsapp.net`;
    const buffer = fs.readFileSync(filePath);
    const sent = await sock.sendMessage(targetJid, {
      document: buffer,
      mimetype: mimetype || 'application/pdf',
      fileName: fileName || 'Dokuman.pdf',
      caption: caption || '',
    });
    if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
    console.log(`📄 Belge Gönderildi -> ${targetJid} (${fileName || filePath})`);
    res.json({ ok: true, id: sent?.key?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Patron Eren'in Kendi "Siz" (905525222988) Sohbetine Önemli Mail & Toplantı Özeti Gönderme
app.post('/api/send-self-note', async (req, res) => {
  try {
    const { text, title } = req.body;
    await notifyOwnerSelfChat(text, title || '🤖 Avelon Bildirimi');
    console.log(`📬 Patron Eren (Siz) sohbetine ve telefonuna önemli bildirim iletildi.`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📞 Uzaktan Telefon Bulucu / Sahte Arama Tetikleyici API (Antigravity & Web Panel için)
app.post('/api/find-my-phone', async (req, res) => {
  try {
    const { source } = req.body || {};
    await startFindMyPhoneSiren(source || 'Antigravity AI Asistan');
    res.json({ ok: true, message: 'Sahte arama ve telefon bulucu siren başlatıldı!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stop-find-my-phone', (req, res) => {
  stopFindMyPhoneSiren(true);
  res.json({ ok: true });
});

app.post('/api/check-mail', async (req, res) => {
  try {
    const summaries = await pollAllMailAccounts(true);
    res.json({ ok: true, summaries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🎙️ AVELON JARVIS — CANLI TELEFON HOPARLÖRÜ TTS & KOMUT API
let cachedWakeMp3Base64 = null;
app.get('/api/jarvis-wake-audio', async (req, res) => {
  try {
    if (!cachedWakeMp3Base64) {
      const { fullMp3 } = (await generateNeuralMp3Buffer('Efendim Patron, sizi dinliyorum!')) || {};
      if (fullMp3) cachedWakeMp3Base64 = fullMp3.toString('base64');
    }
    res.json({ ok: true, audioBase64: cachedWakeMp3Base64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const VALID_JARVIS_PINS = new Set(['1453', '288', '5222988', 'eren288']);

app.post('/api/jarvis-command', async (req, res) => {
  try {
    const { text, alsoSendWhatsApp, pin } = req.body || {};
    const clientPin = String(pin || req.headers['x-jarvis-pin'] || '').trim();
    if (!VALID_JARVIS_PINS.has(clientPin)) {
      const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'bilinmiyor';
      notifyOwnerSelfChat(
        `🚨 *GÜVENLİK UYARISI PATRON!*\nBirisi Avelon Jarvis sistemine yetkisiz şifreyle (\`${clientPin || 'şifresiz'}\`) girmeye çalıştı ve engellendi!\n🌐 *IP:* ${ip}`,
        '🛡️ Avelon Güvenlik'
      ).catch(() => {});
      return res.status(403).json({ ok: false, error: 'Yetkisiz erişim! Sadece Patron Eren kullanabilir.' });
    }
    if (!text) return res.status(400).json({ error: 'Metin gerekli' });
    const jarvisRes = await askJarvisBrain(text);
    if (jarvisRes.ignore) {
      return res.json({ ok: true, ignore: true });
    }
    const { fullMp3 } = (await generateNeuralMp3Buffer(jarvisRes.spoken)) || {};
    const audioBase64 = fullMp3 ? fullMp3.toString('base64') : null;

    if (alsoSendWhatsApp) {
      notifyOwnerSelfChat(jarvisRes.display, '🤖 Avelon Jarvis').catch(() => {});
    }

    res.json({
      ok: true,
      spoken: jarvisRes.spoken,
      display: jarvisRes.display,
      audioBase64,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🦾 AVELON JARVIS — TONY STARK CANLI TELEFON & MASAÜSTÜ SESLİ KOMUTA EKRANI (/jarvis)
app.get('/jarvis', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="theme-color" content="#050811" />
  <title>AVELON JARVIS — Tam Yetki Komuta Merkezi</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
    body {
      background: radial-gradient(circle at center, #0a192f 0%, #040711 100%);
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 20px 16px;
      overflow-x: hidden;
    }
    .top-bar {
      width: 100%;
      max-width: 500px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(56, 189, 248, 0.3);
      box-shadow: 0 0 25px rgba(56, 189, 248, 0.12);
    }
    .brand {
      font-weight: 900;
      font-size: 15px;
      letter-spacing: 1.5px;
      color: #38bdf8;
    }
    .status-pill {
      font-size: 11px;
      font-weight: 800;
      padding: 5px 10px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .reactor-wrap {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin: 14px 0;
    }
    .reactor {
      width: 200px;
      height: 200px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.35) 0%, rgba(14, 165, 233, 0.08) 60%, transparent 75%);
      border: 3px solid rgba(56, 189, 248, 0.65);
      box-shadow: 0 0 45px rgba(56, 189, 248, 0.45), inset 0 0 35px rgba(56, 189, 248, 0.35);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.25s ease;
      position: relative;
    }
    .reactor.listening {
      border-color: #22c55e;
      box-shadow: 0 0 65px rgba(34, 197, 94, 0.65), inset 0 0 40px rgba(34, 197, 94, 0.4);
      animation: pulseGreen 1.6s infinite;
    }
    .reactor.speaking {
      border-color: #f59e0b;
      box-shadow: 0 0 75px rgba(245, 158, 11, 0.75), inset 0 0 45px rgba(245, 158, 11, 0.5);
      animation: pulseGold 0.9s infinite;
    }
    @keyframes pulseGreen {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.06); }
    }
    @keyframes pulseGold {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.09); }
    }
    .reactor-core {
      font-size: 44px;
      margin-bottom: 6px;
    }
    .reactor-label {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #f8fafc;
    }
    .state-title {
      margin-top: 16px;
      font-size: 19px;
      font-weight: 800;
      text-align: center;
      color: #fff;
    }
    .state-sub {
      margin-top: 6px;
      font-size: 13px;
      color: #94a3b8;
      text-align: center;
      max-width: 360px;
      line-height: 1.45;
    }
    .console-box {
      width: 100%;
      max-width: 500px;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(56, 189, 248, 0.28);
      border-radius: 18px;
      padding: 16px;
      min-height: 130px;
    }
    .heard-text {
      font-size: 13px;
      color: #38bdf8;
      margin-bottom: 8px;
      font-weight: 700;
    }
    .reply-text {
      font-size: 14.5px;
      color: #f8fafc;
      line-height: 1.5;
      font-weight: 600;
      white-space: pre-line;
    }
    .quick-row {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .q-btn {
      flex: 1;
      min-width: 105px;
      padding: 9px 10px;
      border-radius: 10px;
      border: 1px solid rgba(56, 189, 248, 0.3);
      background: rgba(30, 41, 59, 0.85);
      color: #e2e8f0;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="brand">⚡ AVELON JARVIS • TAM YETKİ</div>
    <div id="modeBadge" class="status-pill">BAŞLATMAK İÇİN DOKUN</div>
  </div>

  <div class="reactor-wrap">
    <div id="reactorBtn" class="reactor" onclick="toggleJarvis()">
      <div class="reactor-core" id="reactorIcon">🎙️</div>
      <div class="reactor-label" id="reactorLabel">BAŞLAT</div>
    </div>
    <div class="state-title" id="stateTitle">Avelon Tam Yetki Hazır</div>
    <div class="state-sub" id="stateSub">Yankı kilidi aktif: Avelon konuşurken mikrofon otomatik kilitlenir, kendi sesi asla karışmaz.</div>
  </div>

  <div class="console-box">
    <div class="heard-text" id="heardBox">👂 Duyulan: Bekleniyor...</div>
    <div class="reply-text" id="replyBox">🤖 "Avelon" dediğinde sesli olarak "Efendim Patron!" diyeceğim ve her soruna (gündelik hayat, bilim, sistem, Mac) anında cevap vereceğim.</div>
    <div class="quick-row">
      <button class="q-btn" style="background:rgba(16,185,129,0.25);border-color:#10b981;color:#6ee7b7;" onclick="enablePocketMode()">🌙 Cep / Siyah Ekran Modu</button>
      <button class="q-btn" style="background:rgba(245,158,11,0.25);border-color:#f59e0b;color:#fde68a;" onclick="triggerTestCall()">📞 Arama Anons Testi</button>
    </div>
    <div class="quick-row">
      <button class="q-btn" style="background:rgba(56,189,248,0.25);border-color:#38bdf8;color:#bae6fd;" onclick="syncMyPhoneContacts()">📒 Rehber İsimlerimi Eşitle</button>
      <button class="q-btn" style="background:rgba(168,85,247,0.3);border-color:#a855f7;color:#f3e8ff;" onclick="window.location.href='/avelon.apk'">📲 Avelon Jarvis APK İndir (SIM & Ses)</button>
    </div>
    <div class="quick-row">
      <button class="q-btn" onclick="sendManual('Gündelik hayattan ilginç bir bilgi ver')">🧠 Gündelik Bilgi</button>
      <button class="q-btn" onclick="sendManual('Sistem durumu')">📊 Sistem Raporu</button>
      <button class="q-btn" onclick="sendManual('Maillerime bak')">📧 Maillerim</button>
      <button class="q-btn" onclick="sendManual('Son WhatsApp mesajlarını oku')">💬 Son Mesajlar</button>
      <button class="q-btn" onclick="sendManual('Tantavi durumu ne')">🍽️ Tantavi</button>
      <button class="q-btn" onclick="sendManual('Bilgisayarı aç')">💻 Mac Uyandır</button>
    </div>
  </div>

  <!-- 📞 GELEN ARAMA CANLI KARAR MODALI (TELEFONDA OTOMATİK SESLİ AÇILIR) -->
  <div id="incomingCallModal" style="display:none;position:fixed;inset:0;background:rgba(4,7,17,0.96);z-index:99998;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;">
    <div style="font-size:62px;margin-bottom:10px;animation:pulseGold 0.9s infinite;">📞</div>
    <div style="font-size:13px;font-weight:800;color:#38bdf8;letter-spacing:1.5px;margin-bottom:6px;">GELEN ARAMA ALGILANDI</div>
    <div id="callModalName" style="font-size:26px;font-weight:900;color:#ffffff;margin-bottom:8px;">Bilinmeyen Numara</div>
    <div id="callModalSub" style="font-size:15px;color:#fcd34d;font-weight:700;max-width:340px;margin-bottom:24px;line-height:1.45;">
      "Efendim, şu an sizi arıyor. Açayım mı, yoksa sekreter olarak ben mi konuşayım?"
    </div>
    <div style="display:flex;gap:12px;width:100%;max-width:360px;">
      <button onclick="sendCallDecision('accept')" style="flex:1;padding:16px 12px;border-radius:14px;border:none;background:#10b981;color:#042f2e;font-size:15px;font-weight:900;cursor:pointer;">
        ✅ AÇ (BEN KONUŞACAĞIM)
      </button>
      <button onclick="sendCallDecision('reject')" style="flex:1;padding:16px 12px;border-radius:14px;border:none;background:#ef4444;color:#ffffff;font-size:15px;font-weight:900;cursor:pointer;">
        🛑 MEŞGULE AT (AVELON KONUŞSUN)
      </button>
    </div>
  </div>

  <!-- TELEFON EKRANI KAPALI GİBİ GÖRÜNEN TAM SİYAH CEP NÖBET KATMANI -->
  <div id="pocketOverlay" ondblclick="disablePocketMode()" style="display:none;position:fixed;inset:0;background:#000000;z-index:99999;flex-direction:column;align-items:center;justify-content:center;color:#1e293b;user-select:none;">
    <div style="font-size:12px;font-weight:700;color:#1e293b;text-align:center;padding:20px;">
      🌙 AVELON CEP / SİYAH EKRAN NÖBETİ AKTİF<br/>
      <span style="font-size:11px;color:#0f172a;">("Avelon" diye seslenebilirsin • Ekranı açmak için iki kez dokun)</span>
    </div>
  </div>

  <!-- 🔒 PATRON ÖZEL GÜVENLİK KİLİDİ (YABANCILARA %100 KAPALI) -->
  <div id="pinLockModal" style="display:none;position:fixed;inset:0;background:rgba(4,7,17,0.98);z-index:100000;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;">
    <div style="font-size:52px;margin-bottom:12px;">🔒</div>
    <div style="font-size:20px;font-weight:900;color:#38bdf8;letter-spacing:1px;margin-bottom:8px;">TATAR ENDÜSTRİ GÜVENLİK KİLİDİ</div>
    <div style="font-size:13.5px;color:#94a3b8;max-width:320px;margin-bottom:20px;line-height:1.5;">
      Bu sistem <b>Yasin Eren Tatar (Patron)</b> özel komuta merkezidir. Yetkisiz giriş denemeleri IP adresiyle WhatsApp'a bildirilir.
    </div>
    <input id="pinInput" type="password" inputmode="numeric" placeholder="Patron PIN Kodu" style="width:220px;padding:14px;border-radius:12px;border:2px solid #38bdf8;background:#0f172a;color:#fff;font-size:20px;font-weight:800;text-align:center;letter-spacing:6px;margin-bottom:14px;outline:none;" />
    <button onclick="unlockJarvisPin()" style="width:220px;padding:13px;border-radius:12px;border:none;background:linear-gradient(135deg,#0284c7,#2563eb);color:#fff;font-size:15px;font-weight:800;cursor:pointer;">⚡ KİLİDİ AÇ</button>
    <div id="pinErr" style="color:#f87171;font-size:13px;font-weight:700;margin-top:12px;"></div>
  </div>

  <script>
    let isListening = false;
    let isSpeaking = false;
    let activeWindowUntil = Date.now() + 3600000;
    let ignoreResultsUntil = 0;
    let lastSpokenReply = '';
    let recognition = null;
    let wakeAudioBase64 = null;
    let keepAliveCtx = null;
    const audioPlayer = new Audio();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('pin')) {
      localStorage.setItem('jarvis_patron_pin', urlParams.get('pin').trim());
    }
    let patronPin = localStorage.getItem('jarvis_patron_pin') || '1453';
    const ALLOWED_CLIENT_PINS = ['1453', '288', '5222988', 'eren288'];
    if (!ALLOWED_CLIENT_PINS.includes(patronPin)) {
      document.getElementById('pinLockModal').style.display = 'flex';
    }

    function unlockJarvisPin() {
      const val = (document.getElementById('pinInput').value || '').trim();
      if (ALLOWED_CLIENT_PINS.includes(val)) {
        patronPin = val;
        localStorage.setItem('jarvis_patron_pin', val);
        document.getElementById('pinLockModal').style.display = 'none';
      } else {
        document.getElementById('pinErr').textContent = '❌ Yetkisiz Şifre! Patrona güvenlik bildirimi gönderildi.';
        fetch('/api/jarvis-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'yetkisiz', pin: val || 'yanlis' })
        }).catch(() => {});
      }
    }

    function enablePocketMode() {
      if (!isListening) toggleJarvis();
      document.getElementById('pocketOverlay').style.display = 'flex';
      try {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } catch (_) {}
    }

    function disablePocketMode() {
      document.getElementById('pocketOverlay').style.display = 'none';
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      } catch (_) {}
    }

    fetch('/api/jarvis-wake-audio')
      .then(r => r.json())
      .then(d => { if (d.audioBase64) wakeAudioBase64 = d.audioBase64; })
      .catch(() => {});

    // Telefon ekranı kilitlense veya sekme arka plana geçse bile ses kanalını canlı tutan sessiz osilatör
    function startBackgroundKeepAlive() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !keepAliveCtx) {
          keepAliveCtx = new AC();
          const osc = keepAliveCtx.createOscillator();
          const gain = keepAliveCtx.createGain();
          gain.gain.value = 0.0001; // Duyulmaz sessiz sinyal
          osc.connect(gain);
          gain.connect(keepAliveCtx.destination);
          osc.start();
        }
        if (keepAliveCtx && keepAliveCtx.state === 'suspended') {
          keepAliveCtx.resume();
        }
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Avelon Jarvis 7/24 Nöbette',
            artist: 'Tatar Endüstri Komuta Merkezi',
          });
        }
      } catch (_) {}
    }

    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && isListening) {
        try {
          if ('wakeLock' in navigator) await navigator.wakeLock.request('screen').catch(() => {});
        } catch (_) {}
        if (!isSpeaking && !recognition) startSpeechRecognition();
      }
    });

    // KENDİ SESİNİN KARIŞMASINI %100 ENGELLEYEN MİKROFON KİLİDİ
    function killMicForPlayback() {
      isSpeaking = true;
      ignoreResultsUntil = Date.now() + 60000;
      if (recognition) {
        try {
          recognition.onresult = null;
          recognition.onend = null;
          recognition.onerror = null;
          recognition.abort(); // Tampondaki kendi sesini tamamen çöpe at!
        } catch (_) {}
        recognition = null;
      }
    }

    function isEchoOfJarvis(phrase) {
      const low = String(phrase || '').toLocaleLowerCase('tr-TR').replace(/[?!.,]/g, '').trim();
      if (!low) return true;
      if (
        low.includes('efendim patron') ||
        low.includes('sizi dinliyorum') ||
        low.includes('emriniz nedir') ||
        low.includes('tam yetkiyle emrinizdeyim') ||
        low.includes('emredersiniz patron') ||
        low.includes('tatar endüstri komuta') ||
        low.includes('bağlı üç e-posta')
      ) {
        return true;
      }
      if (lastSpokenReply) {
        const spokenLow = lastSpokenReply.toLocaleLowerCase('tr-TR').replace(/[?!.,]/g, '').trim();
        if (spokenLow && (spokenLow.includes(low) || low.includes(spokenLow.slice(0, 20)))) {
          return true;
        }
      }
      return false;
    }

    function playBase64Mp3(b64, spokenTextForEchoFilter = '') {
      return new Promise((resolve) => {
        if (!b64) return resolve();
        if (spokenTextForEchoFilter) lastSpokenReply = spokenTextForEchoFilter;

        // Konuşma başlamadan önce mikrofonu TAMAMEN KAPAT!
        killMicForPlayback();

        const r = document.getElementById('reactorBtn');
        r.classList.remove('listening');
        r.classList.add('speaking');
        document.getElementById('reactorIcon').textContent = '🔊';
        document.getElementById('reactorLabel').textContent = 'KONUŞUYOR';

        const finishPlayback = () => {
          r.classList.remove('speaking');
          if (isListening) r.classList.add('listening');
          document.getElementById('reactorIcon').textContent = '🎙️';
          document.getElementById('reactorLabel').textContent =
            Date.now() < activeWindowUntil ? 'EMRİNİ SÖYLE' : 'DİNLİYOR';

          // Hoparlördeki sesin odadaki yankısı tamamen bitsin diye 850ms bekle, sonra mikrofonu sıfırdan aç!
          setTimeout(() => {
            isSpeaking = false;
            ignoreResultsUntil = Date.now() + 250;
            if (isListening) startSpeechRecognition();
            resolve();
          }, 850);
        };

        audioPlayer.src = 'data:audio/mp3;base64,' + b64;
        audioPlayer.onended = finishPlayback;
        audioPlayer.onerror = () => {
          if (spokenTextForEchoFilter && window.speechSynthesis) {
            try {
              const u = new SpeechSynthesisUtterance(spokenTextForEchoFilter);
              u.lang = 'tr-TR';
              u.onend = finishPlayback;
              u.onerror = finishPlayback;
              window.speechSynthesis.speak(u);
              return;
            } catch (_) {}
          }
          finishPlayback();
        };
        audioPlayer.play().catch(() => {
          if (spokenTextForEchoFilter && window.speechSynthesis) {
            try {
              const u = new SpeechSynthesisUtterance(spokenTextForEchoFilter);
              u.lang = 'tr-TR';
              u.onend = finishPlayback;
              u.onerror = finishPlayback;
              window.speechSynthesis.speak(u);
              return;
            } catch (_) {}
          }
          finishPlayback();
        });
      });
    }

    async function handleSpokenPhrase(phrase) {
      if (isSpeaking || Date.now() < ignoreResultsUntil) return;
      const clean = (phrase || '').trim();
      if (!clean || isEchoOfJarvis(clean)) return;

      document.getElementById('heardBox').textContent = '👂 Duyulan: "' + clean + '"';

      const low = clean.toLocaleLowerCase('tr-TR').replace(/[?!.,]/g, '').trim();

      // Eğer o sırada aktif bir gelen arama varsa doğrudan "Aç" veya "Kapat / Sen konuş" kararını uygula!
      if (window.activeCallIdNow) {
        if (
          low.includes('kapat') ||
          low.includes('açma') ||
          low.includes('acma') ||
          low.includes('reddet') ||
          low.includes('meşgul') ||
          low.includes('sen konuş') ||
          low.includes('sen konus') ||
          low.includes('hayır')
        ) {
          await sendCallDecision('reject');
          return;
        }
        if (low.includes('aç') || low.includes('ac') || low.includes('evet') || low.includes('tamam')) {
          await sendCallDecision('accept');
          return;
        }
      }

      if (low === 'beklemeye geç' || low === 'teşekkürler avelon' || low === 'tamam avelon') {
        activeWindowUntil = 0;
        document.getElementById('stateTitle').textContent = 'Nöbet Modu ("Avelon" Deyince Uyanır)';
        document.getElementById('reactorLabel').textContent = 'NÖBETTE';
        return;
      }

      const hasWakeWord =
        low.includes('avelon') ||
        low.includes('avalon') ||
        low.includes('abalone') ||
        low.includes('apollon') ||
        low.includes('jarvis');

      const afterWake = low.replace(/^(?:hey\\s+|alo\\s+)?(?:avelon|avalon|abalone|apollon|jarvis)\\s*/i, '').trim();

      if (hasWakeWord && !afterWake) {
        activeWindowUntil = Date.now() + 3600000;
        document.getElementById('replyBox').textContent = '⚡ Efendim Patron! Sizi dinliyorum, emriniz nedir?';
        document.getElementById('stateTitle').textContent = 'Efendim Patron! Emrinizi Dinliyorum...';
        if (wakeAudioBase64) {
          await playBase64Mp3(wakeAudioBase64, 'Efendim Patron sizi dinliyorum');
        } else {
          await sendManual('Avelon');
        }
        return;
      }

      if (hasWakeWord || Date.now() < activeWindowUntil) {
        activeWindowUntil = Date.now() + 3600000;
        const cmdToSend = afterWake || clean;
        await sendManual(cmdToSend);
      }
    }

    async function sendManual(text) {
      try {
        killMicForPlayback();
        document.getElementById('heardBox').textContent = '👂 Emir: "' + text + '"';
        document.getElementById('replyBox').textContent = '⏳ Avelon tam yetkiyle işliyor...';
        const res = await fetch('/api/jarvis-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, pin: patronPin })
        });
        const data = await res.json();
        if (data.ignore) {
          isSpeaking = false;
          if (isListening) startSpeechRecognition();
          return;
        }
        if (data.ok) {
          activeWindowUntil = Date.now() + 3600000;
          document.getElementById('replyBox').textContent = data.display || data.spoken;
          document.getElementById('stateTitle').textContent = 'Avelon Yanıtlıyor';
          if (data.audioBase64) {
            await playBase64Mp3(data.audioBase64, data.spoken);
          } else {
            isSpeaking = false;
            if (isListening) startSpeechRecognition();
          }
          document.getElementById('stateTitle').textContent = 'Sizi Dinliyorum Patron (Doğrudan Konuşabilirsin)';
        }
      } catch (e) {
        isSpeaking = false;
        if (isListening) startSpeechRecognition();
        document.getElementById('replyBox').textContent = 'Bağlantı hatası: ' + e.message;
      }
    }

    async function toggleJarvis() {
      startBackgroundKeepAlive();
      try {
        if ('wakeLock' in navigator) await navigator.wakeLock.request('screen').catch(() => {});
      } catch (_) {}

      isListening = true;
      activeWindowUntil = Date.now() + 45000;
      document.getElementById('modeBadge').textContent = '🟢 TAM YETKİ AKTİF (YANKI KİLİTLİ)';
      document.getElementById('reactorBtn').classList.add('listening');
      document.getElementById('reactorLabel').textContent = 'EMRİNİ SÖYLE';
      document.getElementById('stateTitle').textContent = 'Efendim Patron! Sizi Dinliyorum';

      if (wakeAudioBase64) {
        await playBase64Mp3(wakeAudioBase64, 'Efendim Patron sizi dinliyorum');
      } else {
        await sendManual('Avelon');
      }
    }

    function startSpeechRecognition() {
      if (isSpeaking || !isListening) return;
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        document.getElementById('stateSub').textContent = 'Tarayıcınız canlı mikrofonu desteklemiyor, alttaki butonları kullanabilirsiniz.';
        return;
      }
      if (recognition) {
        try {
          recognition.onresult = null;
          recognition.onend = null;
          recognition.abort();
        } catch (_) {}
        recognition = null;
      }
      recognition = new SR();
      recognition.lang = 'tr-TR';
      recognition.continuous = false; // Tek cümle yakalayıp anında işler, kendi sesini biriktirmez!
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        if (isSpeaking || Date.now() < ignoreResultsUntil) return;
        const last = event.results[event.results.length - 1];
        if (last && last.isFinal) {
          const transcript = last[0].transcript;
          handleSpokenPhrase(transcript);
        }
      };

      recognition.onend = () => {
        if (isListening && !isSpeaking) {
          setTimeout(() => {
            if (isListening && !isSpeaking) startSpeechRecognition();
          }, 250);
        }
      };

      recognition.onerror = () => {
        if (isListening && !isSpeaking) {
          setTimeout(() => {
            if (isListening && !isSpeaking) startSpeechRecognition();
          }, 600);
        }
      };

      try { recognition.start(); } catch (_) {}
    }

    window.activeCallIdNow = null;
    window.announcedCallIds = new Set();

    async function sendCallDecision(action) {
      document.getElementById('incomingCallModal').style.display = 'none';
      window.activeCallIdNow = null;
      try {
        await fetch('/api/call-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
        const msg = action === 'reject'
          ? 'Emredersiniz Efendim, aramayı meşgule attım ve sekreter olarak ben yanıtlıyorum.'
          : 'Emredersiniz Efendim, aramayı size bırakıyorum.';
        document.getElementById('replyBox').textContent = '📞 ' + msg;
      } catch (_) {}
    }

    async function triggerTestCall() {
      try {
        document.getElementById('replyBox').textContent = '📞 Gelen arama simülasyonu başlatılıyor...';
        await fetch('/api/incoming-gsm-call?caller=05054121081');
      } catch (_) {}
    }

    async function syncMyPhoneContacts() {
      try {
        if ('contacts' in navigator && 'ContactsManager' in window) {
          const selected = await navigator.contacts.select(['name', 'tel'], { multiple: true });
          if (selected && selected.length > 0) {
            const r = await fetch('/api/sync-phone-contacts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contacts: selected })
            });
            const d = await r.json();
            document.getElementById('replyBox').textContent =
              '✅ Rehberindeki ' + (d.count || selected.length) + ' numara senin kaydettiğin özel isimlerle (Babam, Annem vb.) Avelon hafızasına kaydedildi!';
            return;
          }
        }
        const num = prompt('Rehberde özel isim vermek istediğin numarayı yaz (Örn: 05054121081):', '05054121081');
        if (!num) return;
        const name = prompt('Bu numarayı Avelon nasıl anons etsin? (Örn: Babam):', 'Babam');
        if (!name) return;
        await fetch('/api/whitelist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: num, name })
        });
        document.getElementById('replyBox').textContent =
          '✅ ' + num + ' numarası artık "' + name + '" olarak kaydedildi! Aradığında "Efendim, şu an ' + name + ' sizi arıyor" diyecek.';
      } catch (e) {
        alert('Rehber eşitleme hatası: ' + e.message);
      }
    }

    function openSimSetupModal() {
      const url = 'https://avelon-wp-botavelon-wp-bot.onrender.com/api/incoming-gsm-call?caller={call_number}&name={call_name}';
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
      alert(
        '📲 GERÇEK SIM ARAMASI + TELEFONDA SESLİ OKUMA + "EVET AÇ" İLE ARAMAYI AÇMA:\\n\\n' +
        'Web tarayıcıları (Chrome) güvenlik nedeniyle SIM kartı ve yeşil "Aramayı Aç" tuşunu tek başına kontrol edemez. Bunu telefonunda yapmak için Play Store\\'dan ücretsiz "MacroDroid" uygulamasında 1 kural ekle:\\n\\n' +
        '1️⃣ TETİKLEYİCİ (Trigger): Arama/SMS -> Gelen Arama (Tüm Numaralar)\\n' +
        '2️⃣ EYLEM 1 (Telefonda Konuş): Metni Seslendir (Speak Text) -> "Efendim, şu an {call_name} sizi arıyor, açayım mı?"\\n' +
        '3️⃣ EYLEM 2 (Avelon Köprüsü): HTTP İsteği (GET) -> (Panoya kopyalandı!)\\n' +
        url + '\\n' +
        '4️⃣ EYLEM 3 ("Aç" Deyince Aç): Aramayı Cevapla (Answer Call) + Hoparlör Açık!'
      );
    }

    setInterval(async () => {
      try {
        const r = await fetch('/api/incoming-call-poll');
        const d = await r.json();
        if (d && d.active && d.callId) {
          window.activeCallIdNow = d.callId;
          document.getElementById('callModalName').textContent = d.callerName || 'Gelen Arama';
          document.getElementById('callModalSub').textContent = '🗣️ "' + (d.spokenAlert || 'Efendim, sizi arıyor, açayım mı?') + '"';
          document.getElementById('incomingCallModal').style.display = 'flex';
          if (!window.announcedCallIds.has(d.callId)) {
            if (d.audioBase64) {
              window.announcedCallIds.add(d.callId);
              activeWindowUntil = Date.now() + 60000;
              await playBase64Mp3(d.audioBase64, d.spokenAlert);
            } else if (window.speechSynthesis && d.spokenAlert) {
              window.announcedCallIds.add(d.callId);
              activeWindowUntil = Date.now() + 60000;
              const u = new SpeechSynthesisUtterance(d.spokenAlert);
              u.lang = 'tr-TR';
              window.speechSynthesis.speak(u);
            }
          }
        } else if (window.activeCallIdNow) {
          window.activeCallIdNow = null;
          document.getElementById('incomingCallModal').style.display = 'none';
        }
      } catch (_) {}
    }, 1500);
  </script>
</body>
</html>`);
});

// Saat 10:00 Sabah Uyandırma Alarmı (Hem Mac Sesli Uyandırma Hem WhatsApp "Siz" Mesajı)
let lastWakeupDate = '';
setInterval(async () => {
  try {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const todayKey = now.toISOString().slice(0, 10);

    if (hours === 10 && minutes === 0 && lastWakeupDate !== todayKey) {
      lastWakeupDate = todayKey;
      console.log('⏰ SAAT 10:00 — Patron Eren Uyandırma Alarmı Tetiklendi!');

      // 1) WhatsApp "Siz" sohbetine sabah brifingi gönder
      if (sock && connectionStatus === 'connected') {
        const wakeMsg =
          `☀️ *GÜNAYDIN PATRON EREN! (Saat 10:00)* 🤖\n\n` +
          `Beni saat 10:00'da kaldır demiştin, uyanma vakti cano! 🚀\n\n` +
          `📋 *Bugünkü Öncelikli Planımız:*\n` +
          `1️⃣ *NeYapsak Güncellemesi:* Yeni *N + Pin* logosu ve *13 Dil (TR/EN)* desteği hazır; App Store & Play Store'a göndereceğiz.\n` +
          `2️⃣ *Avelon Mail & Toplantı Asistanı:* Gelen önemli mailleri (BTM, Lonca, Belediyeler) ve toplantı takvimini otomatik bağlayacağız.\n` +
          `3️⃣ *BTM & Lonca Takibi:* BTM Eğitim daveti ve başvurular kontrol edilecek.\n\n` +
          `— *Avelon | Özel Sekreterin* 🤖`;
        const sent = await sock.sendMessage('905525222988@s.whatsapp.net', { text: wakeMsg });
        if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
      }

      // 2) Mac sesini %100 yap ve sesli olarak uyandır
      exec(
        `osascript -e "set volume output volume 100 without output muted"; ` +
        `for i in 1 2 3 4; do ` +
        `afplay /System/Library/Sounds/Glass.aiff; ` +
        `say -v Yelda -r 185 "Günaydın Patron Eren! Saat on oldu, uyanma vakti! Bugün NeYapsak güncellemesini yayınlayacağız ve Avelon mail toplantı sistemini kuracağız. Hadi kalk cano!"; ` +
        `sleep 3; ` +
        `done`
      );
    }
  } catch (e) {
    console.error('Alarm hatası:', e.message);
  }
}, 15000);

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Avelon — Patron Eren'in WhatsApp Asistanı</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { margin: 0; background: #0f172a; color: #f8fafc; padding: 24px; }
    .container { max-width: 1020px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 20px 24px; border-radius: 16px; border: 1px solid #334155; margin-bottom: 20px; }
    .badge { padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 14px; }
    .badge.connected { background: #065f46; color: #6ee7b7; }
    .badge.qr { background: #78350f; color: #fcd34d; }
    .badge.disconnected { background: #7f1d1d; color: #fca5a5; }
    .grid { display: grid; grid-template-columns: 1fr 1.25fr; gap: 20px; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    .card { background: #1e293b; padding: 22px; border-radius: 16px; border: 1px solid #334155; }
    h2, h3 { margin-top: 0; color: #e2e8f0; }
    label { display: block; font-size: 13px; color: #94a3b8; margin-bottom: 6px; margin-top: 12px; }
    textarea, input[type="text"], input[type="number"] {
      width: 100%; background: #0f172a; border: 1px solid #475569; color: #fff;
      padding: 10px 12px; border-radius: 10px; font-size: 13px;
    }
    textarea { min-height: 72px; resize: vertical; }
    button {
      background: #10b981; color: #06281e; font-weight: 700; border: none;
      padding: 11px 18px; border-radius: 10px; cursor: pointer; font-size: 14px; margin-top: 14px;
    }
    button:hover { opacity: 0.9; }
    button.secondary { background: #3b82f6; color: #fff; padding: 6px 12px; font-size: 12px; margin-top: 0; }
    button.danger { background: #ef4444; color: #fff; padding: 6px 12px; font-size: 12px; margin-top: 0; }
    button.warn { background: #f59e0b; color: #000; padding: 6px 12px; font-size: 12px; margin-top: 0; }
    .qr-box { text-align: center; padding: 14px; background: #fff; border-radius: 12px; display: inline-block; margin-top: 8px; }
    .stranger-item { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    .stranger-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px; }
    .msg-bubble { background: #1e293b; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-top: 6px; border-left: 3px solid #38bdf8; }
    .intro-bubble { background: #064e3b; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-top: 6px; border-left: 3px solid #10b981; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h2 style="margin:0;">🤖 AVELON — Patron Eren'in Özel WhatsApp Asistanı</h2>
        <div style="font-size:13px; color:#94a3b8; margin-top:4px;" id="userInfo">Durum kontrol ediliyor...</div>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <span id="statusBadge" class="badge qr">Kontrol Ediliyor</span>
        <button id="toggleBtn" onclick="toggleBot()" style="margin:0;">Bot: Açık</button>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>📲 Bağlantı & Rehber Koruma Durumu</h3>
        <div id="qrSection">Yükleniyor...</div>

        <hr style="border-color:#334155; margin:18px 0;" />
        <h3>🛡️ Aktif Korumalar & Randevu Sistemi</h3>
        <ul style="font-size:13px; color:#cbd5e1; line-height:1.7; padding-left:18px; margin:0;">
          <li><b>Grup Mesajları:</b> 🚫 Kesinlikle cevap verilmez.</li>
          <li><b>Aktif Rehber:</b> 📒 Şu an rehberinde kayıtlı <b id="knownCount" style="color:#34d399;">0</b> kişi tanınıyor.</li>
          <li><b>Yalandan Randevu Sırası:</b> 📅 Yabancılara kendini tanıtınca otomatik <b>60. Sıra, 61. Sıra...</b> verir.</li>
          <li><b>8 Mesaj Spam Engelleyici:</b> 🚫 Yabancı numara 8 mesaj atarsa uyarıp otomatik engeller.</li>
        </ul>

        <hr style="border-color:#334155; margin:18px 0;" />
        <h3>➕ Manuel Kayıtlı Kişi Ekle</h3>
        <div style="display:flex; gap:8px;">
          <input type="text" id="manualNum" placeholder="905xxxxxxxxx" />
          <input type="text" id="manualName" placeholder="İsim" />
          <button onclick="addWhitelist()" style="margin:0; white-space:nowrap;">Ekle</button>
        </div>

        <hr style="border-color:#334155; margin:18px 0;" />
        <h3 style="color:#38bdf8;">🎙️ Sesli Sekreterle Numara Yokla ("Yarın için müsait misiniz?")</h3>
        <p style="font-size:12px; color:#94a3b8; margin-top:0;">Numarayı ve soruyu yaz (veya kendi WhatsApp <b>"Siz"</b> sohbetine <code>.ara 0532xxxxxxx Yarın için müsait misiniz?</code> yaz). Avelon karşı tarafa Türkçe Yapay Zeka Sesli Not (🎤) + mesaj atıp cevabını takip eder!</p>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <input type="text" id="outreachTargetNum" placeholder="05xxxxxxxxx veya 905xxxxxxxxx" />
          <input type="text" id="outreachQuestion" value="Yarın için müsait misiniz?" placeholder="Sorulacak soru..." />
          <button onclick="triggerOutreachCall()" style="margin:0; background:#0ea5e9; color:#fff;">🎙️ Sesli Sekreter Gönder & Randevu Yokla</button>
        </div>

        <hr style="border-color:#334155; margin:18px 0;" />
        <h3 style="color:#f87171;">🚨 Sevmediğin Kişiye Fotoğraflı "%80 Dolandırıcı" Raporu At & Engelle</h3>
        <p style="font-size:12px; color:#94a3b8; margin-top:0;">Numarayı yazıp butona bas (veya telefondan o kişinin sohbetine <b>.engel</b> yaz); Avelon o kişinin kendi profil fotoğrafını çekip altına <b>"%80 dolandırıcı gözüküyor, engellendiniz"</b> yazıp anında engeller!</p>
        <div style="display:flex; gap:8px;">
          <input type="text" id="scamTargetNum" placeholder="05xxxxxxxxx veya 905xxxxxxxxx" />
          <button class="danger" onclick="triggerManualScamBlock()" style="margin:0; padding:10px 14px; font-size:13px; white-space:nowrap;">📸 Fotoğrafını At & Engelle</button>
        </div>
      </div>

      <div class="card">
        <h3>⚙️ Avelon Asistan, Randevu & Engel Ayarları</h3>

        <label style="color:#fcd34d; font-weight:600;">🕵️ 1) Kayıtlı OLMAYAN Kişiye 1. Mesaj (Kendini Tanıt):</label>
        <textarea id="firstReplyText"></textarea>

        <label style="color:#fcd34d; font-weight:600;">📅 2) Kendini Tanıttığında Gidecek Randevu Mesajı ({SIRA} = 60, 61...):</label>
        <textarea id="secondReplyText"></textarea>

        <div style="display:flex; gap:12px; align-items:center; margin-top:8px;">
          <div style="flex:1;">
            <label style="margin-top:0;">Sıradaki Yalandan Randevu No:</label>
            <input type="number" id="nextQueueNumber" min="1" max="9999" value="60" />
          </div>
          <div style="flex:1;">
            <label style="margin-top:0;">Kaç mesajda engellensin?</label>
            <input type="number" id="maxStrangerMessages" min="3" max="50" value="8" />
          </div>
        </div>

        <label style="color:#f87171; font-weight:600;">🚫 3) Yabancı Numara 8 Mesaj Atınca Gidecek Engelleme Mesajı:</label>
        <textarea id="blockWarningText"></textarea>

        <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
          <input type="checkbox" id="autoBlockOnMax" checked style="width:18px; height:18px;" />
          <label for="autoBlockOnMax" style="margin:0; color:#fca5a5; font-weight:600; cursor:pointer;">
            8. mesajda WhatsApp'tan otomatik ENGELLE
          </label>
        </div>

        <hr style="border-color:#334155; margin:14px 0;" />

        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <input type="checkbox" id="replyToKnownContacts" checked style="width:18px; height:18px;" />
          <label for="replyToKnownContacts" style="margin:0; color:#6ee7b7; font-weight:600; cursor:pointer;">
            📒 4) Kayıtlı Kişilere "Patronum en kısa zamanda dönecek" mesajı atılsın
          </label>
        </div>
        <textarea id="knownReplyText"></textarea>

        <label>Kayıtlı kişiye tekrar yazma bekleme süresi (Dakika):</label>
        <input type="number" id="knownCooldownMinutes" min="1" max="1440" value="3" />

        <button onclick="saveSettings()" style="width:100%;">💾 Avelon Ayarlarını Kaydet</button>
        <div id="saveMsg" style="color:#34d399; font-size:13px; margin-top:8px; display:none;">✅ Kaydedildi!</div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
      <h3>🕵️ Kayıtlı Olmayan Numaralardan Gelen Tanışma & Randevu Kayıtları</h3>
      <div id="strangersList">Henüz yabancı bir numaradan mesaj gelmedi.</div>
    </div>
  </div>

  <script>
    let currentEnabled = true;
    let initializedForm = false;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        currentEnabled = data.enabled;
        const toggleBtn = document.getElementById('toggleBtn');
        toggleBtn.textContent = currentEnabled ? '🟢 Avelon: AKTİF' : '🔴 Avelon: KAPALI';
        toggleBtn.style.background = currentEnabled ? '#10b981' : '#ef4444';
        toggleBtn.style.color = currentEnabled ? '#06281e' : '#fff';

        document.getElementById('knownCount').textContent = data.knownCount || 0;

        const badge = document.getElementById('statusBadge');
        const qrSection = document.getElementById('qrSection');
        const userInfo = document.getElementById('userInfo');

        if (data.connectionStatus === 'connected') {
          badge.className = 'badge connected';
          badge.textContent = '✅ BAĞLANDI (ÇALIŞIYOR)';
          userInfo.textContent = 'Bağlı WhatsApp: ' + (data.connectedUser?.name || '') + ' (+' + (data.connectedUser?.id || '') + ')';
          qrSection.innerHTML = '<div style="padding:16px; background:#064e3b; color:#a7f3d0; border-radius:12px;">✅ <b>Avelon WhatsApp hesabına bağlı ve 7/24 nöbette!</b><br/><br/>• Kayıtlı kişilere bekleme süresi <b>' + (data.knownCooldownMinutes || 3) + ' dakika</b>.<br/>• Sıradaki yabancıya verilecek randevu sırası: <b>' + (data.nextQueueNumber || 60) + '. Sıra</b></div>';
        } else if (data.connectionStatus === 'qr' && data.qr) {
          badge.className = 'badge qr';
          badge.textContent = '⏳ QR BEKLENİYOR';
          qrSection.innerHTML = '<div style="text-align:center;"><div class="qr-box"><img src="' + data.qr + '" width="240" height="240" /></div></div>';
        } else {
          badge.className = 'badge disconnected';
          badge.textContent = 'Bağlanıyor...';
          qrSection.innerHTML = '<p>WhatsApp sunucusuna bağlanılıyor...</p>';
        }

        if (!initializedForm) {
          document.getElementById('firstReplyText').value = data.firstReplyText || '';
          document.getElementById('secondReplyText').value = data.secondReplyText || '';
          document.getElementById('blockWarningText').value = data.blockWarningText || '';
          document.getElementById('knownReplyText').value = data.knownReplyText || '';
          document.getElementById('replyToKnownContacts').checked = data.replyToKnownContacts !== false;
          document.getElementById('maxStrangerMessages').value = data.maxStrangerMessages || 8;
          document.getElementById('autoBlockOnMax').checked = data.autoBlockOnMax !== false;
          document.getElementById('nextQueueNumber').value = data.nextQueueNumber || 60;
          document.getElementById('knownCooldownMinutes').value = data.knownCooldownMinutes || 3;
          initializedForm = true;
        }

        const strangers = data.strangers || {};
        const keys = Object.keys(strangers).sort((a, b) => (strangers[b].updatedAt || '').localeCompare(strangers[a].updatedAt || ''));
        const listEl = document.getElementById('strangersList');

        if (keys.length === 0) {
          listEl.innerHTML = '<div style="color:#64748b; font-size:14px;">Henüz yabancı bir numaradan mesaj gelmedi.</div>';
        } else {
          listEl.innerHTML = keys.map(num => {
            const s = strangers[num];
            return \`
              <div class="stranger-item">
                <div class="stranger-head">
                  <div>
                    <strong style="color:#38bdf8; font-size:15px;">+\${s.phone || num}</strong>
                    <span style="color:#94a3b8; font-size:13px; margin-left:8px;">(WP Adı: \${s.pushName || 'Bilinmiyor'} | Randevu: <b>\${s.queueNo || 60}. Sıra</b> | Mesaj: <b>\${s.msgCount || 1}</b>)</span>
                    \${s.blocked ? '<span style="background:#7f1d1d; color:#fca5a5; padding:3px 8px; border-radius:6px; font-size:11px; margin-left:8px;">🚫 ENGELLENDİ</span>' : ''}
                  </div>
                  <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="secondary" onclick="markKnown('\${num}', '\${(s.pushName || '').replace(/'/g, '')}')">✅ Rehbere Al</button>
                    <button class="danger" style="background:#dc2626;" onclick="scamBlockStranger('\${num}')">📸 Fotoğrafını At + %80 Dolandırıcı Deyip Engelle</button>
                    \${s.blocked
                      ? \`<button class="warn" onclick="toggleBlock('\${num}', 'unblock')">🔓 Engeli Kaldır</button>\`
                      : \`<button class="danger" onclick="toggleBlock('\${num}', 'block')">🚫 Sessiz Engelle</button>\`
                    }
                    <button class="secondary" style="background:#475569;" onclick="resetStranger('\${num}')">🗑️ Sıfırla</button>
                  </div>
                </div>
                <div class="msg-bubble"><b>İlk Mesajı:</b> \${s.firstMsg || '-'}</div>
                \${s.introMsg ? \`<div class="intro-bubble"><b>Kendini Tanıttığı / Sonraki Mesajları:</b> \${s.introMsg}</div>\` : '<div style="font-size:12px; color:#fbbf24; margin-top:6px;">⏳ Avelon kim olduğunu sordu, yanıt bekleniyor...</div>'}
              </div>
            \`;
          }).join('');
        }
      } catch (e) {}
    }

    async function saveSettings() {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstReplyText: document.getElementById('firstReplyText').value,
          secondReplyText: document.getElementById('secondReplyText').value,
          blockWarningText: document.getElementById('blockWarningText').value,
          knownReplyText: document.getElementById('knownReplyText').value,
          replyToKnownContacts: document.getElementById('replyToKnownContacts').checked,
          maxStrangerMessages: Number(document.getElementById('maxStrangerMessages').value),
          autoBlockOnMax: document.getElementById('autoBlockOnMax').checked,
          nextQueueNumber: Number(document.getElementById('nextQueueNumber').value),
          knownCooldownMinutes: Number(document.getElementById('knownCooldownMinutes').value)
        })
      });
      const msg = document.getElementById('saveMsg');
      msg.style.display = 'block';
      setTimeout(() => msg.style.display = 'none', 2500);
    }

    async function toggleBot() {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled })
      });
      fetchStatus();
    }

    async function addWhitelist() {
      const number = document.getElementById('manualNum').value;
      const name = document.getElementById('manualName').value;
      if (!number) return;
      await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, name })
      });
      document.getElementById('manualNum').value = '';
      document.getElementById('manualName').value = '';
      fetchStatus();
    }

    async function markKnown(number, name) {
      await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, name })
      });
      fetchStatus();
    }

    async function toggleBlock(number, action) {
      await fetch('/api/block-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, action })
      });
      fetchStatus();
    }

    async function resetStranger(number) {
      await fetch('/api/reset-stranger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number })
      });
      fetchStatus();
    }

    async function scamBlockStranger(number) {
      await fetch('/api/scam-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number })
      });
      alert('📸 Kişinin fotoğrafı çekilip "%80 Dolandırıcı" mesajı gönderildi ve engellendi!');
      fetchStatus();
    }

    async function triggerManualScamBlock() {
      const number = document.getElementById('scamTargetNum').value;
      if (!number) return;
      await fetch('/api/scam-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number })
      });
      document.getElementById('scamTargetNum').value = '';
      alert('📸 Kişinin fotoğrafı çekilip "%80 Dolandırıcı" mesajı gönderildi ve engellendi!');
      fetchStatus();
    }

    async function triggerOutreachCall() {
      const number = document.getElementById('outreachTargetNum').value;
      const question = document.getElementById('outreachQuestion').value;
      if (!number) return alert('Lütfen aranacak numarayı girin!');
      const res = await fetch('/api/outreach-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, question })
      });
      const data = await res.json();
      if (data.ok) {
        document.getElementById('outreachTargetNum').value = '';
        alert('🎙️ Avelon Sesli Sekreter Kaydı (🎤) ve sorunuz +' + data.phone + ' numarasına başarıyla iletildi! Cevap geldiğinde "Siz" sohbetinize raporlanacak.');
      } else {
        alert('Hata: ' + (data.error || 'Gönderilemedi'));
      }
      fetchStatus();
    }

    fetchStatus();
    setInterval(fetchStatus, 2500);
  </script>
</body>
</html>`);
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, connectionStatus, uptime: process.uptime() });
});

const PORT = process.env.PORT || 4040;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Avelon WhatsApp Asistan Paneli hazır: http://localhost:${PORT}`);
  startWhatsApp();

  // Render Free Tier uyku engelleyici (Her 4 dakikada bir kendi kendisine ping atar)
  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  if (externalUrl) {
    console.log(`☁️ Render 7/24 Self-Ping Aktif: ${externalUrl}/health`);
    setInterval(() => {
      fetch(`${externalUrl}/health`).catch(() => {});
    }, 4 * 60 * 1000); 

  }

});
                                                          