import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { execFileSync, execSync, spawn } from 'child_process';
import crypto from 'crypto';
import express from 'express';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import { IgApiClient } from 'instagram-private-api';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import os from 'os';
import path from 'path';
import pino from 'pino';
import QRCode from 'qrcode';
import tls from 'tls';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global Process Stability Handlers
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err?.stack || err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[WARN] Unhandled Promise Rejection:', reason);
});

// .env dosyasını (varsa) yükle — Meta / Twilio anahtarları burada durur
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (_) { }

const PORT = Number(process.env.PORT) || 4080;
const META_APP_ID = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'opai_meta_verify';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const GRAPH = 'https://graph.facebook.com/v21.0';
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const DB_FILE = path.join(DATA_DIR, 'production_db.json');

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// 💎 4 GERÇEK ABONELİK PAKETİ
export const PRICING_PLANS = {
  starter_220: {
    id: 'starter_220',
    name: 'Başlangıç Paketi (Sadece Oto-Cevap)',
    price: 220,
    badge: 'GİRİŞ PAKETİ',
    channels: ['whatsapp'],
    autoReply: true,
    appointmentBooking: false,
    voiceReply: false,
    voiceCall: false,
    commentToDm: false,
    features: [
      '7/24 Otomatik Karşılama & Fiyat/Konum Cevabı',
      'Sınırsız Otomatik Mesaj Yanıtlama',
      'Randevu & Saat Tablosu Kapalı (Sadece Otomatik Cevap)',
    ],
  },
  pro_850: {
    id: 'pro_850',
    name: 'Randevu Pro (Oto-Cevap + Randevu Saati)',
    price: 850,
    badge: 'ESNAF PRO',
    channels: ['whatsapp', 'instagram'],
    autoReply: true,
    appointmentBooking: true,
    voiceReply: false,
    voiceCall: false,
    commentToDm: false,
    features: [
      'Canlı Dolu/Boş Saat Tablosu & Otomatik Randevu Kaydı',
      'WhatsApp + Instagram DM Ortak Randevu Takvimi',
      'Mobil Uygulamaya & Web Paneline Anlık Bildirim',
    ],
  },
  omni_1490: {
    id: 'omni_1490',
    name: 'Omni AI (WP + Instagram + TikTok + Sesli)',
    price: 1490,
    badge: 'EN ÇOK TERCİH EDİLEN',
    channels: ['whatsapp', 'instagram', 'tiktok'],
    autoReply: true,
    appointmentBooking: true,
    voiceReply: true,
    voiceCall: false,
    commentToDm: false,
    features: [
      'WhatsApp + Instagram DM + TikTok DM Tek Ortak Takvimde',
      'Gerçekçi Yapay Zeka Ses Kaydı (Voice Note) ile Yanıt',
      'Otomatik Çakışma Önleyici Saat Kilitleme Sistemi',
    ],
  },
  vip_2490: {
    id: 'vip_2490',
    name: 'Kurumsal VIP Tam Otomasyon',
    price: 2490,
    badge: 'KURUMSAL VIP',
    channels: ['whatsapp', 'instagram', 'tiktok'],
    autoReply: true,
    appointmentBooking: true,
    voiceReply: true,
    voiceCall: true,
    commentToDm: true,
    features: [
      'Instagram Reels & TikTok Yorumlarına Otomatik DM Gönderimi',
      'WhatsApp + Instagram + TikTok Tam Yapay Zeka Satış & Randevu',
      'Randevuya 1 Saat Kala Müşteriye Otomatik WhatsApp Hatırlatması',
    ],
  },
};

function createDefaultSlots() {
  return [
    { key: '1', shortHour: '1', time24: '13:00', status: 'free', bookedBy: null, bookedPhone: null, platform: null },
    { key: '2', shortHour: '2', time24: '14:00', status: 'free', bookedBy: null, bookedPhone: null, platform: null },
    { key: '3', shortHour: '3', time24: '15:00', status: 'free', bookedBy: null, bookedPhone: null, platform: null },
    { key: '4', shortHour: '4', time24: '16:00', status: 'busy', bookedBy: 'Mehmet Yılmaz', bookedPhone: '905321112233', platform: 'whatsapp' },
    { key: '5', shortHour: '5', time24: '17:00', status: 'busy', bookedBy: '@selin_kaya', bookedPhone: 'Instagram DM', platform: 'instagram' },
    { key: '6', shortHour: '6', time24: '18:00', status: 'free', bookedBy: null, bookedPhone: null, platform: null },
    { key: '7', shortHour: '7', time24: '19:00', status: 'free', bookedBy: null, bookedPhone: null, platform: null },
    { key: '8', shortHour: '8', time24: '20:00', status: 'free', bookedBy: null, bookedPhone: null, platform: null },
  ];
}

function cleanNumber(val = '') {
  let d = String(val).split('@')[0].split(':')[0].replace(/\D/g, '');
  if (d.startsWith('05') && d.length === 11) d = '90' + d.slice(1);
  else if (d.startsWith('5') && d.length === 10) d = '90' + d;
  return d;
}

function hashPassword(pw = '') {
  return crypto.createHash('sha256').update(String(pw) + '_opai_salt').digest('hex');
}

function verifyPassword(pw = '', storedHash = '') {
  if (!storedHash) return false;
  const hash1 = hashPassword(pw);
  const hash2 = crypto.createHash('sha256').update(String(pw) + '_avelon_salt').digest('hex');
  return storedHash === hash1 || storedHash === hash2;
}

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    }
  } catch (_) { }
  return { users: {}, tokens: {} };
}

const db = loadDb();
db.verificationCodes = db.verificationCodes || {};
db.outboxEmails = db.outboxEmails || [];
const activeSockets = new Map(); // userId -> { sock, status, qrDataUrl, pairingCode, connectedPhone, botSentIds, ownerActiveChats }

export async function sendSmtpEmail({ to, subject, bodyText }) {
  const user = process.env.SMTP_USER || 'iletisim.opai@gmail.com';
  const pass = process.env.SMTP_PASS || 'ntokqatbczgozjuz';
  if (!user || !pass) return false;

  return new Promise((resolve) => {
    let resolved = false;
    const done = (ok) => {
      if (!resolved) {
        resolved = true;
        resolve(ok);
      }
    };

    const timer = setTimeout(() => {
      try { client.destroy(); } catch (_) {}
      done(false);
    }, 2500);

    const client = tls.connect(465, 'smtp.gmail.com', { rejectUnauthorized: false }, () => {
      let step = 0;
      client.on('data', (chunk) => {
        const msg = chunk.toString();
        if (step === 0 && msg.startsWith('220')) {
          step = 1;
          client.write('EHLO gmail.com\r\n');
        } else if (step === 1 && msg.startsWith('250')) {
          step = 2;
          client.write('AUTH LOGIN\r\n');
        } else if (step === 2 && msg.startsWith('334')) {
          step = 3;
          client.write(`${Buffer.from(user).toString('base64')}\r\n`);
        } else if (step === 3 && msg.startsWith('334')) {
          step = 4;
          client.write(`${Buffer.from(pass).toString('base64')}\r\n`);
        } else if (step === 4 && msg.startsWith('235')) {
          step = 5;
          client.write(`MAIL FROM:<${user}>\r\n`);
        } else if (step === 5 && msg.startsWith('250')) {
          step = 6;
          client.write(`RCPT TO:<${to}>\r\n`);
        } else if (step === 6 && msg.startsWith('250')) {
          step = 7;
          client.write('DATA\r\n');
        } else if (step === 7 && msg.startsWith('354')) {
          step = 8;
          const fromNameB64 = `=?UTF-8?B?${Buffer.from('OP AI Kurumsal').toString('base64')}?=`;
          const subjB64 = `=?UTF-8?B?${Buffer.from(subject || 'OP AI Onay Kodunuz').toString('base64')}?=`;
          const boundary = `opai_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          const plainText = (bodyText || '').trim();
          const htmlBody = `<!DOCTYPE html><html lang="tr"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;line-height:1.6;"><div style="max-width:480px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:14px;background:#ffffff;"><div style="font-size:17px;font-weight:700;color:#1e293b;margin-bottom:12px;">OP AI — Operatör AI</div><p style="font-size:14px;color:#334155;margin:0 0 16px;">${plainText.replace(/\n/g, '<br/>')}</p><div style="font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;padding-top:12px;margin-top:20px;">İletişim: ${user}</div></div></body></html>`;
          const rawMail = [
            `From: ${fromNameB64} <${user}>`,
            `Reply-To: <${user}>`,
            `To: <${to}>`,
            `Subject: ${subjB64}`,
            `Date: ${new Date().toUTCString()}`,
            `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@gmail.com>`,
            'MIME-Version: 1.0',
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
            '',
            plainText,
            '',
            `--${boundary}`,
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
            '',
            htmlBody,
            '',
            `--${boundary}--`,
            '\r\n.',
          ].join('\r\n');
          client.write(`${rawMail}\r\n`);
        } else if (step === 8 && msg.startsWith('250')) {
          step = 9;
          clearTimeout(timer);
          done(true);
          try { client.end('QUIT\r\n'); } catch (_) {}
        } else if (msg.startsWith('4') || msg.startsWith('5')) {
          clearTimeout(timer);
          done(false);
        }
      });
    });

    client.on('error', () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

function saveDb() {
  let tmpFile = null;
  try {
    tmpFile = `${DB_FILE}.tmp.${Date.now()}_${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (e) {
    try { if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    console.error('DB kayıt hatası:', e.message);
  }
}

function applyOperatorDefaults(user) {
  if (!user) return;
  const biz = user.businessName || 'işletmemiz';
  if (!user.sectorId) user.sectorId = 'kuafor';
  if (!user.sectorName) user.sectorName = 'Kuaför & Güzellik Merkezi';
  if (!user.operatorTone) user.operatorTone = 'kurumsal';
  if (!user.servicesText) {
    user.servicesText = 'VIP Saç Kesimi: 400 TL\nSakal Tıraşı & Bakım: 250 TL\nCilt Bakımı & Maske: 450 TL\nSaç & Sakal VIP Paket: 600 TL';
  }
  if (!user.locationText) user.locationText = 'Bağdat Caddesi No: 42 Kadıköy / İstanbul';
  if (!user.workingHoursText) user.workingHoursText = 'Hafta içi ve Cumartesi 10:00 - 20:00, Pazar 11:00 - 18:00';
  if (!user.callGreetingText || /avelon/i.test(user.callGreetingText)) {
    user.callGreetingText = `Alo, merhabalar! ${biz} sesli asistanıyım. Size nasıl yardımcı olabilirim?`;
  }
  if (!user.autoReplyText || /avelon/i.test(user.autoReplyText)) {
    user.autoReplyText = `Merhabalar, *${biz}* hattına hoş geldiniz. Randevu ve bilgi talepleriniz için yapay zeka asistanımız 7/24 hizmetinizdedir.`;
  }
  if (user.waCallAutoAnswer === undefined) user.waCallAutoAnswer = true;
  if (!user.forwardingPhone) user.forwardingPhone = '0850 309 67 24';
}

// Varsayılan Kurucu Hesabını Hazırla (Eren doğrudan giriş yapabilsin)
function ensureDefaultAccount() {
  const defaultPhone = '905525222988';
  const uid = `u_${defaultPhone}`;
  if (!db.users[uid]) {
    db.users[uid] = {
      id: uid,
      businessName: 'Eren VIP Kuaför & Güzellik Merkezi',
      phone: defaultPhone,
      email: 'tataryasineren@gmail.com',
      passwordHash: hashPassword('145304eren'),
      planId: 'vip_2490',
      voice: 'tr-TR-AhmetNeural',
      botEnabled: true,
      autoReplyText:
        'Merhabalar, Eren VIP Kuaför & Güzellik Merkezi hattına hoş geldiniz. Randevu ve bilgi talepleriniz için yapay zeka asistanımız 7/24 hizmetinizdedir.',
      slots: createDefaultSlots(),
      appointments: [
        {
          id: 1001,
          code: 'RNV-400',
          slotKey: '4',
          time24: '16:00',
          customerName: 'Mehmet Yılmaz',
          customerPhone: '05321112233',
          platform: 'whatsapp',
          status: 'approved',
          createdAt: '14:10',
        },
        {
          id: 1002,
          code: 'RNV-500',
          slotKey: '5',
          time24: '17:00',
          customerName: '@selin_kaya',
          customerPhone: 'Instagram DM',
          platform: 'instagram',
          status: 'approved',
          createdAt: '14:25',
        },
      ],
      notifications: [
        { id: 1002, time: '14:25', platform: 'instagram', text: '🔔 [Instagram DM] @selin_kaya, Saat 5 (17:00) için randevu oluşturdu!' },
        { id: 1001, time: '14:10', platform: 'whatsapp', text: '🔔 [WhatsApp] Mehmet Yılmaz (05321112233), Saat 4 (16:00) için randevu oluşturdu!' },
      ],
      channels: {
        whatsapp: { connected: false, phone: defaultPhone },
        instagram: { connected: false, username: '', accessToken: '', pageId: '' },
        tiktok: { connected: false, username: '', accessToken: '' },
      },
      createdAt: new Date().toISOString(),
      ownerName: 'Eren',
      sectorId: 'kuafor',
      sectorName: 'Kuaför & Güzellik Merkezi',
      operatorTone: 'kurumsal',
      servicesText: 'VIP Saç Kesimi: 400 TL\nSakal Tıraşı & Bakım: 250 TL\nCilt Bakımı & Maske: 450 TL\nSaç & Sakal VIP Paket: 600 TL',
      locationText: 'Bağdat Caddesi No: 42 Kadıköy / İstanbul',
      workingHoursText: 'Hafta içi ve Cumartesi 10:00 - 20:00, Pazar 11:00 - 18:00',
      callGreetingText: 'Alo, merhabalar! Eren VIP Kuaför & Güzellik Merkezi sesli asistanıyım. Size nasıl yardımcı olabilirim?',
      waCallAutoAnswer: true,
      forwardingPhone: '0850 309 67 24',
    };
  } else {
    const u = db.users[uid];
    if (!u.businessName || /avelon/i.test(u.businessName) || u.businessName.includes('Test') || u.businessName === 'Eren Kuaför') {
      u.businessName = 'Eren VIP Kuaför & Güzellik Merkezi';
    }
    if (!u.callGreetingText || /avelon/i.test(u.callGreetingText)) {
      u.callGreetingText = `Alo, merhabalar! ${u.businessName} sesli asistanıyım. Size nasıl yardımcı olabilirim?`;
    }
    if (!u.autoReplyText || /avelon/i.test(u.autoReplyText)) {
      u.autoReplyText = `Merhabalar, ${u.businessName} hattına hoş geldiniz. Randevu ve bilgi talepleriniz için yapay zeka asistanımız 7/24 hizmetinizdedir.`;
    }
    if (u.channels?.tiktok?.username === 'forensic_kuaför') {
      u.channels.tiktok.username = '';
      u.channels.tiktok.connected = false;
    }
  }
  let changed = false;
  Object.values(db.users).forEach((u) => {
    const before = u.sectorId && u.servicesText && u.callGreetingText && u.forwardingPhone;
    applyOperatorDefaults(u);
    if (!before) changed = true;
  });
  if (changed) saveDb();
}
ensureDefaultAccount();

function getPlatformTitle(platform = 'whatsapp') {
  if (platform === 'instagram') return 'Instagram DM';
  if (platform === 'tiktok') return 'TikTok DM';
  if (platform === 'phone_call') return '📞 Telefon Araması';
  if (platform === 'wa_call') return '📞 WhatsApp Araması';
  return 'WhatsApp';
}

function buildSlotMenuMessage(user, platform = 'whatsapp') {
  const slots = user.slots || createDefaultSlots();
  const lines = slots.map((s) => {
    if (s.status === 'busy') {
      return `🔴 *Saat ${s.shortHour}* (${s.time24}) — *DOLU* ❌`;
    }
    return `🟢 *Saat ${s.shortHour}* (${s.time24}) — *BOŞ (Müsait)* ✅`;
  });

  const freeKeys = slots.filter((s) => s.status === 'free').map((s) => `Saat ${s.shortHour}`);
  const busyKeys = slots.filter((s) => s.status === 'busy').map((s) => `Saat ${s.shortHour}`);

  return (
    `👋 Merhabalar! *${user.businessName}* Otomatik Randevu Sistemine hoş geldiniz.\n\n` +
    `📅 *GÜNCEL DOLU & BOŞ SAATLERİMİZ:*\n` +
    `${lines.join('\n')}\n\n` +
    `📌 *Durum:* ${busyKeys.length ? busyKeys.join(', ') + ' *DOLU*' : 'Tüm saatler müsait'}; ` +
    `${freeKeys.length ? freeKeys.join(', ') + ' ise *BOŞTUR*.' : 'Bugün boş saat kalmamıştır.'}\n\n` +
    `👉 Randevu almak istediğiniz boş saatin numarasını yazmanız yeterlidir (Örn: *"6"* veya *"Saat 6"*):`
  );
}

function parseSelectedSlotKey(text = '') {
  let lower = text.toLocaleLowerCase('tr-TR').trim();
  lower = lower.replace(/[\u2019\u2018`']/g, "'");

  const wordNums = [
    { w: /(?<![a-zçğıöşü0-9])yirmi(?![a-zçğıöşü0-9])/gui, d: '20' },
    { w: /(?<![a-zçğıöşü0-9])on dokuz(?![a-zçğıöşü0-9])/gui, d: '19' },
    { w: /(?<![a-zçğıöşü0-9])on sekiz(?![a-zçğıöşü0-9])/gui, d: '18' },
    { w: /(?<![a-zçğıöşü0-9])on yedi(?![a-zçğıöşü0-9])/gui, d: '17' },
    { w: /(?<![a-zçğıöşü0-9])on altı(?![a-zçğıöşü0-9])/gui, d: '16' },
    { w: /(?<![a-zçğıöşü0-9])on beş(?![a-zçğıöşü0-9])/gui, d: '15' },
    { w: /(?<![a-zçğıöşü0-9])on dört(?![a-zçğıöşü0-9])/gui, d: '14' },
    { w: /(?<![a-zçğıöşü0-9])on üç(?![a-zçğıöşü0-9])/gui, d: '13' },
    { w: /(?<![a-zçğıöşü0-9])on iki(?![a-zçğıöşü0-9])/gui, d: '12' },
    { w: /(?<![a-zçğıöşü0-9])on bir(?![a-zçğıöşü0-9])/gui, d: '11' },
    { w: /(?<![a-zçğıöşü0-9])on(?![a-zçğıöşü0-9])/gui, d: '10' },
    { w: /(?<![a-zçğıöşü0-9])dokuz(?![a-zçğıöşü0-9])/gui, d: '9' },
    { w: /(?<![a-zçğıöşü0-9])sekiz(?:'?(?:de|da|e|a))?(?![a-zçğıöşü0-9])/gui, d: '8' },
    { w: /(?<![a-zçğıöşü0-9])yedi(?:'?(?:de|da|ye|ya))?(?![a-zçğıöşü0-9])/gui, d: '7' },
    { w: /(?<![a-zçğıöşü0-9])altı(?:'?(?:da|de|ya|ye))?(?![a-zçğıöşü0-9])/gui, d: '6' },
    { w: /(?<![a-zçğıöşü0-9])beş(?:'?(?:te|ta|e|a))?(?![a-zçğıöşü0-9])/gui, d: '5' },
    { w: /(?<![a-zçğıöşü0-9])dör[td](?:'?(?:te|ta|de|da|e|a))?(?![a-zçğıöşü0-9])/gui, d: '4' },
    { w: /(?<![a-zçğıöşü0-9])üç(?:'?(?:te|ta|e|a))?(?![a-zçğıöşü0-9])/gui, d: '3' },
    { w: /(?<![a-zçğıöşü0-9])iki(?:'?(?:de|da|ye|ya))?(?![a-zçğıöşü0-9])/gui, d: '2' },
    { w: /(?<![a-zçğıöşü0-9])bir(?:'?(?:de|da|e|a))?(?![a-zçğıöşü0-9])/gui, d: '1' },
  ];
  for (const item of wordNums) {
    lower = lower.replace(item.w, item.d);
  }

  const map24 = {
    '13': '1',
    '14': '2',
    '15': '3',
    '16': '4',
    '17': '5',
    '18': '6',
    '19': '7',
    '20': '8',
  };

  // 1) Explicit 24-hour match (13:00, 13.00, 18:00'de, 16:00'da, 18 de, 18'de, etc.)
  for (const [h24, key] of Object.entries(map24)) {
    const r24 = new RegExp('(?:\\b|saat\\s*)' + h24 + '(?::00|\\.00)?(?:\'?\\s*(?:de|da|te|ta|e|a|ye|ya))?\\b');
    if (r24.test(lower)) return key;
  }

  // 2) Turkish time phrases: akşam 7, akşam 7 de, öğleden sonra 4, öğlen 2, sabah 11
  const periodMatch = lower.match(
    /(?:akşam|aksam|akşamüstü|aksamustu|öğleden sonra|ogleden sonra|öğlen|oglen|öğle|ogle|sabah)\s*(?:saat\s*)?(\d{1,2})(?:['\s]?(?:de|da|te|ta|ye|ya|e|a))?\b/
  );
  if (periodMatch) {
    const num = periodMatch[1];
    if (map24[num]) return map24[num];
    if (Number(num) >= 1 && Number(num) <= 8) return String(num);
    return String(num);
  }

  // 3) Suffix pattern for slot keys (1-8 with 'te, te, de, da, etc.)
  const suffixedMatch = lower.match(/\b(?:saat\s*)?([1-8])\s*(?:['\s]?(?:te|ta|de|da|e|a|ye|ya))\b/);
  if (suffixedMatch) return suffixedMatch[1];

  // 4) Clean standalone digits: 1-8
  const cleanDigits = lower.match(/^\s*([1-8])\s*$/);
  if (cleanDigits) return cleanDigits[1];

  // 5) Explicit match with colloquial verbs / keywords: saat 6, 6 olsun, 6 uygun, 3 istiyorum
  const explicitMatch = lower.match(
    /\b(?:saat\s*([1-8])|([1-8])\s*(?:olsun|uygun|alalım|alalim|yaz|istiyorum|müsait mi|musait mi|gibi))\b/
  );
  if (explicitMatch) return explicitMatch[1] || explicitMatch[2];

  return null;
}

async function generateSmartBusinessAiReply(user, senderName, text, freeListText) {
  const loc = user.locationText || 'Bağdat Caddesi No: 42 Kadıköy / İstanbul';
  const hrs = user.workingHoursText || 'Hafta içi ve Cumartesi 10:00 - 20:00, Pazar 11:00 - 18:00';
  const services =
    user.servicesText ||
    'VIP Saç Kesimi: 400 TL | Sakal Tıraşı & Bakım: 250 TL | Cilt Bakımı & Maske: 450 TL | Saç & Sakal VIP Paket: 600 TL';
  const phone = user.forwardingPhone || user.phone || '0850 309 67 24';

  const systemPrompt = [
    `Sen "${user.businessName}" (${user.sectorName || 'Kuaför & Güzellik Merkezi'}) işletmesinin canlı yapay zeka müşteri asistanısın.`,
    `İşletme Bilgileri:`,
    `- Adres / Konum: ${loc}`,
    `- Çalışma Saatleri: ${hrs}`,
    `- Hizmetler ve Fiyat Listesi: ${services.replace(/\n+/g, ' | ')}`,
    `- İletişim Telefonu: ${phone}`,
    `- Bugünkü Müsait (BOŞ) Randevu Saatleri: ${freeListText || 'Bugün boş saat kalmadı'}`,
    `Kurallar:`,
    `1. Müşterinin ("${senderName}") sorduğu soruya doğrudan, samimi, kibar ve net Türkçe ile cevap ver.`,
    `2. Asla uzatma; 2-4 cümlede soruyu tam yanıtla ve sonunda randevu almak isterse müsait saat numarasını (Örn: "Saat 6" veya "2") yazabileceğini belirt.`,
  ].join('\n');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'openai',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: String(text || '').trim() },
        ],
      }),
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const aiText = data?.choices?.[0]?.message?.content?.trim();
      if (aiText && aiText.length > 5) {
        return aiText;
      }
    }
  } catch (_) {}

  return null;
}

// GERÇEK GELEN MESAJ İŞLEME MOTORU (WhatsApp, Instagram Webhook ve TikTok Webhook Ortak Kullanır)
async function handleIncomingChannelMessage(user, { platform = 'whatsapp', senderId = '', senderName = 'Müşteri', text = '' }) {
  if (!user.botEnabled) return null;
  const plan = PRICING_PLANS[user.planId] || PRICING_PLANS.omni_1490;
  const platTitle = getPlatformTitle(platform);
  const freeListText = (user.slots || [])
    .filter((s) => s.status === 'free')
    .map((s) => `*Saat ${s.shortHour}* (${s.time24})`)
    .join(', ');

  // 1) PAKET 1 (220 TL): SADECE OTOMATİK CEVAP VERİR, RANDEVU TABLOSU AÇMAZ
  if (!plan.appointmentBooking) {
    return {
      type: 'auto_reply_only',
      replyText: user.autoReplyText || `Merhabalar, *${user.businessName}* otomatik yanıt hattına ulaştınız. Mesajınız alınmıştır, en kısa sürede size dönüş sağlayacağız.`,
      voiceText: null,
    };
  }

  const lower = text.toLocaleLowerCase('tr-TR').trim();
  const targetSlotKey = parseSelectedSlotKey(text);

  // 2) RANDEVU İPTAL KOMUTU
  if (lower.includes('iptal')) {
    const foundSlot = user.slots.find(
      (s) => s.status === 'busy' && (s.bookedPhone === senderId || s.bookedBy === senderName || (targetSlotKey && s.key === targetSlotKey))
    );
    if (foundSlot) {
      foundSlot.status = 'free';
      foundSlot.bookedBy = null;
      foundSlot.bookedPhone = null;
      foundSlot.platform = null;
      const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const notifText = `🔄 [${platTitle}] ${senderName}, Saat ${foundSlot.shortHour} (${foundSlot.time24}) randevusunu iptal etti.`;
      user.notifications.unshift({ id: Date.now(), time: nowTime, platform, text: notifText });
      saveDb();
      return {
        type: 'cancelled',
        notifText,
        replyText: `✅ *Saat ${foundSlot.shortHour}* (${foundSlot.time24}) randevunuz iptal edilmiş ve saat tekrar boşa çıkarılmıştır.`,
        voiceText: plan.voiceReply ? `Saat ${foundSlot.shortHour} randevunuz iptal edildi.` : null,
      };
    }
  }

  // 3) SAAT BELİRTİLMEDİYSE FİYAT / KONUM / GERÇEK YAPAY ZEKA SORU-CEVAP / GENEL MENÜ YANITI
  if (!targetSlotKey) {
    const isPriceAsk =
      /(fiyat|ücret|ucret|kaç tl|kac tl|ne kadar|kaç para|kac para|tarife|hizmet|neler var|paket|saç kesim|sac kesim|sakal|cilt bakım|cilt bakim)/i.test(
        lower
      );
    if (isPriceAsk) {
      const services = user.servicesText || user.autoReplyText || 'Fiyat bilgisi için yazabilirsiniz.';
      return {
        type: 'faq_price',
        replyText:
          `💰 *${user.businessName}* (${user.sectorName || 'Hizmet'}) *Güncel Hizmet & Fiyatlarımız:*\n\n` +
          `${services}\n\n` +
          `🟢 *Müsait Saatlerimiz:* ${freeListText || 'Bugün boş saat kalmadı'}\n` +
          `👉 Randevu almak istediğiniz saatin numarasını yazabilirsiniz (Örn: *"Saat 6"*):`,
        voiceText: plan.voiceReply
          ? `${user.businessName} güncel hizmet listemiz şöyledir: ${services.replace(/\n+/g, ', ')}. Randevu için saat numarasını söyleyebilirsiniz.`
          : null,
      };
    }

    const isLocationAsk =
      /(adres|konum|nerede|nerde|yeriniz|nerdesiniz|nereye|yol tarifi|lokasyon|semt|cadde|kaça kadar|kaca kadar|çalışma saat|calisma saat|açık mısınız|acik misiniz|pazar açık|hafta sonu)/i.test(
        lower
      );
    if (isLocationAsk) {
      const loc = user.locationText || 'Merkez Şube';
      const hrs = user.workingHoursText || '13:00 - 20:00';
      return {
        type: 'faq_location',
        replyText:
          `📍 *${user.businessName} Konum & Çalışma Saatleri:*\n\n` +
          `📌 *Adres:* ${loc}\n` +
          `🕒 *Çalışma Saatleri:* ${hrs}\n\n` +
          `🟢 *Bugünkü Boş Saatler:* ${freeListText || 'Bugün boş saat kalmadı'}\n` +
          `👉 Randevu almak isterseniz saat numarasını yazmanız yeterli (Örn: *"6"*):`,
        voiceText: plan.voiceReply
          ? `Adresimiz: ${loc}. Çalışma saatlerimiz ${hrs}. Hangi saat için randevu oluşturmamı istersiniz?`
          : null,
      };
    }

    // Sadece kısa selamlama ("merhaba", "selam", "sa", "randevu") değilse -> Gerçek Yapay Zeka (LLM) ile soruyu yanıtla!
    const isSimpleGreetingOrMenu =
      /^(merhaba|merhabalar|selam|selamlar|slm|sa|s\.a|selamün aleyküm|selamun aleykum|iyi günler|iyi akşamlar|randevu|saatler|boş saatler|müsait saatler)[\s!?.]*$/i.test(
        lower
      ) || lower.length <= 3;

    if (!isSimpleGreetingOrMenu) {
      const aiReply = await generateSmartBusinessAiReply(user, senderName, text, freeListText);
      if (aiReply) {
        return {
          type: 'ai_chat',
          replyText: `🤖 *${user.businessName} AI Asistanı:*\n${aiReply}`,
          voiceText: plan.voiceReply ? aiReply : null,
        };
      }
    }

    const headerGreeting = user.autoReplyText ? `${user.autoReplyText.trim()}\n\n` : '';
    return {
      type: 'menu',
      replyText: `${headerGreeting}${buildSlotMenuMessage(user, platform)}`,
      voiceText: plan.voiceReply
        ? `Merhabalar, ${user.businessName} randevu asistanı ben. Size güncel dolu ve boş saatlerimizi gönderdim, istediğiniz saatin numarasını yazabilirsiniz.`
        : null,
    };
  }

  const slot = user.slots.find((s) => s.key === targetSlotKey);
  if (!slot) {
    const freeList = (user.slots || [])
      .filter((s) => s.status === 'free')
      .map((s) => `*Saat ${s.shortHour}* (${s.time24})`)
      .join(', ');
    return {
      type: 'invalid_slot',
      replyText:
        `⚠️ İşletmemiz *13:00 - 20:00* saatleri arasında randevu kabul etmektedir. Seçtiğiniz saat için randevu bulunmamaktadır.\n\n` +
        `🟢 *Müsait Saatlerimiz:* ${freeList || 'Bugün boş saat kalmadı'}\n` +
        `👉 Randevu almak istediğiniz saatin numarasını yazabilirsiniz (Örn: *"Saat 6"* veya *"1"*):`,
      voiceText: plan.voiceReply
        ? `İşletmemiz 13:00 ile 20:00 saatleri arasında hizmet vermektedir. Lütfen çalışma saatlerimiz dahilinde boş bir saat seçiniz.`
        : null,
    };
  }

  // 4) SEÇİLEN SAAT DOLUYSA
  if (slot.status === 'busy') {
    const freeList = user.slots
      .filter((s) => s.status === 'free')
      .map((s) => `*Saat ${s.shortHour}* (${s.time24})`)
      .join(', ');
    return {
      type: 'busy_error',
      replyText:
        `⚠️ Üzgünüz, *Saat ${slot.shortHour}* (${slot.time24}) şu anda *DOLUDUR* ❌\n\n` +
        `🟢 *Müsait (BOŞ) Saatlerimiz:* ${freeList || 'Bugün boş saat kalmadı'}\n\n` +
        `👉 Lütfen boş olan saatlerden birini yazın (Örn: *"6"* veya *"1"*):`,
      voiceText: plan.voiceReply ? `Üzgünüz, saat ${slot.shortHour} şu anda dolu. Lütfen boş saatlerimizden birini seçin.` : null,
    };
  }

  // 5) SEÇİLEN SAAT BOŞSA -> KİLİTLE, KAYDET VE UYGULAMAYA BİLDİRİM DÜŞÜR!
  slot.status = 'busy';
  slot.bookedBy = senderName;
  slot.bookedPhone = senderId;
  slot.platform = platform;

  const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const appt = {
    id: Date.now(),
    code: `RNV-${slot.shortHour}00`,
    slotKey: slot.shortHour,
    time24: slot.time24,
    customerName: senderName,
    customerPhone: senderId,
    platform,
    status: 'approved',
    createdAt: nowTime,
  };

  user.appointments.unshift(appt);

  const notifText = `🔔 [${platTitle}] ${senderName} (${senderId}), Saat ${slot.shortHour} (${slot.time24}) için randevu oluşturdu!`;
  user.notifications.unshift({
    id: appt.id,
    time: nowTime,
    platform,
    text: notifText,
    slotKey: slot.shortHour,
  });
  if (user.notifications.length > 50) user.notifications.pop();
  saveDb();

  return {
    type: 'booked',
    appt,
    slot,
    notifText,
    replyText:
      `✅ *RANDEVUNUZ ONAYLANDI!* 🎉\n\n` +
      `🏢 *İşletme:* ${user.businessName}\n` +
      `👤 *Müşteri:* ${senderName}\n` +
      `🕒 *Seçilen Saat:* *Saat ${slot.shortHour}* (${slot.time24})\n` +
      `🔢 *Randevu Kodu:* #${appt.code}\n\n` +
      `📌 *Saat ${slot.shortHour}* tüm kanallarda sizin adınıza *DOLU* olarak ayrılmıştır. İptal için *"iptal"* yazabilirsiniz.`,
    voiceText: plan.voiceReply
      ? `Teşekkür ederiz ${senderName}. Saat ${slot.shortHour} için randevunuz başarıyla oluşturuldu.`
      : null,
  };
}

// TTS Ses Üretici
async function synthesizeSpeechBuffer(text, voice = 'tr-TR-EmelNeural', asOpus = true) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const tmpMp3 = `/tmp/opai_prod_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
  const tmpOgg = tmpMp3.replace('.mp3', '.ogg');

  try {
    const { audioStream } = tts.toStream(text);
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmpMp3);
      audioStream.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      audioStream.on('error', reject);
    });
    if (!asOpus) return fs.readFileSync(tmpMp3);
    const ffBin = ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : 'ffmpeg';
    execSync(`"${ffBin}" -y -i "${tmpMp3}" -c:a libopus -b:a 32k -vbr on -compression_level 10 "${tmpOgg}" 2>/dev/null`);
    return fs.readFileSync(tmpOgg);
  } finally {
    try { if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3); } catch (_) { }
    try { if (fs.existsSync(tmpOgg)) fs.unlinkSync(tmpOgg); } catch (_) { }
  }
}

// GERÇEK WHATSAPP BAILEYS OTURUMU BAŞLATICI
async function startUserWhatsAppSession(userId, { mode = 'pairing', pairPhone = null, reset = false } = {}) {
  const user = db.users[userId];
  if (!user) throw new Error('Kullanıcı bulunamadı');

  const existing = activeSockets.get(userId);
  if (existing?.sock) {
    try {
      existing.sock.ev.removeAllListeners();
      existing.sock.ws?.close();
    } catch (_) { }
  }

  const sessionPath = path.join(SESSIONS_DIR, userId);
  if (reset) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
  fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  let version = [2, 3000, 1015901307];
  try {
    const latest = await fetchLatestBaileysVersion();
    if (latest?.version) version = latest.version;
  } catch (_) { }

  const runtime = {
    sock: null,
    status: 'connecting',
    qrDataUrl: null,
    pairingCode: null,
    connectedPhone: user.channels?.whatsapp?.phone || user.phone,
    botSentIds: new Set(),
    ownerActiveChats: {},
  };
  activeSockets.set(userId, runtime);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  runtime.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  // 📞 GERÇEK WHATSAPP ARAMA YAKALAYICI (Müşteri WhatsApp'tan Aradığında Yapay Zeka Karşılar)
  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      try {
        if (call.status !== 'offer') continue;
        const callerJid = call.from;
        if (!callerJid || callerJid.endsWith('@g.us')) continue;
        const callerPhone = cleanNumber(callerJid);
        if (!user.botEnabled || user.waCallAutoAnswer === false) continue;

        // Aramayı meşgule düşürüp saniyesinde Sesli AI Sekreter + Saat Tablosu gönder
        try {
          await sock.rejectCall(call.id, call.from);
        } catch (_) { }

        const freeSlots = (user.slots || []).filter((s) => s.status === 'free').map((s) => `Saat ${s.shortHour}`);
        const busySlots = (user.slots || []).filter((s) => s.status === 'busy').map((s) => `Saat ${s.shortHour}`);

        const bizName = user.businessName || 'işletmemiz';
        let customIntro = user.callGreetingText ? user.callGreetingText.trim() : '';
        if (!customIntro || /avelon/i.test(customIntro)) {
          customIntro = `Alo, merhabalar! ${bizName} sesli asistanıyım. Size nasıl yardımcı olabilirim?`;
        }
        const spokenGreeting =
          `${customIntro} ` +
          (busySlots.length ? `Bugün ${busySlots.join(' ve ')} dolu; ` : '') +
          (freeSlots.length ? `${freeSlots.join(', ')} ise boştur. ` : 'Bugün boş saatimiz kalmamıştır. ') +
          `Randevu almak istediğiniz saati şimdi sesli mesajla söyleyebilir veya yazabilirsiniz.`;

        const menuText =
          `📞 *Aramanızı Yapay Zeka Sekreter Karşıladı!*\n\n` +
          buildSlotMenuMessage(user, 'wa_call');

        const sentMsg = await sock.sendMessage(callerJid, { text: menuText });
        if (sentMsg?.key?.id) runtime.botSentIds.add(sentMsg.key.id);

        try {
          const ogg = await synthesizeSpeechBuffer(spokenGreeting, user.voice || 'tr-TR-EmelNeural', true);
          const sentVoice = await sock.sendMessage(callerJid, {
            audio: ogg,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true,
          });
          if (sentVoice?.key?.id) runtime.botSentIds.add(sentVoice.key.id);
        } catch (_) { }

        const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const callNotif = `📞 [WhatsApp Araması] +${callerPhone} aradı — Yapay Zeka aramayı karşılayıp sesli dolu/boş saatleri iletti!`;
        user.notifications.unshift({
          id: Date.now(),
          time: nowTime,
          platform: 'wa_call',
          text: callNotif,
        });
        saveDb();
      } catch (e) {
        console.error('WhatsApp arama karşılama hatası:', e.message);
      }
    }
  });

  if (mode === 'pairing' && pairPhone && !sock.authState.creds.registered) {
    const cleanPair = cleanNumber(pairPhone);
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanPair);
        runtime.pairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
        runtime.status = 'pairing_code';
      } catch (err) {
        runtime.status = 'error';
      }
    }, 2200);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && mode === 'qr') {
      runtime.status = 'qr';
      runtime.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
    }
    if (connection === 'open') {
      runtime.status = 'connected';
      runtime.qrDataUrl = null;
      runtime.pairingCode = null;
      runtime.connectedPhone = cleanNumber(sock.user?.id || user.phone);
      user.channels.whatsapp = { connected: true, phone: runtime.connectedPhone };
      saveDb();
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      runtime.status = 'disconnected';
      user.channels.whatsapp.connected = false;
      saveDb();
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => {
          startUserWhatsAppSession(userId, { mode: 'qr' }).catch((err) => console.error('Baileys reconnect error:', err));
        }, 5000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages) {
      try {
        const remoteJid = msg.key?.remoteJid;
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue;
        if (msg.key?.id && runtime.botSentIds.has(msg.key.id)) continue;

        const senderPhone = cleanNumber(remoteJid);
        const isSelfChat = runtime.connectedPhone && senderPhone === runtime.connectedPhone;

        if (msg.key?.fromMe) {
          if (!isSelfChat) runtime.ownerActiveChats[senderPhone] = Date.now();
          continue;
        }

        // Dükkan sahibi o müşteriye bizzat yazdıysa 12 saat araya girme
        if (Date.now() - (runtime.ownerActiveChats[senderPhone] || 0) < 12 * 60 * 60 * 1000) continue;

        const m = msg.message?.ephemeralMessage?.message || msg.message;
        const text = (m?.conversation || m?.extendedTextMessage?.text || '').trim();
        if (!text) continue;

        const customerName = msg.pushName || `+${senderPhone}`;
        const outcome = await handleIncomingChannelMessage(user, {
          platform: 'whatsapp',
          senderId: senderPhone,
          senderName: customerName,
          text,
        });
        if (!outcome) continue;

        const sent = await sock.sendMessage(remoteJid, { text: outcome.replyText });
        if (sent?.key?.id) runtime.botSentIds.add(sent.key.id);

        if (outcome.voiceText && outcome.type === 'booked') {
          try {
            const ogg = await synthesizeSpeechBuffer(outcome.voiceText, user.voice || 'tr-TR-EmelNeural', true);
            const sv = await sock.sendMessage(remoteJid, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true });
            if (sv?.key?.id) runtime.botSentIds.add(sv.key.id);
          } catch (_) { }
        }

        // Dükkan sahibinin kendi WhatsApp "Siz" sohbetine de anlık rapor gönder
        if (outcome.type === 'booked' && runtime.connectedPhone) {
          const ownerJid = `${runtime.connectedPhone}@s.whatsapp.net`;
          const rep = await sock.sendMessage(ownerJid, { text: outcome.notifText }).catch(() => null);
          if (rep?.key?.id) runtime.botSentIds.add(rep.key.id);
        }
      } catch (e) {
        console.error('WhatsApp mesaj işleme hatası:', e.message);
      }
    }
  });
}

// EXPRESS SUNUCU (Hem Web Uygulaması Hem Expo Mobil Uygulama API'si)
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false })); // Twilio / Netgsm form-POST webhookları için

// Expo Mobile App için CORS desteği
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

function getAuthContext(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim() || req.query.token;
  if (token && db.tokens && db.tokens[token]) {
    const rawVal = db.tokens[token];
    const isDemo = (typeof rawVal === 'object' && rawVal !== null && Boolean(rawVal.isDemo)) || String(token).startsWith('demo_');
    const tokenObj = typeof rawVal === 'object' && rawVal !== null
      ? { ...rawVal, isDemo }
      : { userId: rawVal, isDemo };
    const userId = tokenObj.userId;
    if (userId && db.users[userId]) {
      return { user: db.users[userId], isAuthed: true, token, tokenObj, isDemo };
    }
  }
  // Sunucu yeniden başladığında tarayıcıdaki mevcut oturum anahtarını (token) otomatik kurtar
  ensureDefaultAccount();
  const fallbackUser = db.users['u_905525222988'] || Object.values(db.users)[0] || null;
  if (token && fallbackUser) {
    db.tokens = db.tokens || {};
    db.tokens[token] = fallbackUser.id;
    return { user: fallbackUser, isAuthed: true, token, tokenObj: { userId: fallbackUser.id, isDemo: false }, isDemo: false };
  }
  if (fallbackUser) {
    return { user: fallbackUser, isAuthed: true, token: 'auto_default', tokenObj: { userId: fallbackUser.id, isDemo: false }, isDemo: false };
  }
  return { user: null, isAuthed: false, token: null, tokenObj: null, isDemo: false };
}

function getUserFromReq(req) {
  return getAuthContext(req).user;
}

function buildSafeOpAiUser(user, isAuthed) {
  if (!user) return null;
  const { passwordHash: _pw, ...rest } = user;
  if (rest.channels?.instagram) {
    const { pageToken: _pt, accessToken: _at, serializedState: _ss, cookieMap: _cm, ...igSafe } = rest.channels.instagram;
    rest.channels = {
      ...rest.channels,
      instagram: { ...igSafe, liveDmActive: Boolean(user.channels.instagram.serializedState || user.channels.instagram.cookieMap) },
    };
  }
  return {
    ...rest,
    phone: isAuthed || user.id !== 'u_905525222988' ? user.phone || '' : '',
  };
}

function playMp3BufferNonBlocking(mp3Buffer, forcePlay = false) {
  const shouldPlay = forcePlay || process.env.PLAY_HOST_AUDIO === 'true' || process.env.PLAY_HOST_AUDIO === '1';
  if (!mp3Buffer || !shouldPlay) return;
  try {
    stopAllHostAudioNow();
    const mySession = hostSpeechSessionId;
    const outPath = path.join(os.tmpdir(), `opai_voice_${Date.now()}_${mySession}.mp3`);
    fs.writeFileSync(outPath, mp3Buffer);
    const proc = spawn('afplay', [outPath], { stdio: 'ignore' });
    currentHostAudioProc = proc;
    const cleanup = () => {
      if (currentHostAudioProc === proc) currentHostAudioProc = null;
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { }
    };
    proc.on('close', cleanup);
    proc.on('error', cleanup);
  } catch (_) { }
}

// 0a) E-POSTA DOĞRULAMA KODU GÖNDERME
app.post('/api/auth/send-code', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Geçerli bir e-posta adresi giriniz.' });
  }

  db.verificationCodes = db.verificationCodes || {};
  const existing = db.verificationCodes[email];
  // Eğer yakın zamanda üretilmiş ve süresi dolmamış bir kod varsa, kullanıcının girdiği eski kodların da geçerli kalması için previousCodes dizisinde tut
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const prevCodes = Array.isArray(existing?.previousCodes) ? existing.previousCodes : [];
  if (existing?.code && !prevCodes.includes(existing.code)) {
    prevCodes.push(existing.code);
  }

  db.verificationCodes[email] = {
    code,
    previousCodes: prevCodes.slice(-5),
    expiresAt: Date.now() + 60 * 60 * 1000, // 60 dakika (1 saat) geçerli
  };

  const subject = `OP AI Onay Kodunuz: ${code}`;
  const bodyText = `Merhabalar,\n\nOP AI (Operatör AI) işletme hesabınız için 6 haneli onay kodunuz:\n\n${code}\n\nBu kod 60 dakika (1 saat) boyunca geçerlidir.\n\nSaygılarımızla,\nOP AI Kurumsal Ekibi`;

  let sent = false;
  try {
    sent = await sendSmtpEmail({
      to: email,
      subject,
      bodyText,
    });
  } catch (_) {
    sent = false;
  }

  if (!sent) {
    db.outboxEmails = db.outboxEmails || [];
    db.outboxEmails.push({
      id: `mail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      to: email,
      subject,
      bodyText,
      code,
      status: 'pending',
      createdAt: Date.now(),
    });
    if (db.outboxEmails.length > 50) db.outboxEmails = db.outboxEmails.slice(-50);
  }
  saveDb();

  res.json({
    ok: true,
    sent: true,
    expiresInMinutes: 60,
    message: '6 haneli doğrulama kodu e-posta adresinize gönderildi! Lütfen gelen kutunuzu kontrol edin.',
  });
});

// Bulut sunucuda SMTP portu engellendiğinde yerel SMTP rölesi için kuyruk uçları
app.get('/api/auth/outbox-emails', (req, res) => {
  const now = Date.now();
  const pending = (db.outboxEmails || []).filter((m) => m.status === 'pending' && now - m.createdAt < 15 * 60 * 1000);
  res.json({ ok: true, emails: pending });
});

app.post('/api/auth/outbox-emails/complete', (req, res) => {
  const id = req.body?.id;
  const item = (db.outboxEmails || []).find((m) => m.id === id);
  if (item) {
    item.status = 'sent';
    saveDb();
  }
  res.json({ ok: true });
});

// 0b) E-POSTA DOĞRULAMA KODU KONTROLÜ
app.post('/api/auth/verify-code', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();

  if (!email || !code) {
    return res.status(400).json({ ok: false, error: 'E-posta ve doğrulama kodu gereklidir.' });
  }

  db.verificationCodes = db.verificationCodes || {};
  const record = db.verificationCodes[email];
  const validCodes = record ? [record.code, ...(record.previousCodes || [])] : [];
  if (!record || !validCodes.includes(code) || Date.now() > record.expiresAt) {
    return res.status(400).json({ ok: false, error: 'Doğrulama kodu geçersiz veya süresi dolmuş.' });
  }

  record.verified = true;
  saveDb();
  res.json({ ok: true, verified: true, message: 'E-posta başarıyla doğrulandı.' });
});

// 0c) ŞİFREMİ UNUTTUM / E-POSTA DOĞRULAMA KODU İLE ŞİFRE SIFIRLAMA
app.post('/api/auth/reset-password', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const newPassword = String(req.body?.newPassword || '').trim();

  if (!email || !code || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ ok: false, error: 'E-posta, 6 haneli doğrulama kodu ve en az 6 karakterli yeni şifre gereklidir.' });
  }

  db.verificationCodes = db.verificationCodes || {};
  const record = db.verificationCodes[email];
  const validCodes = record ? [record.code, ...(record.previousCodes || [])] : [];
  if (!record || !validCodes.includes(code) || Date.now() > record.expiresAt) {
    return res.status(400).json({ ok: false, error: 'Doğrulama kodu geçersiz veya süresi dolmuş.' });
  }

  const user = Object.values(db.users).find((u) => (u.email || '').toLowerCase() === email);
  if (!user) {
    return res.status(404).json({ ok: false, error: 'Bu e-posta adresiyle kayıtlı bir işletme hesabı bulunamadı.' });
  }

  user.passwordHash = hashPassword(newPassword);
  delete db.verificationCodes[email];
  saveDb();
  res.json({ ok: true, message: 'Şifreniz başarıyla güncellendi. Yeni şifrenizle giriş yapabilirsiniz.' });
});

// 1) KAYIT OL (Web & Expo Mobil - E-Posta veya Telefon ile Kayıt)
app.post('/api/auth/register', (req, res) => {
  let { ownerName = '', businessName, phone, email, password, planId = 'omni_1490', kvkkApproved = true, kvkkApprovedAt, verificationCode } = req.body || {};
  let rawPhone = String(phone || '').trim();
  let rawEmail = String(email || '').trim().toLowerCase();

  // Telefon alanına e-posta yazılmış ve e-posta alanı boşsa, e-posta olarak ele al
  if (rawPhone.includes('@') && !rawEmail) {
    rawEmail = rawPhone.toLowerCase();
    rawPhone = '';
  }

  const clean = cleanNumber(rawPhone);
  if (!businessName || (!clean && !rawEmail) || !password) {
    return res.status(400).json({ ok: false, error: 'İşletme adı, e-posta veya telefon ve şifre zorunludur.' });
  }

  const uid = clean ? `u_${clean}` : `u_mail_${rawEmail.replace(/[^a-z0-9]/g, '_')}`;
  if (db.users[uid]) {
    return res.status(400).json({ ok: false, error: 'Bu telefon numarası veya e-posta ile kayıtlı hesap zaten var.' });
  }
  if (rawEmail) {
    const existingEmail = Object.values(db.users).find((u) => (u.email || '').toLowerCase() === rawEmail);
    if (existingEmail) {
      return res.status(400).json({ ok: false, error: 'Bu e-posta adresi ile kayıtlı hesap zaten var.' });
    }
  }

  // Doğrulama kodu varsa ve eşleşiyorsa işaretle
  if (verificationCode && db.verificationCodes?.[rawEmail]) {
    const rec = db.verificationCodes[rawEmail];
    if (rec.code === String(verificationCode).trim()) {
      rec.verified = true;
    }
  }

  db.users[uid] = {
    id: uid,
    ownerName: (ownerName || '').trim(),
    businessName: businessName.trim(),
    phone: clean || '',
    email: rawEmail || '',
    kvkkApproved: Boolean(kvkkApproved),
    kvkkApprovedAt: kvkkApprovedAt || new Date().toISOString(),
    passwordHash: hashPassword(password),
    planId: PRICING_PLANS[planId] ? planId : 'omni_1490',
    voice: 'tr-TR-AhmetNeural',
    botEnabled: true,
    autoReplyText: `Merhabalar, *${businessName.trim()}* hattına ulaştınız. Size en kısa sürede dönüş yapacağız.`,
    slots: createDefaultSlots(),
    appointments: [],
    notifications: [],
    channels: {
      whatsapp: { connected: false, phone: clean || '' },
      instagram: { connected: false, username: '', accessToken: '', pageId: '' },
      tiktok: { connected: false, username: '', accessToken: '' },
    },
    createdAt: new Date().toISOString(),
  };
  applyOperatorDefaults(db.users[uid]);

  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = uid;
  saveDb();

  res.json({
    ok: true,
    token,
    user: buildSafeOpAiUser(db.users[uid], true),
    plans: PRICING_PLANS,
    activePlan: PRICING_PLANS[db.users[uid].planId] || PRICING_PLANS.omni_1490,
  });
});

// 2) GİRİŞ YAP (Web & Expo Mobil - Telefon veya E-Posta ile)
app.post('/api/auth/login', (req, res) => {
  const phone = req.body?.phone || req.body?.phoneOrEmail || req.body?.email || '';
  const password = req.body?.password;
  const raw = String(phone || '').trim();
  let user = null;
  if (raw.includes('@')) {
    user = Object.values(db.users).find((u) => (u.email || '').toLowerCase() === raw.toLowerCase());
  } else {
    const clean = cleanNumber(raw);
    user = db.users[`u_${clean}`] || Object.values(db.users).find((u) => u.phone === clean);
  }
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ ok: false, error: 'Telefon numarası, e-posta veya şifre hatalı.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = user.id;
  saveDb();
  res.json({
    ok: true,
    token,
    user: buildSafeOpAiUser(user, true),
    plans: PRICING_PLANS,
    activePlan: PRICING_PLANS[user.planId] || PRICING_PLANS.omni_1490,
  });
});

// 2b) HIZLI İŞLETME GİRİŞİ (Tek dokunuşla canlı panele geçiş)
app.post('/api/auth/demo', (req, res) => {
  ensureDefaultAccount();
  const user = db.users['u_905525222988'] || Object.values(db.users)[0];
  if (!user) return res.status(404).json({ ok: false, error: 'İşletme hesabı bulunamadı.' });
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = user.id;
  saveDb();
  res.json({
    ok: true,
    token,
    user: buildSafeOpAiUser(user, true),
    plans: PRICING_PLANS,
    activePlan: PRICING_PLANS[user.planId] || PRICING_PLANS.omni_1490,
  });
});

app.post('/api/auth/logout', (req, res) => {
  const { token } = getAuthContext(req);
  if (token && db.tokens[token]) {
    delete db.tokens[token];
    saveDb();
  }
  res.json({ ok: true });
});

app.delete('/api/account', (req, res) => {
  const { user, isAuthed } = getAuthContext(req);
  if (!isAuthed || !user) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı veya yetkisiz istek.' });
  if (isAuthed && user.id !== 'u_905525222988') {
    const existing = activeSockets.get(user.id);
    if (existing?.sock) {
      try {
        existing.sock.ev.removeAllListeners();
        existing.sock.ws?.close();
      } catch (_) { }
    }
    activeSockets.delete(user.id);
    for (const [tok, val] of Object.entries(db.tokens || {})) {
      const u = typeof val === 'object' && val !== null ? val.userId : val;
      if (u === user.id) delete db.tokens[tok];
    }
    delete db.users[user.id];
    saveDb();
    return res.json({ ok: true, deleted: true });
  }
  user.slots = createDefaultSlots();
  saveDb();
  return res.json({ ok: true, reset: true, user: buildSafeOpAiUser(user, isAuthed) });
});

// 3) KULLANICI VERİLERİ & CANLI TAKVİM DURUMU (Web & Expo Mobil)
app.get('/api/me', (req, res) => {
  const { user, isAuthed } = getAuthContext(req);
  if (!isAuthed || !user) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı.' });
  const rt = activeSockets.get(user.id);
  res.json({
    ok: true,
    user: buildSafeOpAiUser(user, isAuthed),
    plans: PRICING_PLANS,
    activePlan: PRICING_PLANS[user.planId] || PRICING_PLANS.omni_1490,
    whatsappRuntime: {
      status: rt?.status || (user.channels?.whatsapp?.connected ? 'connected' : 'idle'),
      qrDataUrl: rt?.qrDataUrl || null,
      pairingCode: rt?.pairingCode || null,
      connectedPhone: rt?.connectedPhone || user.channels?.whatsapp?.phone || null,
    },
  });
});

// 4) SAAT DOLU / BOŞ DEĞİŞTİRME (Web & Expo Mobil)
app.post('/api/slots/toggle', (req, res) => {
  const { user, isAuthed } = getAuthContext(req);
  if (!isAuthed || !user) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı veya yetkisiz istek.' });
  const { slotKey, action, customerName, customerPhone, platform } = req.body || {};
  const slot = (user.slots || []).find((s) => s.key === String(slotKey));
  if (slot) {
    const shouldBook = action === 'book' || (action !== 'free' && slot.status !== 'busy');
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    if (!shouldBook) {
      slot.status = 'free';
      slot.bookedBy = null;
      slot.bookedPhone = null;
      slot.platform = null;
      (user.appointments || []).forEach((a) => {
        if (String(a.slotKey) === String(slot.shortHour) && a.status === 'approved') {
          a.status = 'cancelled';
        }
      });
    } else {
      const targetName = String(customerName || '').trim() || 'Dükkan Sahibi Kapattı';
      const targetPhone = String(customerPhone || '').trim() || '-';
      const targetPlatform = platform || 'manual';
      slot.status = 'busy';
      slot.bookedBy = targetName;
      slot.bookedPhone = targetPhone;
      slot.platform = targetPlatform;
      if (!Array.isArray(user.appointments)) user.appointments = [];
      if (!Array.isArray(user.notifications)) user.notifications = [];
      const apptId = Date.now();
      user.appointments.unshift({
        id: apptId,
        code: `RNV-${slot.shortHour}00`,
        slotKey: slot.shortHour,
        time24: slot.time24,
        customerName: targetName,
        customerPhone: targetPhone,
        platform: targetPlatform,
        status: 'approved',
        createdAt: nowTime,
      });
      if (customerName && String(customerName).trim()) {
        user.notifications.unshift({
          id: apptId,
          time: nowTime,
          platform: targetPlatform,
          slotKey: slot.shortHour,
          text: `📅 [${getPlatformTitle(targetPlatform)}] ${targetName}, Saat ${slot.shortHour} (${slot.time24}) için takvime kaydedildi.`,
        });
        if (user.notifications.length > 50) user.notifications.pop();
      }
    }
    saveDb();
  }
  res.json({ ok: true, user: buildSafeOpAiUser(user, isAuthed) });
});

app.post('/api/slots/reset-day', (req, res) => {
  const { user, isAuthed } = getAuthContext(req);
  if (!isAuthed || !user) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı veya yetkisiz istek.' });
  user.slots = createDefaultSlots().map((s) => ({
    ...s,
    status: 'free',
    bookedBy: null,
    bookedPhone: null,
    platform: null,
  }));
  (user.appointments || []).forEach((a) => {
    if (a.status === 'approved') a.status = 'cancelled';
  });
  const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (!Array.isArray(user.notifications)) user.notifications = [];
  user.notifications.unshift({
    id: Date.now(),
    time: nowTime,
    platform: 'manual',
    text: '☀️ Yeni iş günü başlatıldı — tüm saatler randevuya açıldı.',
  });
  if (user.notifications.length > 50) user.notifications.pop();
  saveDb();
  res.json({ ok: true, user: buildSafeOpAiUser(user, isAuthed) });
});

app.post('/api/chat/simulate', async (req, res) => {
  try {
    const { user, isAuthed } = getAuthContext(req);
    const targetUser = user || db.users['u_905525222988'] || Object.values(db.users)[0];
    if (!targetUser) return res.status(404).json({ ok: false, error: 'İşletme bulunamadı.' });
    const {
      platform = 'whatsapp',
      senderName = 'Ahmet Yılmaz',
      senderPhone = '05358889900',
      text = '',
      playVoice = false,
    } = req.body || {};
    const outcome = await handleIncomingChannelMessage(targetUser, {
      platform,
      senderId: cleanNumber(senderPhone) || senderPhone || senderName,
      senderName,
      text: String(text || ''),
    });
    if (outcome?.voiceText && playVoice) {
      synthesizeSpeechBuffer(outcome.voiceText, targetUser.voice || 'tr-TR-EmelNeural', false)
        .then((buf) => playMp3BufferNonBlocking(buf, true))
        .catch(() => { });
    }
    res.json({ ok: true, outcome, user: buildSafeOpAiUser(targetUser, isAuthed) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 5) PAKET & AYAR GÜNCELLEME (Web & Expo Mobil)
app.post('/api/settings', (req, res) => {
  const { user, isAuthed } = getAuthContext(req);
  if (!isAuthed || !user) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı veya yetkisiz istek.' });
  const {
    businessName,
    planId,
    botEnabled,
    autoReplyText,
    voice,
    sectorId,
    sectorName,
    operatorTone,
    servicesText,
    locationText,
    workingHoursText,
    callGreetingText,
    waCallAutoAnswer,
    forwardingPhone,
    instagramUsername,
    instagramToken,
    tiktokUsername,
    tiktokToken,
  } = req.body || {};

  if (businessName !== undefined) user.businessName = businessName;
  if (planId && PRICING_PLANS[planId]) user.planId = planId;
  if (botEnabled !== undefined) user.botEnabled = Boolean(botEnabled);
  if (autoReplyText !== undefined) user.autoReplyText = autoReplyText;
  if (voice !== undefined) user.voice = voice;
  if (sectorId !== undefined) user.sectorId = sectorId;
  if (sectorName !== undefined) user.sectorName = sectorName;
  if (operatorTone !== undefined) user.operatorTone = operatorTone;
  if (servicesText !== undefined) user.servicesText = servicesText;
  if (locationText !== undefined) user.locationText = locationText;
  if (workingHoursText !== undefined) user.workingHoursText = workingHoursText;
  if (callGreetingText !== undefined) user.callGreetingText = callGreetingText;
  if (waCallAutoAnswer !== undefined) user.waCallAutoAnswer = Boolean(waCallAutoAnswer);
  if (forwardingPhone !== undefined) user.forwardingPhone = forwardingPhone;

  if (instagramUsername !== undefined) {
    const cleanIg = String(instagramUsername || '').trim().replace(/^@+/, '');
    user.channels.instagram.username = cleanIg;
    user.channels.instagram.accessToken = instagramToken || user.channels.instagram.accessToken;
    user.channels.instagram.connected = Boolean(cleanIg);
  }
  if (tiktokUsername !== undefined) {
    const cleanTt = String(tiktokUsername || '').trim().replace(/^@+/, '');
    user.channels.tiktok.username = cleanTt;
    user.channels.tiktok.accessToken = tiktokToken || user.channels.tiktok.accessToken;
    user.channels.tiktok.connected = Boolean(cleanTt);
    if (cleanTt) {
      launchInteractiveChromeTikTokLogin(user, cleanTt).catch(() => {});
    }
  }

  saveDb();
  res.json({ ok: true, user: buildSafeOpAiUser(user, true), activePlan: PRICING_PLANS[user.planId] });
});

// 6) GERÇEK WHATSAPP BAĞLAMA (8 Haneli Eşleştirme Kodu veya QR Kod)
app.post('/api/whatsapp/connect', async (req, res) => {
  try {
    const { user, isAuthed } = getAuthContext(req);
    if (!isAuthed || !user) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı veya yetkisiz istek.' });
    const { mode = 'pairing', phone } = req.body || {};
    await startUserWhatsAppSession(user.id, {
      mode,
      pairPhone: phone || user.phone,
      reset: true,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/whatsapp/disconnect', (req, res) => {
  const { user, isAuthed } = getAuthContext(req);
  if (!isAuthed || !user) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı veya yetkisiz istek.' });
  const existing = activeSockets.get(user.id);
  if (existing?.sock) {
    try {
      existing.sock.ev.removeAllListeners();
      existing.sock.ws?.close();
    } catch (_) { }
  }
  activeSockets.delete(user.id);
  if (user.channels?.whatsapp) {
    user.channels.whatsapp.connected = false;
  }
  saveDb();
  res.json({ ok: true, user: buildSafeOpAiUser(user, isAuthed) });
});


// ===================== 📸 META (INSTAGRAM DM) RESMİ ENTEGRASYON =====================
function signState(userId) {
  const sig = crypto.createHmac('sha256', META_APP_SECRET || 'opai').update(userId).digest('hex').slice(0, 24);
  return `${userId}.${sig}`;
}
function readState(state = '') {
  const idx = state.lastIndexOf('.');
  if (idx < 0) return null;
  const userId = state.slice(0, idx);
  return signState(userId) === state ? userId : null;
}
function getBaseUrl(req) {
  return PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}
async function graphGet(pathAndQuery) {
  const r = await fetch(`${GRAPH}${pathAndQuery}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j;
}
function toPlainText(t = '') {
  return String(t).replace(/\*/g, '').slice(0, 990);
}
async function sendInstagramReply(user, recipientId, text) {
  const ig = user.channels?.instagram || {};
  if (!ig.pageToken || !ig.pageId) throw new Error('Instagram sayfa anahtarı yok');
  const r = await fetch(`${GRAPH}/${ig.pageId}/messages?access_token=${encodeURIComponent(ig.pageToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: toPlainText(text) } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j;
}

app.get('/api/meta/status', (req, res) => {
  const user = getUserFromReq(req);
  const ig = user?.channels?.instagram || {};
  res.json({
    ok: true,
    configured: Boolean(META_APP_ID && META_APP_SECRET),
    publicUrl: PUBLIC_BASE_URL || null,
    webhookUrl: user ? `${getBaseUrl(req)}/api/webhooks/instagram/${user.id}` : `${getBaseUrl(req)}/api/webhooks/meta`,
    verifyToken: META_VERIFY_TOKEN,
    voiceWebhookUrl: user ? `${getBaseUrl(req)}/api/webhooks/voice-call/${user.id}` : null,
    instagram: { connected: Boolean(ig.connected || ig.username), username: ig.username || '', pageName: ig.pageName || '' },
  });
});

// Adım 1: "Instagram ile Bağlan" → resmi Facebook izin penceresi
app.get('/api/auth/instagram/start', (req, res) => {
  const { user, isAuthed } = getAuthContext(req);
  if (!user || !isAuthed) return res.redirect('/?ig=login_required');
  if (!META_APP_ID || !META_APP_SECRET) return res.redirect('/?ig=not_configured');
  const redirectUri = `${getBaseUrl(req)}/api/auth/instagram/callback`;
  const scope = [
    'pages_show_list',
    'pages_manage_metadata',
    'pages_messaging',
    'business_management',
    'instagram_basic',
    'instagram_manage_messages',
  ].join(',');
  const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(signState(user.id))}` +
    `&scope=${scope}&response_type=code`;
  res.redirect(url);
});

// Adım 2: Meta izni verdi → token al, Instagram işletme hesabını bul, webhooka abone et
app.get('/api/auth/instagram/callback', async (req, res) => {
  try {
    const userId = readState(String(req.query.state || ''));
    const user = userId && db.users[userId];
    if (!user) return res.redirect('/?ig=bad_state');
    if (req.query.error) return res.redirect('/?ig=denied');
    const redirectUri = `${getBaseUrl(req)}/api/auth/instagram/callback`;

    const short = await graphGet(`/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(req.query.code)}`);
    const long = await graphGet(`/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}` +
      `&client_secret=${META_APP_SECRET}&fb_exchange_token=${short.access_token}`);
    const pages = await graphGet(`/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}` +
      `&access_token=${long.access_token}`);
    const page = (pages.data || []).find((p) => p.instagram_business_account);
    if (!page) return res.redirect('/?ig=no_business_account');

    // Sayfayı uygulamamıza abone et → DM gelince Meta bize webhook atar
    await fetch(`${GRAPH}/${page.id}/subscribed_apps?subscribed_fields=messages&access_token=${page.access_token}`, { method: 'POST' });

    user.channels.instagram = {
      ...(user.channels.instagram || {}),
      connected: true,
      username: page.instagram_business_account.username || '',
      igId: page.instagram_business_account.id,
      pageId: page.id,
      pageName: page.name,
      pageToken: page.access_token,
      connectedAt: new Date().toISOString(),
    };
    saveDb();
    res.redirect('/?ig=ok');
  } catch (e) {
    console.error('Instagram OAuth hatası:', e.message);
    res.redirect(`/?ig=error&msg=${encodeURIComponent(e.message)}`);
  }
});

app.post('/api/instagram/disconnect', (req, res) => {
  const { user, isAuthed } = getAuthContext(req);
  if (!user || !isAuthed) return res.status(401).json({ ok: false });
  stopInstagramDirectWorker(user.id);
  user.channels.instagram = { connected: false, username: '', accessToken: '', pageId: '' };
  saveDb();
  res.json({ ok: true, user: buildSafeOpAiUser(user, true) });
});

// ===================== 📸 DOĞRUDAN SUNUCU TABANLI INSTAGRAM DM BOTU (7/24 EKLENTİSİZ) =====================
const activeIgClients = new Map(); // userId -> { ig, pk, timer, seenItemIds, initialized }
const pendingIgChallenges = new Map(); // userId -> { ig, type, twoFactorInfo, username, password, createdAt }
const pendingIgRelayJobs = []; // [{ id, type, userId, payload, status, result, createdAt }]
let lastIgRelayPollAt = 0;

function stopInstagramDirectWorker(userId) {
  const entry = activeIgClients.get(userId);
  if (entry?.timer) clearInterval(entry.timer);
  activeIgClients.delete(userId);
}

async function syncUserInstagramStateToCloud(user) {
  if (process.env.RENDER_EXTERNAL_URL || !user) return;
  try {
    const cloudBase = 'https://avelon-wp-botavelon-wp-bot.onrender.com';
    await fetch(`${cloudBase}/api/instagram/sync-cloud-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id,
        instagram: user.channels?.instagram || {},
        slots: user.slots,
        appointments: user.appointments,
        notifications: user.notifications,
      }),
    });
  } catch (_) {}
}

const IG_WEB_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IG_WEB_APP_ID = '936619743392459';

function parseSetCookieJar(setCookieArray = [], existingCookieMap = {}) {
  const map = { ...existingCookieMap };
  for (const raw of setCookieArray) {
    if (!raw) continue;
    const firstPart = String(raw).split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const k = firstPart.slice(0, eqIdx).trim();
      const v = firstPart.slice(eqIdx + 1).trim();
      if (v && v !== '""' && v !== 'deleted') {
        map[k] = v;
      }
    }
  }
  return map;
}

function cookieMapToHeader(map = {}) {
  return Object.entries(map)
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function injectCookieMapIntoIgClient(ig, cookieMap = {}) {
  const nowIso = new Date().toISOString();
  const cookies = Object.entries(cookieMap).map(([key, value]) => ({
    key,
    value: decodeURIComponent(value),
    domain: 'instagram.com',
    path: '/',
    hostOnly: false,
    creation: nowIso,
    lastAccessed: nowIso,
  }));
  await ig.state.deserializeCookieJar(
    JSON.stringify({
      version: 'tough-cookie@2.5.0',
      storeType: 'MemoryCookieStore',
      rejectPublicSuffixes: true,
      cookies,
    })
  );
}

async function fetchIgWebDirectThreads(cookieMap) {
  const cookieHeader = cookieMapToHeader(cookieMap);
  const csrf = cookieMap.csrftoken || '';
  const headers = {
    'User-Agent': IG_WEB_UA,
    'X-IG-App-ID': IG_WEB_APP_ID,
    'X-CSRFToken': csrf,
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://www.instagram.com/direct/inbox/',
    Cookie: cookieHeader,
  };

  let inboxThreads = [];
  try {
    const r = await fetch(
      'https://www.instagram.com/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=15&thread_message_limit=5',
      { headers }
    );
    if (r.ok) {
      const d = await r.json();
      inboxThreads = d?.inbox?.threads || [];
    }
  } catch (_) {}

  let pendingThreads = [];
  try {
    const rp = await fetch('https://www.instagram.com/api/v1/direct_v2/pending_inbox/?limit=10', { headers });
    if (rp.ok) {
      const dp = await rp.json();
      pendingThreads = dp?.inbox?.threads || [];
      for (const pt of pendingThreads) {
        if (pt?.thread_id) {
          await fetch(`https://www.instagram.com/api/v1/direct_v2/threads/${pt.thread_id}/approve/`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          }).catch(() => {});
        }
      }
    }
  } catch (_) {}

  return [...pendingThreads, ...inboxThreads];
}

async function sendIgWebDirectText(cookieMap, threadId, text) {
  const cookieHeader = cookieMapToHeader(cookieMap);
  const csrf = cookieMap.csrftoken || '';
  const clientContext = `${Date.now()}${Math.floor(100000 + Math.random() * 900000)}`;
  const body = new URLSearchParams({
    action: 'send_item',
    thread_ids: `[${threadId}]`,
    client_context: clientContext,
    mutation_token: clientContext,
    text,
  });
  const r = await fetch('https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/', {
    method: 'POST',
    headers: {
      'User-Agent': IG_WEB_UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-IG-App-ID': IG_WEB_APP_ID,
      'X-CSRFToken': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `https://www.instagram.com/direct/t/${threadId}/`,
      Cookie: cookieHeader,
    },
    body: body.toString(),
  });
  return r.ok;
}

async function startInstagramDirectWorker(user) {
  if (!user || !user.id) return false;
  const igConf = user.channels?.instagram || {};
  if ((!igConf.serializedState && !igConf.cookieMap) || !igConf.username) return false;

  stopInstagramDirectWorker(user.id);

  try {
    let ig = null;
    if (igConf.serializedState) {
      try {
        ig = new IgApiClient();
        ig.state.generateDevice(igConf.username);
        await ig.state.deserialize(igConf.serializedState);
      } catch (_) {
        ig = null;
      }
    }

    const seenItemIds = new Set();
    const workerState = {
      ig,
      cookieMap: igConf.cookieMap || null,
      pk: String(igConf.pk || igConf.cookieMap?.ds_user_id || ''),
      seenItemIds,
      initialized: false,
      polling: false,
      timer: null,
    };

    const pollInbox = async () => {
      if (workerState.polling) return;
      const currentUserObj = db.users[user.id];
      if (!currentUserObj || !currentUserObj.channels?.instagram?.connected) {
        stopInstagramDirectWorker(user.id);
        return;
      }
      workerState.polling = true;
      try {
        let allThreads = [];
        const activeCookieMap = currentUserObj.channels?.instagram?.cookieMap || workerState.cookieMap;

        if (activeCookieMap && activeCookieMap.sessionid) {
          allThreads = await fetchIgWebDirectThreads(activeCookieMap);
        }

        if (allThreads.length === 0 && workerState.ig) {
          const inboxFeed = workerState.ig.feed.directInbox();
          const inboxThreads = (await inboxFeed.items().catch(() => [])) || [];
          let pendingThreads = [];
          try {
            const pendingFeed = workerState.ig.feed.directPending();
            pendingThreads = (await pendingFeed.items().catch(() => [])) || [];
            for (const pt of pendingThreads) {
              if (pt?.thread_id) {
                await workerState.ig.request
                  .send({
                    url: `/api/v1/direct_v2/threads/${pt.thread_id}/approve/`,
                    method: 'POST',
                  })
                  .catch(() => {});
              }
            }
          } catch (_) {}
          allThreads = [...pendingThreads, ...inboxThreads];
        }

        for (const thread of allThreads.slice(0, 15)) {
          const lastItem = (thread.items && thread.items[0]) || thread.last_permanent_item;
          if (!lastItem || !lastItem.item_id) continue;

          const itemId = String(lastItem.item_id);
          const rawTs = Number(lastItem.timestamp || 0);
          const itemTsMs = rawTs > 1e14 ? rawTs / 1000 : rawTs > 1e11 ? rawTs : rawTs * 1000;
          const isRecentMessage = itemTsMs > 0 && Date.now() - itemTsMs < 15 * 60 * 1000;

          if (!workerState.initialized && !isRecentMessage) {
            seenItemIds.add(itemId);
            continue;
          }
          if (seenItemIds.has(itemId)) continue;
          seenItemIds.add(itemId);

          const senderPk = String(lastItem.user_id || '');
          // Kendi gönderdiğimiz mesajlara cevap verme
          if (workerState.pk && senderPk === workerState.pk) continue;

          let text = '';
          if (lastItem.item_type === 'text' && lastItem.text) {
            text = String(lastItem.text).trim();
          } else if (lastItem.text) {
            text = String(lastItem.text).trim();
          }
          if (!text) continue;

          // Kendi OP AI otomatik mesajımızsa atla
          if (
            text.includes('GÜNCEL DOLU & BOŞ SAATLERİMİZ') ||
            text.includes('Otomatik Randevu Sistemine') ||
            text.includes('hattına hoş geldiniz') ||
            text.includes('RANDEVUNUZ ONAYLANDI')
          ) {
            continue;
          }

          const senderUser = (thread.users || []).find((u) => String(u.pk) === senderPk) || (thread.users || [])[0];
          const senderHandle = senderUser?.username ? `@${senderUser.username}` : (thread.thread_title || `IG_${senderPk}`);

          console.log(`📸 [IG DM GELDİ] İşletme: @${igConf.username} | Kimden: ${senderHandle} | Mesaj: "${text}"`);
          const outcome = await handleIncomingChannelMessage(currentUserObj, {
            platform: 'instagram',
            senderId: senderHandle,
            senderName: senderHandle,
            text,
          });

          if (outcome?.replyText) {
            const cleanReply = toPlainText(outcome.replyText);
            let sentOk = false;
            if (activeCookieMap && activeCookieMap.sessionid) {
              sentOk = await sendIgWebDirectText(activeCookieMap, thread.thread_id, cleanReply).catch(() => false);
            }
            if (!sentOk && workerState.ig) {
              await workerState.ig.entity.directThread(thread.thread_id).broadcastText(cleanReply);
              sentOk = true;
            }
            if (sentOk) {
              console.log(`✅ [IG DM YANITLANDI] -> ${senderHandle}`);
              await syncUserInstagramStateToCloud(currentUserObj);
            }
          }
        }
        workerState.initialized = true;
      } catch (err) {
        // Gürültüsüz geç
      } finally {
        workerState.polling = false;
      }
    };

    await pollInbox();
    workerState.timer = setInterval(pollInbox, 3500);
    activeIgClients.set(user.id, workerState);
    console.log(`📸 [IG 7/24 BOT AKTİF] @${igConf.username} (${user.id}) doğrudan sunucuya bağlandı!`);
    return true;
  } catch (err) {
    console.error('IG Direct Worker başlatma hatası:', err.message);
    return false;
  }
}

async function finalizeInstagramLoginSuccess(user, ig, authUser, cleanUsername, cookieMap = null) {
  let serialized = null;
  if (ig) {
    try {
      serialized = await ig.state.serialize();
      delete serialized.constants;
    } catch (_) {}
  }

  let resolvedPk = String(authUser?.pk || cookieMap?.ds_user_id || '');
  let resolvedUsername = authUser?.username || cleanUsername;

  user.channels.instagram = {
    ...(user.channels.instagram || {}),
    connected: true,
    liveDmActive: true,
    username: resolvedUsername,
    pk: resolvedPk,
    cookieMap: cookieMap || user.channels?.instagram?.cookieMap || null,
    serializedState: serialized || cookieMap || { webSession: true },
    connectedAt: new Date().toISOString(),
  };
  saveDb();

  await startInstagramDirectWorker(user);
  await syncUserInstagramStateToCloud(user);

  return {
    ok: true,
    liveConnected: true,
    cookieMap: user.channels.instagram.cookieMap,
    serializedState: user.channels.instagram.serializedState,
    pk: resolvedPk,
    username: resolvedUsername,
    user: buildSafeOpAiUser(user, true),
    message: `✅ @${resolvedUsername} Instagram hesabınız 7/24 bulut sunucusuna canlı bağlandı! Artık DM kutunuza gelen mesajlara yapay zeka otomatik cevap verecek.`,
  };
}

const cdpRepliedMessages = new Set();
let cdpDmBusy = false;
let lastHeadlessSpawnAt = 0;

function ensureHeadlessIgChromeRunning(port = 9242) {
  if (Date.now() - lastHeadlessSpawnAt < 15000) return;
  const chromeCandidates = [
    '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const chromeBin = chromeCandidates.find((p) => fs.existsSync(p));
  if (!chromeBin) return;
  const profileDir = path.join(DATA_DIR, 'ig-chrome-profile');
  if (!fs.existsSync(profileDir)) return;
  lastHeadlessSpawnAt = Date.now();
  const proc = spawn(
    chromeBin,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,860',
      'https://www.instagram.com/direct/inbox/',
    ],
    { detached: true, stdio: 'ignore' }
  );
  proc.unref();
}

function startChromeCdpInstagramDmLoop() {
  const port = 9242;
  setInterval(async () => {
    if (cdpDmBusy) return;
    cdpDmBusy = true;
    try {
      let targets = null;
      try {
        targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
      } catch (_) {
        ensureHeadlessIgChromeRunning(port);
        return;
      }
      const page = (targets || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!page) return;

      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout')), 1500);
        ws.addEventListener('open', () => {
          clearTimeout(t);
          res();
        });
        ws.addEventListener('error', rej);
      });

      const send = (method, params = {}) =>
        new Promise((resolve) => {
          const id = Math.floor(Math.random() * 1e6);
          const timer = setTimeout(() => resolve(null), 2000);
          const h = (ev) => {
            try {
              const m = JSON.parse(ev.data);
              if (m.id === id) {
                clearTimeout(timer);
                ws.removeEventListener('message', h);
                resolve(m.result);
              }
            } catch (_) {}
          };
          ws.addEventListener('message', h);
          ws.send(JSON.stringify({ id, method, params }));
        });

      const stateRes = await send('Runtime.evaluate', {
        expression: `(() => {
          if (!location.pathname.startsWith('/direct')) return { notDirect: true };
          // Unread satırı varsa tıkla
          const allSpans = Array.from(document.querySelectorAll('span'));
          const unreadBadge = allSpans.find((s) => (s.innerText === 'Unread' || s.innerText === 'Okunmamış') && s.getBoundingClientRect().top > 200);
          if (unreadBadge) {
            let p = unreadBadge;
            while (p && p !== document.body) {
              p.click();
              p = p.parentElement;
            }
          }
          // Açık sohbetteki son mesaj balonunu oku (textbox hariç)
          const main = document.querySelector('[role="main"]') || document.body;
          const dirNodes = Array.from(main.querySelectorAll('div[dir="auto"]')).filter((el) => !el.closest('div[role="textbox"]'));
          if (dirNodes.length === 0) return { empty: true };
          const lastNode = dirNodes[dirNodes.length - 1];
          const lastText = (lastNode.innerText || '').trim();
          const headerSpans = Array.from(main.querySelectorAll('header span, span[dir="auto"]'));
          let chatTitle = 'Instagram Müşterisi';
          for (const hs of headerSpans) {
            const t = (hs.innerText || '').trim();
            if (t && t.length > 1 && t.length < 35 && !t.includes('Mesaj') && !t.includes('Active') && !t.includes('Notun')) {
              chatTitle = t;
              break;
            }
          }
          return { path: location.pathname, chatTitle, lastText };
        })()`,
        returnByValue: true,
      });

      const info = stateRes?.result?.value;
      if (info && info.lastText && !info.notDirect) {
        const text = String(info.lastText).trim();
        const isOurOwnBotReply =
          text.includes('GÜNCEL DOLU & BOŞ SAATLERİMİZ') ||
          text.includes('Otomatik Randevu Sistemine') ||
          text.includes('hattına hoş geldiniz') ||
          text.includes('RANDEVUNUZ ONAYLANDI') ||
          text.includes('Randevu almak istediğiniz') ||
          text.includes('Konum & Çalışma Saatleri') ||
          text.includes('Güncel Hizmet & Fiyatlarımız') ||
          text.includes('AI Asistanı:') ||
          text.includes('randevunuz iptal edilmiş') ||
          text.includes('Anlaşıldı, yeni randevu işleminizi');

        const fp = `${info.path}::${text}`;
        if (!isOurOwnBotReply && !cdpRepliedMessages.has(fp) && text.length <= 350) {
          cdpRepliedMessages.add(fp);
          const targetUser = db.users['u_905525222988'] || Object.values(db.users)[0];
          if (targetUser) {
            const outcome = await handleIncomingChannelMessage(targetUser, {
              platform: 'instagram',
              senderId: info.chatTitle || '@ig_musteri',
              senderName: info.chatTitle || 'Instagram Müşterisi',
              text,
            });
            if (outcome?.replyText) {
              const cleanReply = String(outcome.replyText).replace(/\*/g, '').replace(/\n+/g, ' | ').trim();
              cdpRepliedMessages.add(`${info.path}::${cleanReply}`);
              const boxPos = await send('Runtime.evaluate', {
                expression: `(() => {
                  const tb = document.querySelector('div[role="textbox"][contenteditable="true"]');
                  if (!tb) return null;
                  tb.focus();
                  const r = tb.getBoundingClientRect();
                  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                })()`,
                returnByValue: true,
              });
              if (boxPos?.result?.value) {
                const { x, y } = boxPos.result.value;
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
                await new Promise((r) => setTimeout(r, 250));
                await send('Input.insertText', { text: cleanReply });
                await new Promise((r) => setTimeout(r, 350));
                await send('Input.dispatchKeyEvent', {
                  type: 'keyDown',
                  key: 'Enter',
                  code: 'Enter',
                  windowsVirtualKeyCode: 13,
                  nativeVirtualKeyCode: 13,
                });
                await send('Input.dispatchKeyEvent', {
                  type: 'keyUp',
                  key: 'Enter',
                  code: 'Enter',
                  windowsVirtualKeyCode: 13,
                  nativeVirtualKeyCode: 13,
                });
                console.log(`✅ [IG CDP DM YANITLANDI] ${info.chatTitle}: "${text}"`);
                await syncUserInstagramStateToCloud(targetUser);
              }
            }
          }
        }
      }
      ws.close();
    } catch (_) {
    } finally {
      cdpDmBusy = false;
    }
  }, 2500);
}
startChromeCdpInstagramDmLoop();

// ===================== 🎵 CANLI TIKTOK DM KÖPRÜSÜ (CHROME CDP PORT 9243) =====================
let cdpTtBusy = false;
const cdpTtRepliedMessages = new Set();

export async function launchInteractiveChromeTikTokLogin(user, cleanUsername) {
  const chromeCandidates = [
    '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const chromeBin = chromeCandidates.find((p) => fs.existsSync(p));
  if (!chromeBin) return false;

  const profileDir = path.join(DATA_DIR, 'tt-chrome-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const port = 9243;
  const proc = spawn(
    chromeBin,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1100,780',
      '--app=https://www.tiktok.com/messages',
    ],
    { detached: true, stdio: 'ignore' }
  );
  proc.unref();

  if (user) {
    user.channels.tiktok = {
      ...(user.channels.tiktok || {}),
      username: cleanUsername || user.channels?.tiktok?.username || 'tiktok_hesabi',
      connected: true,
      liveDmActive: true,
      connectedAt: new Date().toISOString(),
    };
    saveDb();
  }
  return true;
}

function startChromeCdpTikTokDmLoop() {
  const port = 9243;
  setInterval(async () => {
    if (cdpTtBusy) return;
    cdpTtBusy = true;
    try {
      let targets = null;
      try {
        targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
      } catch (_) {
        return;
      }
      const page = (targets || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!page) return;

      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout')), 1500);
        ws.addEventListener('open', () => {
          clearTimeout(t);
          res();
        });
        ws.addEventListener('error', rej);
      });

      const send = (method, params = {}) =>
        new Promise((resolve) => {
          const id = Math.floor(Math.random() * 1e6);
          const timer = setTimeout(() => resolve(null), 2000);
          const h = (ev) => {
            try {
              const m = JSON.parse(ev.data);
              if (m.id === id) {
                clearTimeout(timer);
                ws.removeEventListener('message', h);
                resolve(m.result);
              }
            } catch (_) {}
          };
          ws.addEventListener('message', h);
          ws.send(JSON.stringify({ id, method, params }));
        });

      const stateRes = await send('Runtime.evaluate', {
        expression: `(() => {
          if (!location.pathname.includes('/messages')) return { notMessages: true };
          const msgNodes = Array.from(document.querySelectorAll('[data-e2e="chat-item"] p, [class*="DivTextMessage"], div[dir="auto"]'))
            .filter((el) => !el.closest('[contenteditable="true"]') && !el.closest('[role="textbox"]'));
          if (msgNodes.length === 0) return { empty: true };
          const lastNode = msgNodes[msgNodes.length - 1];
          const lastText = (lastNode.innerText || '').trim();
          const titleEl = document.querySelector('[data-e2e="chat-nickname"], header h4, header span');
          const chatTitle = (titleEl && titleEl.innerText ? titleEl.innerText.trim() : 'TikTok Müşterisi');
          return { path: location.pathname, chatTitle, lastText };
        })()`,
        returnByValue: true,
      });

      const info = stateRes?.result?.value;
      if (info && info.lastText && !info.notMessages) {
        const text = String(info.lastText).trim();
        const isOurOwnBotReply =
          text.includes('GÜNCEL DOLU & BOŞ SAATLERİMİZ') ||
          text.includes('Otomatik Randevu Sistemine') ||
          text.includes('hattına hoş geldiniz') ||
          text.includes('RANDEVUNUZ ONAYLANDI') ||
          text.includes('Randevu almak istediğiniz') ||
          text.includes('Konum & Çalışma Saatleri') ||
          text.includes('Güncel Hizmet & Fiyatlarımız') ||
          text.includes('AI Asistanı:') ||
          text.includes('randevunuz iptal edilmiş');

        const fp = `tt::${info.chatTitle}::${text}`;
        if (!isOurOwnBotReply && !cdpTtRepliedMessages.has(fp) && text.length <= 350) {
          cdpTtRepliedMessages.add(fp);
          const targetUser = db.users['u_905525222988'] || Object.values(db.users)[0];
          if (targetUser) {
            const outcome = await handleIncomingChannelMessage(targetUser, {
              platform: 'tiktok',
              senderId: info.chatTitle || '@tt_musteri',
              senderName: info.chatTitle || 'TikTok Müşterisi',
              text,
            });
            if (outcome?.replyText) {
              const cleanReply = String(outcome.replyText).replace(/\*/g, '').replace(/\n+/g, ' | ').trim();
              cdpTtRepliedMessages.add(`tt::${info.chatTitle}::${cleanReply}`);
              const boxPos = await send('Runtime.evaluate', {
                expression: `(() => {
                  const tb = document.querySelector('[data-e2e="message-input-area"] [contenteditable="true"], div[role="textbox"][contenteditable="true"]');
                  if (!tb) return null;
                  tb.focus();
                  const r = tb.getBoundingClientRect();
                  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                })()`,
                returnByValue: true,
              });
              if (boxPos?.result?.value) {
                const { x, y } = boxPos.result.value;
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
                await new Promise((r) => setTimeout(r, 250));
                await send('Input.insertText', { text: cleanReply });
                await new Promise((r) => setTimeout(r, 350));
                await send('Input.dispatchKeyEvent', {
                  type: 'keyDown',
                  key: 'Enter',
                  code: 'Enter',
                  windowsVirtualKeyCode: 13,
                  nativeVirtualKeyCode: 13,
                });
                await send('Input.dispatchKeyEvent', {
                  type: 'keyUp',
                  key: 'Enter',
                  code: 'Enter',
                  windowsVirtualKeyCode: 13,
                  nativeVirtualKeyCode: 13,
                });
                console.log(`✅ [TIKTOK CDP DM YANITLANDI] ${info.chatTitle}: "${text}"`);
                await syncUserInstagramStateToCloud(targetUser);
              }
            }
          }
        }
      }
      ws.close();
    } catch (_) {
    } finally {
      cdpTtBusy = false;
    }
  }, 2500);
}
startChromeCdpTikTokDmLoop();

async function launchInteractiveChromeInstagramLogin(user, ig, cleanUsername, password) {
  const chromeCandidates = [
    '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const chromeBin = chromeCandidates.find((p) => fs.existsSync(p));
  if (!chromeBin) return null;

  const profileDir = path.join(DATA_DIR, 'ig-chrome-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const port = 9242;
  const chromeProc = spawn(
    chromeBin,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=480,720',
      '--app=https://www.instagram.com/accounts/login/',
    ],
    { detached: true, stdio: 'ignore' }
  );
  chromeProc.unref();

  // Arka planda Chrome çerezlerini (sessionid) dinle ve giriş tamamlandığında 7/24 DM botunu otomatik başlat
  (async () => {
    const startAt = Date.now();
    let autofilled = false;
    while (Date.now() - startAt < 180000) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!page) continue;

        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('ws timeout')), 2000);
          ws.addEventListener('open', () => {
            clearTimeout(t);
            res();
          });
          ws.addEventListener('error', rej);
        });

        const sendCdp = (method, params = {}) =>
          new Promise((resolve) => {
            const id = Math.floor(Math.random() * 1e6);
            const timer = setTimeout(() => resolve(null), 2000);
            const handler = (ev) => {
              try {
                const msg = JSON.parse(ev.data);
                if (msg.id === id) {
                  clearTimeout(timer);
                  ws.removeEventListener('message', handler);
                  resolve(msg.result);
                }
              } catch (_) {}
            };
            ws.addEventListener('message', handler);
            ws.send(JSON.stringify({ id, method, params }));
          });

        if (!autofilled && cleanUsername && password) {
          const fillRes = await sendCdp('Runtime.evaluate', {
            expression: `(() => {
              const u = document.querySelector('input[name="username"], input[name="email"]');
              const p = document.querySelector('input[name="password"], input[name="pass"]');
              if (!u || !p) return false;
              const setVal = (el, val) => {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(el, val);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              };
              if (!u.value) setVal(u, ${JSON.stringify(cleanUsername)});
              if (!p.value) setVal(p, ${JSON.stringify(password)});
              return true;
            })()`,
            returnByValue: true,
          });
          if (fillRes?.result?.value) {
            autofilled = true;
          }
        }

        const cookieRes = await sendCdp('Network.getAllCookies');
        ws.close();

        const cookies = cookieRes?.cookies || [];
        const igCookies = cookies.filter((c) => String(c.domain || '').includes('instagram.com'));
        const cookieMap = {};
        for (const c of igCookies) {
          if (c.name && c.value) cookieMap[c.name] = c.value;
        }

        if (cookieMap.sessionid && cookieMap.ds_user_id) {
          console.log(`✅ [IG CHROME LOGIN] @${cleanUsername} oturumu yakalandı (ds_user_id: ${cookieMap.ds_user_id})!`);
          try {
            await injectCookieMapIntoIgClient(ig, cookieMap);
          } catch (_) {}
          await finalizeInstagramLoginSuccess(
            user,
            ig,
            { pk: cookieMap.ds_user_id, username: cleanUsername },
            cleanUsername,
            cookieMap
          );
          try {
            process.kill(chromeProc.pid);
          } catch (_) {}
          break;
        }
      } catch (_) {}
    }
  })();

  return true;
}

async function executeLocalInstagramLogin(user, { cleanUsername, password, sessionIdCookie }) {
  const ig = new IgApiClient();
  ig.state.generateDevice(cleanUsername);

  try {
    if (sessionIdCookie) {
      const decodedSession = decodeURIComponent(sessionIdCookie);
      const cookieMap = { sessionid: decodedSession };
      await injectCookieMapIntoIgClient(ig, cookieMap);
      let authUser = null;
      try {
        authUser = await ig.account.currentUser();
      } catch (_) {}
      pendingIgChallenges.delete(user.id);
      return await finalizeInstagramLoginSuccess(user, ig, authUser, cleanUsername, cookieMap);
    }

    // Güncel Instagram Web Ajax Giriş Protokolü ("Your version of Instagram is out of date" hatasını %100 aşar)
    const r1 = await fetch('https://www.instagram.com/accounts/login/', {
      headers: {
        'User-Agent': IG_WEB_UA,
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    const setCookies1 = r1.headers.getSetCookie ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie') || ''];
    let cookieMap = parseSetCookieJar(setCookies1, {});
    if (!cookieMap.csrftoken) {
      const html = await r1.text().catch(() => '');
      const m = html.match(/"csrf_token":"([^"]+)"/);
      if (m) cookieMap.csrftoken = m[1];
    }
    const csrf = cookieMap.csrftoken || 'missing';
    const ts = Math.floor(Date.now() / 1000);
    const form = new URLSearchParams({
      enc_password: `#PWD_INSTAGRAM_BROWSER:0:${ts}:${password}`,
      username: cleanUsername,
      queryParams: '{}',
      optIntoOneTap: 'false',
    });

    const r2 = await fetch('https://www.instagram.com/api/v1/web/accounts/login/ajax/', {
      method: 'POST',
      headers: {
        'User-Agent': IG_WEB_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': csrf,
        'X-IG-App-ID': IG_WEB_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://www.instagram.com/accounts/login/',
        Cookie: cookieMapToHeader(cookieMap),
      },
      body: form.toString(),
    });

    const setCookies2 = r2.headers.getSetCookie ? r2.headers.getSetCookie() : [r2.headers.get('set-cookie') || ''];
    cookieMap = parseSetCookieJar(setCookies2, cookieMap);
    const data = await r2.json().catch(() => ({}));

    if (data.authenticated && cookieMap.sessionid) {
      await injectCookieMapIntoIgClient(ig, cookieMap);
      pendingIgChallenges.delete(user.id);
      return await finalizeInstagramLoginSuccess(
        user,
        ig,
        { pk: data.userId || cookieMap.ds_user_id, username: cleanUsername },
        cleanUsername,
        cookieMap
      );
    }

    if (data.two_factor_required && data.two_factor_info) {
      pendingIgChallenges.set(user.id, {
        ig,
        type: 'web_2fa',
        twoFactorInfo: data.two_factor_info,
        cookieMap,
        username: cleanUsername,
        password,
        createdAt: Date.now(),
      });
      return {
        ok: false,
        challengeRequired: true,
        challengeType: '2fa',
        error: '📲 İki Faktörlü Doğrulama (2FA) açık! Lütfen telefonunuza (SMS / WhatsApp) veya doğrulayıcı uygulamanıza gelen 6 haneli kodu aşağıya girip onaylayın.',
      };
    }

    if (data.message === 'checkpoint_required' || data.checkpoint_url) {
      if (
        data.error_type === 'AuthPlatformAntiScriptingException' ||
        String(data.checkpoint_url || '').includes('auth_platform')
      ) {
        const openedChrome = await launchInteractiveChromeInstagramLogin(user, ig, cleanUsername, password);
        if (openedChrome) {
          return {
            ok: false,
            challengeRequired: true,
            challengeType: 'browser_window',
            error:
              '🖥 Instagram güvenlik kontrolü nedeniyle ekranınızda gerçek Instagram Giriş penceresi açıldı (kullanıcı adı ve şifreniz otomatik dolduruldu). Açılan pencerede "Giriş Yap" butonuna bastığınız anda OP AI 7/24 DM botunuz otomatik bağlanacaktır!',
          };
        }
      }

      const cpUrl = data.checkpoint_url.startsWith('http')
        ? data.checkpoint_url
        : `https://www.instagram.com${data.checkpoint_url}`;
      try {
        const cpRes = await fetch(cpUrl, {
          method: 'POST',
          headers: {
            'User-Agent': IG_WEB_UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRFToken': cookieMap.csrftoken || csrf,
            'X-IG-App-ID': IG_WEB_APP_ID,
            'X-Requested-With': 'XMLHttpRequest',
            Referer: cpUrl,
            Cookie: cookieMapToHeader(cookieMap),
          },
          body: new URLSearchParams({ choice: '1' }).toString(),
        });
        const scCp = cpRes.headers.getSetCookie ? cpRes.headers.getSetCookie() : [cpRes.headers.get('set-cookie') || ''];
        cookieMap = parseSetCookieJar(scCp, cookieMap);
      } catch (_) {}

      pendingIgChallenges.set(user.id, {
        ig,
        type: 'web_checkpoint',
        checkpointUrl: cpUrl,
        cookieMap,
        username: cleanUsername,
        password,
        createdAt: Date.now(),
      });
      return {
        ok: false,
        challengeRequired: true,
        challengeType: 'checkpoint',
        error: '📲 Instagram güvenlik onayı istedi! Telefonunuza (SMS) veya e-posta adresinize gönderilen 6 haneli onay kodunu aşağıdaki kutuya girip "Kodu Doğrula ve Bağla" butonuna basın.',
      };
    }

    if (data.user === false) {
      return {
        ok: false,
        error: `@${cleanUsername} kullanıcı adına ait bir Instagram hesabı bulunamadı. Lütfen kullanıcı adınızı kontrol edin.`,
      };
    }

    if (data.authenticated === false) {
      return {
        ok: false,
        error: 'Girdiğiniz Instagram şifresi hatalı. Lütfen şifrenizi kontrol edip tekrar deneyin.',
      };
    }

    return {
      ok: false,
      error: `Instagram girişi doğrulanamadı (${data.message || 'Lütfen Instagram uygulamasından "Bu bendim" onayını verip tekrar deneyin'}).`,
    };
  } catch (err) {
    console.error('IG Direct Login Hatası:', err.message);
    return {
      ok: false,
      error: `Instagram girişi doğrulanamadı (${err.message}). Şifrenizi kontrol edin veya tekrar deneyin.`,
    };
  }
}

async function executeLocalInstagramVerifyCode(user, code) {
  const cleanCode = String(code || '').replace(/\s+/g, '').trim();
  const pending = pendingIgChallenges.get(user.id);
  if (!pending) {
    return {
      ok: false,
      error: 'Aktif doğrulama oturumu bulunamadı. Lütfen kullanıcı adı ve şifrenizle tekrar "Instagram Hesabını Bağla" butonuna basın.',
    };
  }
  try {
    let cookieMap = { ...(pending.cookieMap || {}) };
    const csrf = cookieMap.csrftoken || '';

    if (pending.type === 'web_2fa' && pending.twoFactorInfo) {
      const identifier = pending.twoFactorInfo.two_factor_identifier;
      const body = new URLSearchParams({
        username: pending.username,
        verificationCode: cleanCode,
        identifier,
        queryParams: '{}',
      });
      const r = await fetch('https://www.instagram.com/api/v1/web/accounts/login/ajax/two_factor/', {
        method: 'POST',
        headers: {
          'User-Agent': IG_WEB_UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRFToken': csrf,
          'X-IG-App-ID': IG_WEB_APP_ID,
          'X-Requested-With': 'XMLHttpRequest',
          Referer: 'https://www.instagram.com/accounts/login/two_factor',
          Cookie: cookieMapToHeader(cookieMap),
        },
        body: body.toString(),
      });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
      cookieMap = parseSetCookieJar(sc, cookieMap);
      const d = await r.json().catch(() => ({}));
      if (d.authenticated && cookieMap.sessionid) {
        await injectCookieMapIntoIgClient(pending.ig, cookieMap);
        pendingIgChallenges.delete(user.id);
        return await finalizeInstagramLoginSuccess(
          user,
          pending.ig,
          { pk: d.userId || cookieMap.ds_user_id, username: pending.username },
          pending.username,
          cookieMap
        );
      }
      return {
        ok: false,
        challengeRequired: true,
        error: `2FA kodu doğrulanamadı (${d.message || 'Lütfen kodu kontrol edip tekrar deneyin'}).`,
      };
    }

    if (pending.type === 'web_checkpoint' && pending.checkpointUrl) {
      const r = await fetch(pending.checkpointUrl, {
        method: 'POST',
        headers: {
          'User-Agent': IG_WEB_UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRFToken': csrf,
          'X-IG-App-ID': IG_WEB_APP_ID,
          'X-Requested-With': 'XMLHttpRequest',
          Referer: pending.checkpointUrl,
          Cookie: cookieMapToHeader(cookieMap),
        },
        body: new URLSearchParams({ security_code: cleanCode }).toString(),
      });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
      cookieMap = parseSetCookieJar(sc, cookieMap);
      if (cookieMap.sessionid) {
        await injectCookieMapIntoIgClient(pending.ig, cookieMap);
        pendingIgChallenges.delete(user.id);
        return await finalizeInstagramLoginSuccess(
          user,
          pending.ig,
          { pk: cookieMap.ds_user_id, username: pending.username },
          pending.username,
          cookieMap
        );
      }
      return {
        ok: false,
        challengeRequired: true,
        error: 'Güvenlik kodu doğrulanamadı. Lütfen gelen 6 haneli kodu kontrol edip tekrar deneyin.',
      };
    }

    const res = await pending.ig.challenge.sendSecurityCode(cleanCode);
    const authUser = res?.logged_in_user || null;
    pendingIgChallenges.delete(user.id);
    return await finalizeInstagramLoginSuccess(user, pending.ig, authUser, pending.username);
  } catch (err) {
    return {
      ok: false,
      challengeRequired: true,
      error: `Doğrulama kodu kabul edilmedi (${err.message}). Lütfen gelen 6 haneli kodu kontrol edip tekrar deneyin.`,
    };
  }
}

async function dispatchIgJobViaResidentialRelayOrLocal(user, type, payload) {
  const isCloud = Boolean(process.env.RENDER_EXTERNAL_URL);
  const relayAlive = Date.now() - lastIgRelayPollAt < 12000;

  if (isCloud && relayAlive) {
    const jobId = `igjob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const job = {
      id: jobId,
      type,
      userId: user.id,
      payload,
      status: 'pending',
      result: null,
      createdAt: Date.now(),
    };
    pendingIgRelayJobs.push(job);
    if (pendingIgRelayJobs.length > 30) pendingIgRelayJobs.shift();

    const startWait = Date.now();
    while (Date.now() - startWait < 13000) {
      await new Promise((r) => setTimeout(r, 350));
      if (job.status === 'done' && job.result) {
        if (job.result.ok && (job.result.serializedState || job.result.cookieMap)) {
          user.channels.instagram = {
            ...(user.channels.instagram || {}),
            connected: true,
            liveDmActive: true,
            username: job.result.username || payload.cleanUsername,
            pk: String(job.result.pk || ''),
            cookieMap: job.result.cookieMap || null,
            serializedState: job.result.serializedState,
            connectedAt: new Date().toISOString(),
          };
          saveDb();
        }
        return {
          ...job.result,
          user: buildSafeOpAiUser(user, true),
        };
      }
    }
  }

  if (type === 'verify_code') {
    return await executeLocalInstagramVerifyCode(user, payload.code);
  }
  return await executeLocalInstagramLogin(user, payload);
}

app.post('/api/instagram/login', async (req, res) => {
  const { user } = getAuthContext(req);
  const targetUser = user || db.users['u_905525222988'] || Object.values(db.users)[0];
  if (!targetUser) {
    return res.status(401).json({ ok: false, error: 'Oturum bulunamadı veya yetkisiz istek.' });
  }

  const cleanUsername = String(req.body?.username || '').trim().replace(/^@+/, '');
  const password = String(req.body?.password || '').trim();
  const sessionIdCookie = String(req.body?.sessionId || '').trim();

  if (!cleanUsername) {
    return res.status(400).json({ ok: false, error: 'Instagram kullanıcı adı gereklidir.' });
  }

  if (!password && !sessionIdCookie) {
    targetUser.channels.instagram = {
      ...(targetUser.channels.instagram || {}),
      username: cleanUsername,
      connected: true,
    };
    saveDb();
    return res.json({
      ok: true,
      liveConnected: Boolean(targetUser.channels.instagram.serializedState),
      user: buildSafeOpAiUser(targetUser, true),
      message: `@${cleanUsername} kaydedildi. 7/24 gerçek DM otomatik yanıtlaması için Instagram şifrenizle giriş yapabilirsiniz.`,
    });
  }

  const result = await dispatchIgJobViaResidentialRelayOrLocal(targetUser, 'login', {
    cleanUsername,
    password,
    sessionIdCookie,
  });

  if (result.ok) {
    return res.json(result);
  }
  return res.status(400).json(result);
});

app.post('/api/instagram/verify-code', async (req, res) => {
  const { user } = getAuthContext(req);
  const targetUser = user || db.users['u_905525222988'] || Object.values(db.users)[0];
  if (!targetUser) {
    return res.status(401).json({ ok: false, error: 'Oturum bulunamadı.' });
  }
  const code = String(req.body?.code || '').trim();
  if (!code) {
    return res.status(400).json({ ok: false, error: 'Lütfen 6 haneli doğrulama kodunu girin.' });
  }
  const result = await dispatchIgJobViaResidentialRelayOrLocal(targetUser, 'verify_code', { code });
  if (result.ok) {
    return res.json(result);
  }
  return res.status(400).json(result);
});

// Bulut <-> Yerel Türkiye Ev IP Instagram Rölesi Uçları
app.get('/api/instagram/outbox-jobs', (_req, res) => {
  lastIgRelayPollAt = Date.now();
  const now = Date.now();
  const jobs = pendingIgRelayJobs.filter((j) => j.status === 'pending' && now - j.createdAt < 30000);
  res.json({ ok: true, jobs });
});

app.post('/api/instagram/outbox-jobs/complete', (req, res) => {
  const { id, result } = req.body || {};
  const job = pendingIgRelayJobs.find((j) => j.id === id);
  if (job) {
    job.status = 'done';
    job.result = result;
  }
  res.json({ ok: true });
});

app.post('/api/instagram/sync-cloud-user', (req, res) => {
  const { userId, instagram, slots, appointments, notifications } = req.body || {};
  const targetUser = (userId && db.users[userId]) || db.users['u_905525222988'] || Object.values(db.users)[0];
  if (targetUser) {
    if (instagram) {
      targetUser.channels.instagram = {
        ...(targetUser.channels.instagram || {}),
        ...instagram,
      };
    }
    if (Array.isArray(slots)) targetUser.slots = slots;
    if (Array.isArray(appointments)) targetUser.appointments = appointments;
    if (Array.isArray(notifications)) targetUser.notifications = notifications;
    saveDb();
  }
  res.json({ ok: true });
});

// Meta'nın tek webhook adresi (tüm işletmeler için) — Meta Developer paneline bu yazılır
app.get('/api/webhooks/meta', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === META_VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/api/webhooks/meta', async (req, res) => {
  // İmza doğrulama (sahte istekleri engelle)
  if (META_APP_SECRET) {
    const sig = req.get('x-hub-signature-256') || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(req.rawBody || '').digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.sendStatus(403);
    }
  }
  res.sendStatus(200); // Meta 20 sn içinde 200 bekler, cevabı arkada üretiyoruz

  try {
    for (const entry of req.body?.entry || []) {
      const user = Object.values(db.users).find(
        (u) => u.channels?.instagram?.igId === entry.id || u.channels?.instagram?.pageId === entry.id
      );
      if (!user) continue;
      for (const ev of entry.messaging || []) {
        const text = ev.message?.text;
        if (!text || ev.message?.is_echo) continue;
        const senderId = ev.sender?.id;
        const outcome = await handleIncomingChannelMessage(user, {
          platform: 'instagram',
          senderId,
          senderName: `IG:${senderId}`,
          text,
        });
        if (outcome?.replyText) {
          await sendInstagramReply(user, senderId, outcome.replyText).catch((e) =>
            console.error('Instagram cevap gönderilemedi:', e.message)
          );
        }
      }
    }
  } catch (e) {
    console.error('Meta webhook hatası:', e.message);
  }
});

// 7) GERÇEK INSTAGRAM GRAPH API & TIKTOK BUSINESS WEBHOOK UÇLARI
app.get('/api/webhooks/instagram/:userId', (req, res) => {
  // Meta Webhook Doğrulaması (hub.challenge)
  if (req.query['hub.challenge']) return res.send(req.query['hub.challenge']);
  res.send('Instagram Webhook Active');
});

app.post('/api/webhooks/instagram/:userId', async (req, res) => {
  try {
    const user = db.users[req.params.userId] || getUserFromReq(req);
    if (!user) return res.status(404).json({ ok: false });

    const senderName = req.body?.senderName || req.body?.entry?.[0]?.messaging?.[0]?.sender?.id || '@instagram_musteri';
    const text = req.body?.text || req.body?.entry?.[0]?.messaging?.[0]?.message?.text || '';
    if (!text) return res.json({ ok: true });

    const outcome = await handleIncomingChannelMessage(user, {
      platform: 'instagram',
      senderId: senderName,
      senderName,
      text,
    });
    res.json({ ok: true, outcome, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/webhooks/tiktok/:userId', async (req, res) => {
  try {
    const user = db.users[req.params.userId] || getUserFromReq(req);
    if (!user) return res.status(404).json({ ok: false });

    const senderName = req.body?.senderName || req.body?.user?.username || '@tiktok_musteri';
    const text = req.body?.text || req.body?.content?.text || '';
    if (!text) return res.json({ ok: true });

    const outcome = await handleIncomingChannelMessage(user, {
      platform: 'tiktok',
      senderId: senderName,
      senderName,
      text,
    });
    res.json({ ok: true, outcome, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/webhooks/whatsapp/:userId', async (req, res) => {
  try {
    const user = db.users[req.params.userId] || getUserFromReq(req);
    if (!user) return res.status(404).json({ ok: false });
    const { senderPhone = '05358889900', senderName = 'Müşteri', text = '' } = req.body || {};
    const outcome = await handleIncomingChannelMessage(user, {
      platform: 'whatsapp',
      senderId: cleanNumber(senderPhone),
      senderName,
      text,
    });
    res.json({ ok: true, outcome, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 8) 📞 GERÇEK SESLİ TELEFON ARAMASI & CANLI AI SANTRAL MOTORU (GSM / SIP / WebRTC Sesli Konuşma)
app.post('/api/voice-call/turn', async (req, res) => {
  try {
    const { user, isAuthed } = getAuthContext(req);
    const targetUser = user || db.users['u_905525222988'] || Object.values(db.users)[0];
    if (!targetUser) return res.status(404).json({ ok: false, error: 'İşletme bulunamadı.' });

    const { callerName = 'Ahmet Yılmaz', callerPhone = '05358889900', transcript = '', isStart = false, playOnHost = true } = req.body || {};
    const freeSlots = (targetUser.slots || []).filter((s) => s.status === 'free').map((s) => `Saat ${s.shortHour}`);
    const busySlots = (targetUser.slots || []).filter((s) => s.status === 'busy').map((s) => `Saat ${s.shortHour}`);

    let spokenText = '';
    let outcome = null;

    const bizName = targetUser.businessName || 'işletmemiz';
    if (isStart || !transcript.trim()) {
      let introLine = targetUser.callGreetingText ? targetUser.callGreetingText.trim() : '';
      if (!introLine || /avelon/i.test(introLine)) {
        introLine = `Alo, merhabalar! ${bizName} sesli asistanıyım. Size nasıl yardımcı olabilirim?`;
      }
      spokenText =
        `${introLine} ` +
        `Şu anda ${busySlots.length ? busySlots.join(' ve ') + ' dolu; ' : ''}` +
        `${freeSlots.length ? freeSlots.join(', ') + ' ise boştur. ' : 'bugün boş saatimiz kalmamıştır. '}` +
        `Saat kaç için randevu oluşturmamı istersiniz?`;
    } else {
      outcome = await handleIncomingChannelMessage(targetUser, {
        platform: 'phone_call',
        senderId: cleanNumber(callerPhone),
        senderName: callerName,
        text: transcript,
      });

      if (!outcome || outcome.type === 'auto_reply_only') {
        spokenText = `Merhabalar, şu anda başlangıç paketindesiniz. ${targetUser.autoReplyText}`;
      } else if (outcome.type === 'booked') {
        spokenText = `Harika ${callerName}! Saat ${outcome.slot.shortHour}, yani ${outcome.slot.time24} için randevunuzu hemen oluşturdum ve takvimde sizin adınıza kapattım. İşletmemize bekliyoruz, iyi günler dilerim!`;
      } else if (outcome.type === 'busy_error') {
        spokenText = `Maalesef söylediğiniz saat şu anda dolu. Şu an ${freeSlots.join(', ')} boş durumda. Hangisini yazmamı istersiniz?`;
      } else if (outcome.type === 'cancelled') {
        spokenText = `Randevunuz başarıyla iptal edildi ve saat tekrar boşa çıkarıldı. İyi günler dileriz.`;
      } else if (outcome.type === 'faq_price') {
        const cleanServices = (targetUser.servicesText || targetUser.autoReplyText || '').replace(/\n+/g, ', ');
        spokenText = `${targetUser.businessName} fiyatlarımız şöyle: ${cleanServices}. Bugün ${freeSlots.length ? freeSlots.join(', ') + ' müsait' : 'boş saat kalmadı'}. Hangi saate randevu alalım?`;
      } else if (outcome.type === 'faq_location') {
        spokenText = `Adresimiz ${targetUser.locationText || 'Merkez Şube'}. Çalışma saatlerimiz ${targetUser.workingHoursText || '13:00 - 20:00'}. Hangi saati ayırmamı istersiniz?`;
      } else {
        spokenText =
          `Tabii, hemen kontrol ediyorum. Bugün ${busySlots.length ? busySlots.join(' ve ') + ' dolu; ' : ''}` +
          `${freeSlots.length ? freeSlots.join(', ') + ' ise müsait. ' : ''}` +
          `Hangi saati tercih edersiniz? Örneğin Saat 6 olsun diyebilirsiniz.`;
      }
    }

    let audioBase64 = null;
    try {
      const mp3Buffer = await synthesizeSpeechBuffer(spokenText, targetUser.voice || 'tr-TR-EmelNeural', false);
      if (mp3Buffer) {
        audioBase64 = `data:audio/mp3;base64,${mp3Buffer.toString('base64')}`;
        if (playOnHost === true || playOnHost === 'true' || process.env.PLAY_HOST_AUDIO === 'true') {
          playMp3BufferNonBlocking(mp3Buffer, true);
        }
      }
    } catch (_) { }

    res.json({
      ok: true,
      spokenText,
      audioBase64,
      outcome,
      user: buildSafeOpAiUser(targetUser, isAuthed),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 9) GERÇEK TWILIO / NETGSM / SIP SANTRAL WEBHOOK UCU (Normal 0850 / 0216 / GSM Yönlendirme Aramaları İçin)
function xmlEscape(t = '') {
  return String(t).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// Telefon cevaplarını Edge TTS (Emel/Ahmet) sesiyle MP3 olarak sun → Twilio <Play> ile çalar
const callAudioCache = new Map();
app.get('/api/voice-call/audio/:id.mp3', (req, res) => {
  const buf = callAudioCache.get(req.params.id);
  if (!buf) return res.sendStatus(404);
  res.type('audio/mpeg').send(buf);
});

async function buildSpeechTag(req, user, text) {
  try {
    const buf = await synthesizeSpeechBuffer(text, user.voice || 'tr-TR-EmelNeural', false);
    if (buf) {
      const id = crypto.randomBytes(8).toString('hex');
      callAudioCache.set(id, buf);
      setTimeout(() => callAudioCache.delete(id), 10 * 60 * 1000);
      return `<Play>${getBaseUrl(req)}/api/voice-call/audio/${id}.mp3</Play>`;
    }
  } catch (_) { }
  return `<Say language="tr-TR" voice="Polly.Filiz">${xmlEscape(text)}</Say>`;
}

app.post('/api/webhooks/voice-call/:userId', async (req, res) => {
  try {
    const user = db.users[req.params.userId];
    if (!user) return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    const callerPhone = req.body?.From || req.body?.caller || 'Bilinmeyen';
    const speechResult = String(req.body?.SpeechResult || req.body?.transcript || '').trim();
    const freeSlots = (user.slots || []).filter((s) => s.status === 'free').map((s) => `saat ${s.shortHour}`);
    const action = `/api/webhooks/voice-call/${user.id}`;

    const bizName = user.businessName || 'işletmemiz';
    let replySpeech = '';
    let hangup = false;
    if (!speechResult) {
      let intro = user.callGreetingText ? user.callGreetingText.trim() : '';
      if (!intro || /avelon/i.test(intro)) {
        intro = `Alo, merhabalar! ${bizName} sesli asistanıyım. Size nasıl yardımcı olabilirim?`;
      }
      replySpeech =
        intro +
        (freeSlots.length ? ` Bugün ${freeSlots.join(', ')} müsait. ` : ' ') +
        `Size nasıl yardımcı olabilirim?`;
    } else {
      const outcome = await handleIncomingChannelMessage(user, {
        platform: 'phone_call',
        senderId: cleanNumber(callerPhone) || callerPhone,
        senderName: `Arayan (${callerPhone})`,
        text: speechResult,
      });
      if (outcome?.type === 'booked') {
        replySpeech = `Tamamdır, saat ${outcome.slot.shortHour} için randevunuzu oluşturdum. Görüşmek üzere, iyi günler!`;
        hangup = true;
      } else if (outcome?.type === 'cancelled') {
        replySpeech = 'Randevunuz iptal edildi. İyi günler dileriz.';
        hangup = true;
      } else {
        replySpeech = toPlainText(outcome?.replyText || user.autoReplyText || 'Anlayamadım, tekrar söyler misiniz?')
          .replace(/[\p{Extended_Pictographic}\u{FE0F}•👉]/gu, '').replace(/&/g, ' ve ').replace(/\(Örn:[^)]*\)/g, '')
          .replace(/yazabilirsiniz/g, 'söyleyebilirsiniz').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
      }
    }

    const speech = await buildSpeechTag(req, user, replySpeech);
    const xml = hangup
      ? `<?xml version="1.0" encoding="UTF-8"?><Response>${speech}<Hangup/></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="tr-TR" speechTimeout="auto" action="${action}" method="POST">
    ${speech}
  </Gather>
  <Say language="tr-TR" voice="Polly.Filiz">Sizi duyamadım, aradığınız için teşekkürler.</Say>
  <Hangup/>
</Response>`;
    res.type('text/xml').send(xml);
  } catch (e) {
    console.error('Sesli arama webhook hatası:', e.message);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say language="tr-TR">Bir hata oluştu.</Say><Hangup/></Response>');
  }
});

// 10) SÜPER ADMİN PANELİ ENTEGRASYON API'Sİ (localhost:3000/admin/opai İçin Gerçek Kayıtlı İşletmeler & Metrikler)
function checkAdminAuth(req) {
  const adminKey = process.env.ADMIN_KEY || 'opai_admin_secret_2026';
  const headerKey = req.headers['x-admin-key'] || req.query.adminKey;
  if (headerKey && headerKey === adminKey) {
    return true;
  }
  const { user, isAuthed, tokenObj, isDemo } = getAuthContext(req);
  if (isAuthed && user && !tokenObj?.isDemo && !isDemo) {
    if (user.isAdmin === true) {
      return true;
    }
  }
  return false;
}

app.get('/api/admin/overview', (req, res) => {
  if (!checkAdminAuth(req)) {
    return res.status(403).json({ ok: false, error: 'Yetkisiz erişim. Admin yetkisi gereklidir.' });
  }
  const allUsers = Object.values(db.users || {}).map((u) => {
    const plan = PRICING_PLANS[u.planId] || PRICING_PLANS.omni_1490;
    const rt = activeSockets.get(u.id);
    const busySlots = (u.slots || []).filter((s) => s.status === 'busy');
    return {
      id: u.id,
      ownerName: u.ownerName || 'İşletme Yetkilisi',
      businessName: u.businessName,
      email: u.email || '-',
      phone: u.id === 'u_905525222988' ? 'Kurucu Hesabı (Gizli)' : u.phone,
      planId: u.planId,
      planName: plan.name,
      planPrice: plan.price,
      botEnabled: Boolean(u.botEnabled),
      kvkkApproved: u.kvkkApproved !== false,
      kvkkApprovedAt: u.kvkkApprovedAt || u.createdAt,
      createdAt: u.createdAt,
      busySlotsCount: busySlots.length,
      freeSlotsCount: (u.slots || []).length - busySlots.length,
      appointmentsCount: (u.appointments || []).length,
      notificationsCount: (u.notifications || []).length,
      recentNotifications: (u.notifications || []).slice(0, 5),
      slots: u.slots || [],
      channels: {
        whatsapp: Boolean(rt?.status === 'connected' || u.channels?.whatsapp?.connected),
        instagram: Boolean(u.channels?.instagram?.connected || u.channels?.instagram?.username),
        tiktok: Boolean(u.channels?.tiktok?.connected || u.channels?.tiktok?.username),
        instagramUsername: u.channels?.instagram?.username || '',
        tiktokUsername: u.channels?.tiktok?.username || '',
      },
    };
  });

  const totalBusinesses = allUsers.length;
  const activeBusinesses = allUsers.filter((u) => u.botEnabled).length;
  const totalAppointments = allUsers.reduce((acc, u) => acc + u.busySlotsCount, 0);
  const monthlyRecurringRevenue = allUsers.reduce((acc, u) => acc + (u.botEnabled ? Number(u.planPrice || 0) : 0), 0);
  const connectedChannelsCount = allUsers.reduce(
    (acc, u) => acc + (u.channels.whatsapp ? 1 : 0) + (u.channels.instagram ? 1 : 0) + (u.channels.tiktok ? 1 : 0),
    0
  );

  res.json({
    ok: true,
    stats: {
      totalBusinesses,
      activeBusinesses,
      totalAppointments,
      monthlyRecurringRevenue,
      connectedChannelsCount,
    },
    plans: PRICING_PLANS,
    users: allUsers.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
  });
});

app.post('/api/admin/users/:id/toggle', (req, res) => {
  if (!checkAdminAuth(req)) {
    return res.status(403).json({ ok: false, error: 'Yetkisiz erişim. Admin yetkisi gereklidir.' });
  }
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ ok: false, error: 'İşletme bulunamadı.' });
  user.botEnabled = !user.botEnabled;
  saveDb();
  res.json({ ok: true, botEnabled: user.botEnabled });
});

app.post('/api/admin/users/:id/plan', (req, res) => {
  if (!checkAdminAuth(req)) {
    return res.status(403).json({ ok: false, error: 'Yetkisiz erişim. Admin yetkisi gereklidir.' });
  }
  const user = db.users[req.params.id];
  const { planId } = req.body || {};
  if (!user || !PRICING_PLANS[planId]) return res.status(400).json({ ok: false, error: 'Geçersiz işletme veya paket.' });
  user.planId = planId;
  saveDb();
  res.json({ ok: true, planId: user.planId });
});

app.delete('/api/admin/users/:id', (req, res) => {
  if (!checkAdminAuth(req)) {
    return res.status(403).json({ ok: false, error: 'Yetkisiz erişim. Admin yetkisi gereklidir.' });
  }
  const uid = req.params.id;
  if (uid === 'u_905525222988') {
    return res.status(400).json({ ok: false, error: 'Kurucu işletme hesabı silinemez.' });
  }
  if (!db.users[uid]) return res.status(404).json({ ok: false, error: 'İşletme bulunamadı.' });
  delete db.users[uid];
  saveDb();
  res.json({ ok: true });
});

// ============================================================================
// 11) 100 KİŞİYE SORDUK — GERÇEK OYUNCU, KUPA, ALTIN, ODA & LİDERLİK BACKEND API
// ============================================================================
const SORDUK_DB_FILE = path.join(DATA_DIR, 'sorduk_game_db.json');

function loadSordukDb() {
  try {
    if (fs.existsSync(SORDUK_DB_FILE)) {
      return JSON.parse(fs.readFileSync(SORDUK_DB_FILE, 'utf-8'));
    }
  } catch (_) {}
  return { players: {}, rooms: {} };
}

const sordukDb = loadSordukDb();

function saveSordukDb() {
  try {
    fs.writeFileSync(SORDUK_DB_FILE, JSON.stringify(sordukDb, null, 2), 'utf-8');
  } catch (e) {
    console.error('Sorduk DB kayıt hatası:', e.message);
  }
}

function sanitizePlayer(p) {
  return {
    id: p.id,
    fullName: p.fullName,
    email: p.email,
    nickname: p.nickname,
    isGuest: Boolean(p.isGuest),
    trophies: Number(p.trophies || 0),
    coins: Number(p.coins || 0),
    wins: Number(p.wins || 0),
    matchesPlayed: Number(p.matchesPlayed || 0),
    createdAt: p.createdAt,
  };
}

// A) Yeni Oyuncu Kaydı (Gerçek 0 Kupa, 0 Altın, 0 Galibiyet ile Başlar)
app.post('/api/sorduk/auth/register', (req, res) => {
  const { fullName, email, nickname, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanNick = String(nickname || '').replace(/^@/, '').trim();
  const cleanName = String(fullName || '').trim();

  if (!cleanName || !cleanEmail || !cleanNick || !password) {
    return res.status(400).json({ ok: false, error: 'Lütfen Ad Soyad, E-Posta, Nickname ve Şifre alanlarını doldurun.' });
  }

  const existing = Object.values(sordukDb.players).find(
    (p) =>
      (!p.isGuest && p.email?.toLowerCase() === cleanEmail) ||
      p.nickname?.toLowerCase() === cleanNick.toLowerCase()
  );
  if (existing) {
    return res.status(400).json({ ok: false, error: 'Bu e-posta veya nickname zaten kayıtlı. Giriş Yap sekmesini kullanın.' });
  }

  const id = 'plr_' + crypto.randomBytes(6).toString('hex');
  const player = {
    id,
    fullName: cleanName,
    email: cleanEmail,
    nickname: cleanNick,
    passwordHash: hashPassword(password),
    isGuest: false,
    trophies: 0,
    coins: 0,
    wins: 0,
    matchesPlayed: 0,
    createdAt: new Date().toISOString(),
  };

  sordukDb.players[id] = player;
  saveSordukDb();
  res.json({ ok: true, player: sanitizePlayer(player) });
});

// B) Kayıtlı Oyuncu Girişi
app.post('/api/sorduk/auth/login', (req, res) => {
  const { identifier, email, nickname, password } = req.body || {};
  const query = String(identifier || email || nickname || '').replace(/^@/, '').trim().toLowerCase();
  if (!query || !password) {
    return res.status(400).json({ ok: false, error: 'Lütfen e-posta/nickname ve şifrenizi girin.' });
  }

  const found = Object.values(sordukDb.players).find(
    (p) =>
      !p.isGuest &&
      Boolean(p.passwordHash) &&
      (p.email?.toLowerCase() === query || p.nickname?.toLowerCase() === query)
  );

  if (!found || !verifyPassword(password, found.passwordHash)) {
    return res.status(401).json({ ok: false, error: 'Hesap bulunamadı veya şifre hatalı.' });
  }

  res.json({ ok: true, player: sanitizePlayer(found) });
});

// C) Misafir Girişi (Veritabanında Gerçek Oturum Açar — 0 Kupa, 0 Altın ile Başlar)
app.post('/api/sorduk/auth/guest', (req, res) => {
  const { nickname, existingPlayerId } = req.body || {};
  if (existingPlayerId && sordukDb.players[existingPlayerId]) {
    return res.json({ ok: true, player: sanitizePlayer(sordukDb.players[existingPlayerId]) });
  }

  const cleanNick =
    String(nickname || '').replace(/^@/, '').trim() ||
    `Oyuncu_${Math.floor(1000 + Math.random() * 9000)}`;

  const id = 'gst_' + crypto.randomBytes(6).toString('hex');
  const player = {
    id,
    fullName: cleanNick,
    email: '',
    nickname: cleanNick,
    passwordHash: '',
    isGuest: true,
    trophies: 0,
    coins: 0,
    wins: 0,
    matchesPlayed: 0,
    createdAt: new Date().toISOString(),
  };

  sordukDb.players[id] = player;
  saveSordukDb();
  res.json({ ok: true, player: sanitizePlayer(player) });
});

// D) Misafir Hesabını Kalıcı Hesaba Dönüştür (Kupa ve Altınları Koruyarak)
app.post('/api/sorduk/auth/upgrade', (req, res) => {
  const { playerId, fullName, email, nickname, password } = req.body || {};
  const player = sordukDb.players[playerId];
  if (!player) return res.status(404).json({ ok: false, error: 'Oyuncu oturumu bulunamadı.' });

  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanNick = String(nickname || player.nickname).replace(/^@/, '').trim();
  if (!fullName || !cleanEmail || !password) {
    return res.status(400).json({ ok: false, error: 'Ad Soyad, E-Posta ve Şifre zorunludur.' });
  }

  const emailTaken = Object.values(sordukDb.players).find(
    (p) => p.id !== playerId && !p.isGuest && p.email?.toLowerCase() === cleanEmail
  );
  if (emailTaken) {
    return res.status(400).json({ ok: false, error: 'Bu e-posta başka bir oyuncuda kayıtlı.' });
  }

  player.fullName = String(fullName).trim();
  player.email = cleanEmail;
  player.nickname = cleanNick;
  player.passwordHash = hashPassword(password);
  player.isGuest = false;
  saveSordukDb();

  res.json({ ok: true, player: sanitizePlayer(player) });
});

// E) Gerçek Kupa, Altın ve Galibiyet Senkronizasyonu
app.post('/api/sorduk/sync', (req, res) => {
  const { playerId, trophiesDelta = 0, coinsDelta = 0, winsDelta = 0, matchesDelta = 0 } = req.body || {};
  const player = sordukDb.players[playerId];
  if (!player) return res.status(404).json({ ok: false, error: 'Oyuncu bulunamadı.' });

  player.trophies = Math.max(0, Number(player.trophies || 0) + Number(trophiesDelta || 0));
  player.coins = Math.max(0, Number(player.coins || 0) + Number(coinsDelta || 0));
  player.wins = Math.max(0, Number(player.wins || 0) + Number(winsDelta || 0));
  player.matchesPlayed = Math.max(0, Number(player.matchesPlayed || 0) + Number(matchesDelta || 0));
  saveSordukDb();

  res.json({ ok: true, player: sanitizePlayer(player) });
});

// E.2) Apple App Store (Guideline 5.1.1v) & Google Play & KVKK Madde 7 Zorunlu Hesap ve Veri Silme Endpoint'i
app.post('/api/sorduk/auth/delete', (req, res) => {
  const { playerId, nickname, email } = req.body || {};
  let deletedId = null;

  if (playerId && sordukDb.players[playerId]) {
    deletedId = playerId;
    delete sordukDb.players[playerId];
  } else {
    const found = Object.values(sordukDb.players).find(
      (p) =>
        (email && p.email?.toLowerCase() === String(email).trim().toLowerCase()) ||
        (nickname && p.nickname?.toLowerCase() === String(nickname).replace(/^@/, '').trim().toLowerCase())
    );
    if (found) {
      deletedId = found.id;
      delete sordukDb.players[found.id];
    }
  }

  // Aktif odalardan da oyuncuyu temizle
  if (nickname) {
    const cleanNick = String(nickname).replace(/^@/, '').trim().toLowerCase();
    Object.keys(sordukDb.rooms).forEach((code) => {
      const rm = sordukDb.rooms[code];
      if (!rm) return;
      rm.bluePlayers = (rm.bluePlayers || []).filter((p) => p.name.toLowerCase() !== cleanNick);
      rm.redPlayers = (rm.redPlayers || []).filter((p) => p.name.toLowerCase() !== cleanNick);
    });
  }

  saveSordukDb();
  res.json({
    ok: true,
    deletedId,
    message: 'Hesabınız ve tüm kişisel verileriniz 6698 sayılı KVKK ve mağaza kuralları gereğince kalıcı olarak silinmiştir.',
  });
});

// E.3) Apple Guideline 1.2 & Google Play UGC (Kullanıcı İçeriği) Şikayet / Engelleme Endpoint'i
app.post('/api/sorduk/report', (req, res) => {
  const { reporter, targetUser, reason, roomCode } = req.body || {};
  if (!Array.isArray(sordukDb.reports)) sordukDb.reports = [];
  sordukDb.reports.push({
    id: 'rep_' + Date.now(),
    reporter: String(reporter || 'Anonim'),
    targetUser: String(targetUser || ''),
    reason: String(reason || 'Uygunsuz içerik / davranış'),
    roomCode: String(roomCode || ''),
    createdAt: new Date().toISOString(),
  });
  saveSordukDb();
  res.json({ ok: true });
});

function filterProfanityTR(text = '') {
  return String(text || '').replace(
    /\b(amk|aq|sik\w*|oç|orospu\w*|piç\w*|yarrak\w*|göt\w*|kahpe\w*|pezevenk\w*)\b/gi,
    '***'
  );
}
function ensureActivePublicRooms() {
  const defaultRooms = [
    {
      code: 'ODA-303',
      title: 'Türkiye Şampiyonlar Arenası',
      hostNickname: 'Eren_Kaptan',
      mode: '3v3',
      category: 'Tümü (Dev Havuz)',
      blueTeamName: 'Eren Takımı',
      redTeamName: 'Anadolu Kartalları',
      chatText: '3v3 Oda hazır! Katılın hemen başlayalım 🔥',
    },
    {
      code: 'ODA-101',
      title: 'Hızlı 1v1 Kürsü Düellosu',
      hostNickname: 'Zeynep_Kaya',
      mode: '1v1',
      category: 'Günlük Hayat & Ev',
      blueTeamName: 'Zeynep_Kaya',
      redTeamName: 'Rakip Bekleniyor',
      chatText: 'Teke tek kapışmaya beklerim! ⚡',
    },
    {
      code: 'ODA-777',
      title: 'Gece Tayfası 3v3',
      hostNickname: 'Burak_34',
      mode: '3v3',
      category: 'Komik & İlişkiler',
      blueTeamName: 'İstanbul 34',
      redTeamName: 'Kırmızı Fırtına',
      chatText: 'Kaptanlar eller butona, 1 kişi daha gelsin! 🎯',
    },
  ];

  for (const def of defaultRooms) {
    if (!sordukDb.rooms[def.code]) {
      sordukDb.rooms[def.code] = ensureRoomStructure({
        code: def.code,
        title: def.title,
        hostNickname: def.hostNickname,
        mode: def.mode,
        category: def.category,
        isPrivate: false,
        fillWithBots: true,
        status: 'waiting',
        blueTeamName: def.blueTeamName,
        redTeamName: def.redTeamName,
        blueCaptainIdx: 0,
        redCaptainIdx: 0,
        bluePlayers: [
          {
            id: `human_${def.hostNickname}`,
            name: def.hostNickname,
            avatarId: 'siber',
            isBot: false,
            isReady: true,
          },
        ],
        redPlayers: [],
        members: [def.hostNickname],
        maxPlayers: def.mode === '1v1' ? 2 : 6,
        chat: [
          {
            id: `seed_${def.code}`,
            sender: def.hostNickname,
            team: 'blue',
            text: def.chatText,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          },
        ],
        matchState: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      sordukDb.rooms[def.code].updatedAt = new Date().toISOString();
    }
  }
}

// F) Gerçek Liderlik Tablosu & Açık Odalar Listesi
app.get('/api/sorduk/state', (req, res) => {
  const leaderboard = Object.values(sordukDb.players)
    .map((p) => sanitizePlayer(p))
    .sort((a, b) => b.trophies - a.trophies || b.wins - a.wins || b.coins - a.coins)
    .slice(0, 25);

  // Eski (2 saatten uzun süredir hareketsiz) odaları temizle
  const now = Date.now();
  Object.keys(sordukDb.rooms).forEach((k) => {
    const rm = sordukDb.rooms[k];
    const ts = new Date(rm.updatedAt || rm.createdAt || 0).getTime();
    if (now - ts > 2 * 60 * 60 * 1000) {
      delete sordukDb.rooms[k];
    }
  });

  ensureActivePublicRooms();

  // Sadece Herkese Açık (!isPrivate) olan gerçek odaları döndür (şifre bilgisini dışarı sızdırma)
  const openRooms = Object.values(sordukDb.rooms)
    .filter((rm) => !rm.isPrivate)
    .map((rm) => {
      const { password, ...safeRm } = rm;
      return { ...safeRm, hasPassword: Boolean(password) };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({
    ok: true,
    leaderboard,
    rooms: openRooms,
  });
});

function ensureRoomStructure(rm) {
  const teamSize = rm.mode === '1v1' ? 1 : 3;
  rm.maxPlayers = teamSize * 2;
  if (!Array.isArray(rm.bluePlayers)) {
    rm.bluePlayers = [
      {
        id: `p_${rm.hostNickname || 'Host'}`,
        name: rm.hostNickname || 'Oyuncu',
        avatarId: 'rookie',
        isBot: false,
        isReady: true,
      },
    ];
  }
  if (!Array.isArray(rm.redPlayers)) {
    rm.redPlayers = [];
  }
  if (typeof rm.blueTeamName !== 'string') {
    rm.blueTeamName = rm.mode === '1v1' ? rm.hostNickname : `${rm.hostNickname} Takımı`;
  }
  if (typeof rm.redTeamName !== 'string') {
    rm.redTeamName = rm.mode === '1v1' ? 'Rakip Takım' : 'Kırmızı Takım';
  }
  if (typeof rm.blueCaptainIdx !== 'number') rm.blueCaptainIdx = 0;
  if (typeof rm.redCaptainIdx !== 'number') rm.redCaptainIdx = 0;
  if (!Array.isArray(rm.chat)) rm.chat = [];
  if (!Array.isArray(rm.kickedNames)) rm.kickedNames = [];
  if (!rm.status) rm.status = 'waiting';
  if (typeof rm.fillWithBots !== 'boolean') rm.fillWithBots = false;
  rm.hasPassword = Boolean(rm.password);

  // Üye listesini gerçek oyunculardan senkronla
  const realNames = [
    ...rm.bluePlayers.filter((p) => !p.isBot).map((p) => p.name),
    ...rm.redPlayers.filter((p) => !p.isBot).map((p) => p.name),
  ];
  rm.members = Array.from(new Set(realNames));
  return rm;
}

// G) Gerçek Oda Kurma & Odaya Katılma & Şifreli Özel Oda Doğrulaması
app.post('/api/sorduk/rooms', (req, res) => {
  const {
    hostNickname,
    avatarId = 'rookie',
    title,
    mode = '3v3',
    category = 'Tümü (Dev Havuz)',
    customCode,
    isPrivate = false,
    password = '',
    fillWithBots = false,
    createOnly = false,
    joinOnly = false,
  } = req.body || {};

  const cleanNick = String(hostNickname || 'Oyuncu').trim() || 'Oyuncu';
  const rawCode = String(customCode || `ODA-${Math.floor(100 + Math.random() * 900)}`)
    .trim()
    .toUpperCase();
  const code = rawCode.startsWith('ODA-') || rawCode.length >= 4 ? rawCode : `ODA-${rawCode}`;
  const cleanPass = String(password || '').trim();

  if (joinOnly && !sordukDb.rooms[code]) {
    return res.status(404).json({
      ok: false,
      error: `"${code}" kodlu aktif bir oda bulunamadı! Oda kodunu kontrol edin.`,
    });
  }

  if (!sordukDb.rooms[code] || createOnly) {
    const teamSize = mode === '1v1' ? 1 : 3;
    // Özel oda kurulduğunda ASLA sahte bot veya sahte sohbet mesajı eklenmez!
    const useBots = isPrivate || createOnly ? false : Boolean(fillWithBots);
    const initialChat = [
      {
        id: `sys_${Date.now()}`,
        sender: 'SİSTEM',
        team: 'system',
        text: `@${cleanNick} "${code}" ${isPrivate ? '🔒 Kapalı/Şifreli' : '🌐 Herkese Açık'} odasını kurdu (${mode === '3v3' ? '3 VS 3' : '1 VS 1'}).`,
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      },
    ];

    sordukDb.rooms[code] = ensureRoomStructure({
      code,
      title: String(title || `${cleanNick} Arenası`).trim(),
      hostNickname: cleanNick,
      mode,
      category,
      isPrivate: Boolean(isPrivate),
      password: isPrivate ? cleanPass : '',
      hasPassword: Boolean(isPrivate && cleanPass),
      fillWithBots: useBots,
      status: 'waiting',
      blueTeamName: mode === '1v1' ? `${cleanNick}` : `${cleanNick} Takımı`,
      redTeamName: mode === '1v1' ? 'Rakip Oyuncu' : 'Karşı Takım',
      blueCaptainIdx: 0,
      redCaptainIdx: 0,
      bluePlayers: [
        {
          id: `human_${cleanNick}_${Date.now()}`,
          name: cleanNick,
          avatarId,
          isBot: false,
          isReady: true,
        },
      ],
      redPlayers: [],
      kickedNames: [],
      members: [cleanNick],
      maxPlayers: teamSize * 2,
      chat: initialChat,
      matchState: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } else {
    const rm = ensureRoomStructure(sordukDb.rooms[code]);

    // Odadan atılmış mı kontrol et
    if (
      Array.isArray(rm.kickedNames) &&
      rm.kickedNames.some((n) => n.toLowerCase() === cleanNick.toLowerCase()) &&
      rm.hostNickname.toLowerCase() !== cleanNick.toLowerCase()
    ) {
      return res.status(403).json({
        ok: false,
        error: 'Oda kurucusu tarafından bu odadan çıkarıldınız.',
      });
    }

    // Şifreli oda kontrolü (Kurucu değilse ve şifre varsa doğrula)
    if (
      rm.password &&
      rm.hostNickname.toLowerCase() !== cleanNick.toLowerCase() &&
      rm.password !== cleanPass
    ) {
      return res.status(403).json({
        ok: false,
        requiresPassword: true,
        error: '🔒 Bu oda şifreli! Katılmak için doğru oda şifresini girin.',
      });
    }

    const teamSize = rm.mode === '1v1' ? 1 : 3;
    const inBlue = rm.bluePlayers.find((p) => !p.isBot && p.name.toLowerCase() === cleanNick.toLowerCase());
    const inRed = rm.redPlayers.find((p) => !p.isBot && p.name.toLowerCase() === cleanNick.toLowerCase());

    if (!inBlue && !inRed) {
      const totalHumans =
        rm.bluePlayers.filter((p) => !p.isBot).length +
        rm.redPlayers.filter((p) => !p.isBot).length;
      if (totalHumans >= teamSize * 2) {
        return res.status(400).json({
          ok: false,
          error: 'Bu oda şu anda tamamen dolu!',
        });
      }

      const newPlayer = {
        id: `human_${cleanNick}_${Date.now()}`,
        name: cleanNick,
        avatarId,
        isBot: false,
        isReady: false,
      };

      // Dengeli takım yerleştirme (Oyuncu girdikten sonra istediği takıma geçebilir)
      let joinedTeam = 'red';
      if (rm.mode === '1v1') {
        if (rm.redPlayers.filter((p) => !p.isBot).length === 0) {
          rm.redPlayers = [newPlayer];
          rm.redTeamName = cleanNick;
          joinedTeam = 'red';
        } else {
          rm.bluePlayers = [newPlayer];
          rm.blueTeamName = cleanNick;
          joinedTeam = 'blue';
        }
      } else {
        const blueHumans = rm.bluePlayers.filter((p) => !p.isBot).length;
        const redHumans = rm.redPlayers.filter((p) => !p.isBot).length;
        if (redHumans < blueHumans && redHumans < teamSize) {
          rm.redPlayers = [...rm.redPlayers.filter((p) => !p.isBot), newPlayer];
          joinedTeam = 'red';
        } else if (blueHumans < teamSize) {
          rm.bluePlayers = [...rm.bluePlayers.filter((p) => !p.isBot), newPlayer];
          joinedTeam = 'blue';
        } else {
          rm.redPlayers = [...rm.redPlayers.filter((p) => !p.isBot), newPlayer];
          joinedTeam = 'red';
        }
      }

      rm.chat.push({
        id: `join_${Date.now()}`,
        sender: 'SİSTEM',
        team: 'system',
        text: `🎉 @${cleanNick} odaya katıldı ve ${joinedTeam === 'blue' ? '🔵 Mavi Takıma' : '🔴 Kırmızı Takıma'} yerleşti!`,
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      });
      ensureRoomStructure(rm);
    }
    rm.updatedAt = new Date().toISOString();
  }

  saveSordukDb();
  const { password: _pw, ...safeRoom } = sordukDb.rooms[code];
  res.json({ ok: true, room: { ...safeRoom, hasPassword: Boolean(_pw) } });
});

// Tekil Oda Detayı ve Canlı Durumu Getir
app.get('/api/sorduk/rooms/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const rm = sordukDb.rooms[code];
  if (!rm) {
    return res.status(404).json({ ok: false, error: 'Oda bulunamadı.' });
  }
  const structured = ensureRoomStructure(rm);
  const { password: _pw, ...safeRoom } = structured;
  res.json({ ok: true, room: { ...safeRoom, hasPassword: Boolean(_pw) } });
});

// Oda İçi Canlı Aksiyonlar (Takım Değiştir, Oyuncu At/Kick, Karşı Takıma Gönder, Hazır, Sohbet, Takım Adı, Maç Başlat)
app.post('/api/sorduk/rooms/:code/action', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const rm = sordukDb.rooms[code];
  if (!rm) {
    return res.status(404).json({ ok: false, error: 'Oda bulunamadı.' });
  }
  ensureRoomStructure(rm);

  const { type, nickname, avatarId = 'rookie', payload = {} } = req.body || {};
  const cleanNick = String(nickname || 'Oyuncu').trim();
  const isHost = rm.hostNickname.toLowerCase() === cleanNick.toLowerCase();
  const teamSize = rm.mode === '1v1' ? 1 : 3;

  if (type === 'switch_team') {
    const targetName = isHost && payload.targetName ? String(payload.targetName).trim() : cleanNick;
    const targetTeam = payload.targetTeam === 'red' ? 'red' : 'blue';
    const existing =
      rm.bluePlayers.find((p) => p.name.toLowerCase() === targetName.toLowerCase()) ||
      rm.redPlayers.find((p) => p.name.toLowerCase() === targetName.toLowerCase()) || {
        id: `human_${targetName}`,
        name: targetName,
        avatarId,
        isBot: false,
        isReady: false,
      };

    if (targetTeam === 'red' && rm.redPlayers.filter((p) => !p.isBot).length < teamSize) {
      rm.bluePlayers = rm.bluePlayers.filter((p) => p.name.toLowerCase() !== targetName.toLowerCase());
      if (!rm.redPlayers.some((p) => p.name.toLowerCase() === targetName.toLowerCase())) {
        rm.redPlayers.push(existing);
      }
      rm.chat.push({
        id: `sw_${Date.now()}`,
        sender: 'SİSTEM',
        team: 'system',
        text: `🔴 @${existing.name} Kırmızı Takıma geçti.`,
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      });
    } else if (targetTeam === 'blue' && rm.bluePlayers.filter((p) => !p.isBot).length < teamSize) {
      rm.redPlayers = rm.redPlayers.filter((p) => p.name.toLowerCase() !== targetName.toLowerCase());
      if (!rm.bluePlayers.some((p) => p.name.toLowerCase() === targetName.toLowerCase())) {
        rm.bluePlayers.push(existing);
      }
      rm.chat.push({
        id: `sw_${Date.now()}`,
        sender: 'SİSTEM',
        team: 'system',
        text: `🔵 @${existing.name} Mavi Takıma geçti.`,
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      });
    }
  } else if (type === 'kick_player') {
    // Sadece Oda Kurucusu (Host) odadan rakip/oyuncu atabilir!
    if (isHost && payload.targetName) {
      const target = String(payload.targetName).trim();
      if (target.toLowerCase() !== rm.hostNickname.toLowerCase()) {
        rm.bluePlayers = rm.bluePlayers.filter((p) => p.name.toLowerCase() !== target.toLowerCase());
        rm.redPlayers = rm.redPlayers.filter((p) => p.name.toLowerCase() !== target.toLowerCase());
        if (!payload.isBot) {
          rm.kickedNames = Array.from(new Set([...(rm.kickedNames || []), target]));
        } else {
          rm.fillWithBots = false;
        }
        rm.chat.push({
          id: `kick_${Date.now()}`,
          sender: 'SİSTEM',
          team: 'system',
          text: `🚫 @${target} oda kurucusu tarafından odadan çıkarıldı.`,
          time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        });
      }
    }
  } else if (type === 'toggle_ready') {
    [...rm.bluePlayers, ...rm.redPlayers].forEach((p) => {
      if (p.name.toLowerCase() === cleanNick.toLowerCase()) p.isReady = !p.isReady;
    });
  } else if (type === 'set_team_meta') {
    if (typeof payload.blueTeamName === 'string') rm.blueTeamName = payload.blueTeamName;
    if (typeof payload.redTeamName === 'string') rm.redTeamName = payload.redTeamName;
    if (typeof payload.blueCaptainIdx === 'number') rm.blueCaptainIdx = payload.blueCaptainIdx;
    if (typeof payload.redCaptainIdx === 'number') rm.redCaptainIdx = payload.redCaptainIdx;
    if (typeof payload.category === 'string') rm.category = payload.category;
    if (typeof payload.mode === 'string' && (payload.mode === '3v3' || payload.mode === '1v1')) {
      rm.mode = payload.mode;
    }
    if (typeof payload.fillWithBots === 'boolean') rm.fillWithBots = payload.fillWithBots;
  } else if (type === 'chat') {
    const text = filterProfanityTR(String(payload.text || '').trim());
    if (text) {
      const inRed = rm.redPlayers.some((p) => p.name.toLowerCase() === cleanNick.toLowerCase());
      rm.chat.push({
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sender: cleanNick,
        team: inRed ? 'red' : 'blue',
        text: text.slice(0, 180),
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      });
      if (rm.chat.length > 40) rm.chat = rm.chat.slice(-40);
    }
  } else if (type === 'start_match') {
    rm.status = 'playing';
    rm.matchState = {
      ...(payload.matchState || {}),
      startedBy: cleanNick,
      version: Date.now(),
    };
    rm.chat.push({
      id: `start_${Date.now()}`,
      sender: 'SİSTEM',
      team: 'system',
      text: `🔥 Maç kurucu @${cleanNick} tarafından başlatıldı!`,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    });
  } else if (type === 'sync_match') {
    rm.status = payload.status || 'playing';
    rm.matchState = {
      ...(rm.matchState || {}),
      ...(payload.matchState || {}),
      updatedBy: cleanNick,
      version: Date.now(),
    };
  } else if (type === 'leave_room') {
    rm.bluePlayers = rm.bluePlayers.filter((p) => p.name.toLowerCase() !== cleanNick.toLowerCase());
    rm.redPlayers = rm.redPlayers.filter((p) => p.name.toLowerCase() !== cleanNick.toLowerCase());
    const remainingHumans = [
      ...rm.bluePlayers.filter((p) => !p.isBot),
      ...rm.redPlayers.filter((p) => !p.isBot),
    ];
    if (remainingHumans.length === 0) {
      delete sordukDb.rooms[code];
      saveSordukDb();
      return res.json({ ok: true, deleted: true });
    } else if (rm.hostNickname.toLowerCase() === cleanNick.toLowerCase()) {
      rm.hostNickname = remainingHumans[0].name;
    }
  }

  ensureRoomStructure(rm);
  rm.updatedAt = new Date().toISOString();
  saveSordukDb();
  const { password: _pw, ...safeRoom } = rm;
  res.json({ ok: true, room: { ...safeRoom, hasPassword: Boolean(_pw) } });
});

// H) 100 Kişiye Sorduk — Gerçek İnsan Sesli Stüdyo Sunucusu & Yüksek Hassasiyetli Mikrofon Algılama (STT)
let currentHostAudioProc = null;
let hostSpeechSessionId = 0;
let lastSpokenText = '';
let lastSpokenTime = 0;

function stopAllHostAudioNow() {
  hostSpeechSessionId += 1;
  if (currentHostAudioProc) {
    try {
      currentHostAudioProc.kill('SIGKILL');
    } catch (_) {}
    currentHostAudioProc = null;
  }
  try {
    execSync('killall -9 afplay 2>/dev/null || true');
  } catch (_) {}
}

function normalizeTurkishForNaturalSpeech(rawText) {
  const ordinals = {
    1: 'birinci',
    2: 'ikinci',
    3: 'üçüncü',
    4: 'dördüncü',
    5: 'beşinci',
    6: 'altıncı',
    7: 'yedinci',
    8: 'sekizinci',
    9: 'dokuzuncu',
    10: 'onuncu',
  };
  let text = String(rawText || '')
    // Parantez içi teknik açıklamaları seslendirmeden çıkar (doğal konuşma için)
    .replace(/\([^)]*\)/g, ' ')
    // Eğik çizgi ile ayrılmış uzun alternatiflerin sadece ilk doğal kısmını oku
    .replace(/\s*\/\s*[^\s,.!?]+(\s+[^\s,.!?]+)?/g, '')
    // Çift "100 kişiye sorduk" tekrarını tekilleştir
    .replace(/(100 kişiye sorduk[,:\s]*)+/gi, 'Yüz kişiye sorduk, ')
    .replace(/[@#_*~`"&<>]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\b([1-9]|10)\.\s*/g, (_, num) => `${ordinals[num] || num} `)
    .replace(/\b100\b/g, 'yüz')
    .replace(/\bP\b/g, 'puan')
    .replace(/\bvs\b/gi, 'karşı')
    .replace(/Oyuncu_\d+/g, 'kaptan')
    .replace(/\s+/g, ' ')
    .trim();

  // Tekrarlı cümleleri temizle
  text = text.replace(/(Yüz kişiye sorduk,\s*){2,}/gi, 'Yüz kişiye sorduk, ');
  return text;
}

function escapeXmlForSsml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildExpressiveFemaleHostSSML(cleanText, voiceName = 'tr-TR-EmelNeural') {
  const clauses =
    cleanText
      .match(/[^.!?]+[.!?]*/g)
      ?.map((s) => s.trim())
      .filter(Boolean) || [cleanText];

  const prosodyBlocks = clauses
    .map((clause) => {
      const escaped = escapeXmlForSsml(clause);
      if (
        /(şahane|süper|harika|helal|bravo|muhteşem|tebrik|bir numara|tam isabet|güzel tahmin)/i.test(
          clause
        )
      ) {
        return `<prosody pitch="+3Hz" rate="+13%" volume="+12%">${escaped} </prosody>`;
      }
      if (
        /(maalesef|kaçtı|çarpı|bilemedi|panoda yok|listede çıkmadı)/i.test(
          clause
        )
      ) {
        return `<prosody pitch="+1Hz" rate="+12%" volume="+10%">${escaped} </prosody>`;
      }
      if (/\?\s*$/.test(clause)) {
        return `<prosody pitch="+3Hz" rate="+11%" volume="+12%">${escaped} </prosody>`;
      }
      return `<prosody pitch="+2Hz" rate="+12%" volume="+12%">${escaped} </prosody>`;
    })
    .join('');

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="tr-TR"><voice name="${voiceName}">${prosodyBlocks}</voice></speak>`;
}

async function collectTtsStreamBuffer(audioStream, timeoutMs = 4500) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Neural TTS timeout')), timeoutMs);
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
  if (chunks.length > 0) {
    const buf = Buffer.concat(chunks);
    if (buf.length > 500) return buf;
  }
  return null;
}

// ÖNCEDEN AÇILMIŞ (PRE-CONNECTED) SOCKET HAVUZU + HAFIZA MP3 ÖNBELLEĞİ (Önbellek: ~15ms, Yeni Sentez: ~1.1s, Sıfır 4sn Timeout!)
const ttsMp3Cache = new Map();
const MAX_TTS_CACHE = 600;
const warmSocketPool = []; // [{ tts, createdAt }]
let isRefillingPool = false;

function setCachedTtsMp3(key, buf) {
  if (ttsMp3Cache.has(key)) ttsMp3Cache.delete(key);
  ttsMp3Cache.set(key, buf);
  if (ttsMp3Cache.size > MAX_TTS_CACHE) {
    const oldestKey = ttsMp3Cache.keys().next().value;
    if (oldestKey) ttsMp3Cache.delete(oldestKey);
  }
}

async function createConnectedEmelSocket(voice = 'tr-TR-EmelNeural') {
  const inst = new MsEdgeTTS();
  await inst.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  return { tts: inst, voice, createdAt: Date.now() };
}

function refillWarmSocketPool() {
  if (isRefillingPool || warmSocketPool.length >= 2) return;
  isRefillingPool = true;
  (async () => {
    try {
      while (warmSocketPool.length < 2) {
        const entry = await createConnectedEmelSocket('tr-TR-EmelNeural');
        warmSocketPool.push(entry);
      }
    } catch (_) {
    } finally {
      isRefillingPool = false;
    }
  })();
}

async function takeFreshConnectedTts(voice = 'tr-TR-EmelNeural') {
  while (warmSocketPool.length > 0) {
    const entry = warmSocketPool.shift();
    // 25 saniyeden eski boşta kalmış bağlantıları yenile
    if (entry && entry.voice === voice && Date.now() - entry.createdAt < 25000) {
      refillWarmSocketPool();
      return entry.tts;
    }
    try {
      entry?.tts?.close();
    } catch (_) {}
  }
  refillWarmSocketPool();
  const fresh = await createConnectedEmelSocket(voice);
  return fresh.tts;
}

async function generateStudioHostMp3(rawText, requestedVoice = 'tr-TR-EmelNeural') {
  const cleanText = normalizeTurkishForNaturalSpeech(rawText);
  if (!cleanText) return null;

  const voice = requestedVoice || 'tr-TR-EmelNeural';

  const cacheKey = `${voice}:${cleanText}`;
  const cached = ttsMp3Cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const ssml = buildExpressiveFemaleHostSSML(cleanText, voice);
  try {
    const tts = await takeFreshConnectedTts(voice);
    const { audioStream } = tts.rawToStream(ssml);
    const buf = await collectTtsStreamBuffer(audioStream, 3800);
    try {
      tts.close();
    } catch (_) {}
    if (buf) {
      setCachedTtsMp3(cacheKey, buf);
      return buf;
    }
  } catch (err) {
    console.error('SSML TTS fallback:', err?.message);
  }

  try {
    const fallbackTts = new MsEdgeTTS();
    await fallbackTts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = fallbackTts.toStream(cleanText, {
      rate: '+12%',
      pitch: '+2Hz',
    });
    const buf = await collectTtsStreamBuffer(audioStream, 4200);
    try {
      fallbackTts.close();
    } catch (_) {}
    if (buf) {
      setCachedTtsMp3(cacheKey, buf);
      return buf;
    }
  } catch (err2) {
    console.error('Edge Neural HD TTS hatası:', err2?.message);
  }
  return null;
}

// Etap başlarken o etabın olası kısa sunucu cümlelerini arka planda önbelleğe alır (oyuncu yazdığı an 15ms'de okunur!)
app.post('/api/sorduk/prewarm', (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines.slice(0, 14) : [];
  res.json({ ok: true, queued: lines.length });
  (async () => {
    for (const line of lines) {
      try {
        await generateStudioHostMp3(String(line || ''), 'tr-TR-EmelNeural');
      } catch (_) {}
    }
  })();
});

// Sunucu açılışında temel stüdyo tepkilerini önceden hafızaya al (15 ms anında oynatma!)
setTimeout(async () => {
  refillWarmSocketPool();
  const warmupLines = [
    'Harika, bir numara açıldı!',
    'Tebrikler kaptan, bir numara açıldı!',
    'Harika tahmin, 1. sıra açıldı!',
    'Harika tahmin, 2. sıra açıldı!',
    'Güzel tahmin, 3. sıra açıldı!',
    'Güzel tahmin, 4. sıra açıldı!',
    'Güzel tahmin, 5. sıra açıldı!',
    'Güzel tahmin, 6. sıra açıldı!',
    'Güzel tahmin, 7. sıra açıldı!',
    'Güzel tahmin, 8. sıra açıldı!',
    'Maalesef panoda yok.',
    'Maalesef listede çıkmadı!',
    'Maalesef listede yok, ilk çarpı geldi.',
    'Listede çıkmadı, ikinci çarpı.',
    'Listede çıkmadı, söz karşı kaptanda.',
    'Üç çarpı doldu, söz karşı takımda!',
    'Karşı takım hata yaptı, söz tekrar sende!',
    'Karşı kaptan da bilemedi, söz sende kaptan!',
    'Tebrikler, panodaki tüm cevaplar açıldı!',
    'Son cevapları beraber açıyoruz ve etabı tamamlıyoruz!',
    'Harika çalma, puanları kaptınız!',
  ];
  for (const line of warmupLines) {
    try {
      await generateStudioHostMp3(line, 'tr-TR-EmelNeural');
    } catch (_) {}
  }
}, 250);

app.post('/api/sorduk/speak', async (req, res) => {
  const {
    text,
    voice = 'tr-TR-EmelNeural',
    force = false,
    returnAudio = false,
  } = req.body || {};
  const cleanText = normalizeTurkishForNaturalSpeech(text);
  if (!cleanText) {
    return res.json({ ok: false });
  }

  // Tarayıcı (returnAudio) modunda istemci kendi sıra/iptal yönetimini yapar; sadece afplay modunda sunucu dedup uygula
  if (!returnAudio) {
    const now = Date.now();
    if (!force && cleanText === lastSpokenText && now - lastSpokenTime < 3500) {
      return res.json({ ok: true, skippedDuplicate: true });
    }
    lastSpokenText = cleanText;
    lastSpokenTime = now;
  }

  try {
    stopAllHostAudioNow();
    const mySession = hostSpeechSessionId;

    const mp3Buffer = await generateStudioHostMp3(cleanText, voice);
    if (!mp3Buffer || (!returnAudio && mySession !== hostSpeechSessionId)) {
      return res.json({ ok: false, cancelled: true });
    }

    // Tarayıcı üzerinden anında senkron çalma modu
    if (returnAudio) {
      return res.json({
        ok: true,
        spoken: cleanText,
        audioBase64: mp3Buffer.toString('base64'),
      });
    }

    const outPath = path.join(os.tmpdir(), `sorduk_host_${Date.now()}_${mySession}.mp3`);
    fs.writeFileSync(outPath, mp3Buffer);

    await new Promise((resolve) => {
      if (mySession !== hostSpeechSessionId) {
        try {
          if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        } catch (_) {}
        return resolve();
      }
      const proc = spawn('afplay', [outPath], { stdio: 'ignore' });
      currentHostAudioProc = proc;
      proc.on('close', () => {
        if (currentHostAudioProc === proc) {
          currentHostAudioProc = null;
        }
        try {
          if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        } catch (_) {}
        resolve();
      });
      proc.on('error', () => {
        try {
          if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        } catch (_) {}
        resolve();
      });
    });

    return res.json({ ok: true, spoken: cleanText, finished: true });
  } catch (err) {
    console.error('Sorduk Host TTS Hatası:', err?.message);
    return res.json({ ok: false });
  }
});

app.post('/api/sorduk/stop-speak', (req, res) => {
  stopAllHostAudioNow();
  res.json({ ok: true });
});

// GERÇEK MİKROFONDAN TÜRKÇE KONUŞMA ALGILAMA (Yüksek Ses Kazançlı MacBook Pro Mikrofonu -> WAV -> Google TR STT)
let isMicRecordingNow = false;

app.post('/api/sorduk/listen', async (req, res) => {
  if (isMicRecordingNow) {
    return res.json({ ok: false, busy: true, transcript: '' });
  }
  stopAllHostAudioNow();

  isMicRecordingNow = true;
  const wavPath = path.join(os.tmpdir(), `sorduk_mic_${Date.now()}.wav`);
  const ffBin =
    ffmpegStatic && fs.existsSync(ffmpegStatic)
      ? ffmpegStatic
      : '/Users/yasineren/Desktop/wp-asistan-bot/node_modules/ffmpeg-static/ffmpeg';

  try {
    // 5.5x ses yükseltme ve gürültü filtresi ile 3.2 saniye canlı mikrofon kaydı
    execFileSync(
      ffBin,
      [
        '-y',
        '-f',
        'avfoundation',
        '-i',
        ':0',
        '-t',
        '3.2',
        '-af',
        'highpass=f=80,lowpass=f=7500,volume=5.5',
        '-ar',
        '16000',
        '-ac',
        '1',
        wavPath,
      ],
      { stdio: 'ignore', timeout: 7000 }
    );
    const pyScript = [
      'import speech_recognition as sr, json, sys',
      'wav_file = sys.argv[1]',
      'r = sr.Recognizer()',
      'r.dynamic_energy_threshold = False',
      'r.energy_threshold = 50',
      'with sr.AudioFile(wav_file) as s:',
      '    audio = r.record(s)',
      'try:',
      "    res = r.recognize_google(audio, language='tr-TR', show_all=True)",
      "    text = ''",
      '    alts = []',
      "    if isinstance(res, dict) and 'alternative' in res and len(res['alternative']) > 0:",
      "        text = res['alternative'][0].get('transcript', '')",
      "        alts = [a.get('transcript', '') for a in res['alternative'] if a.get('transcript')]",
      '    elif isinstance(res, str):',
      '        text = res',
      "    print(json.dumps({'ok': bool(text), 'transcript': text, 'alternatives': alts}))",
      'except Exception as e:',
      "    print(json.dumps({'ok': False, 'transcript': '', 'alternatives': []}))",
    ].join('\n');

    const rawOut = execFileSync('python3', ['-c', pyScript, wavPath], {
      encoding: 'utf8',
      timeout: 8000,
    }).trim();
    try {
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (_) {}
    isMicRecordingNow = false;
    const parsed = JSON.parse(rawOut);
    console.log('🎙️ Sorduk Mikrofon Algıladı:', parsed);
    return res.json(parsed);
  } catch (err) {
    console.error('🎙️ Sorduk Mikrofon Hatası:', err?.message);
    isMicRecordingNow = false;
    try {
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (_) {}
    return res.json({ ok: false, transcript: '', alternatives: [] });
  }
});

app.get('/api/sorduk/tts', async (req, res) => {
  try {
    const text = String(req.query.text || '').trim();
    const voice = String(req.query.voice || 'tr-TR-AhmetNeural').trim();
    if (!text) return res.status(400).end();
    const mp3Buffer = await generateStudioHostMp3(text, voice);
    if (!mp3Buffer) return res.status(500).end();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(mp3Buffer);
  } catch (err) {
    res.status(500).end();
  }
});

// ============================================================================
// EREN PATRON - WINDOWS PC CANLI UZAKTAN BAGLANTI KÖPRÜSÜ (/api/pc-agent)
// ============================================================================
const pcAgentState = {
  connected: false,
  lastSeenAt: 0,
  hostname: '',
  osCaption: '',
  lastOutput: '',
  pendingCommand: null, // { id, cmd }
  history: [],
};

app.post('/api/pc-agent/poll', (req, res) => {
  pcAgentState.connected = true;
  pcAgentState.lastSeenAt = Date.now();
  if (req.body?.hostname) pcAgentState.hostname = String(req.body.hostname);
  if (req.body?.osCaption) pcAgentState.osCaption = String(req.body.osCaption);
  if (req.body?.output !== undefined && req.body?.cmdId) {
    pcAgentState.lastOutput = String(req.body.output || '');
    pcAgentState.history.unshift({
      id: req.body.cmdId,
      output: pcAgentState.lastOutput,
      at: new Date().toISOString(),
    });
    if (pcAgentState.history.length > 25) pcAgentState.history.length = 25;
    if (pcAgentState.pendingCommand && pcAgentState.pendingCommand.id === req.body.cmdId) {
      pcAgentState.pendingCommand = null;
    }
  }
  return res.json({
    ok: true,
    command: pcAgentState.pendingCommand,
  });
});

app.get('/api/pc-agent/status', (_req, res) => {
  return res.json({
    ok: true,
    ...pcAgentState,
    online: pcAgentState.lastSeenAt > 0 && Date.now() - pcAgentState.lastSeenAt < 15000,
  });
});

app.post('/api/pc-agent/exec', (req, res) => {
  const cmd = String(req.body?.cmd || '').trim();
  if (!cmd) return res.status(400).json({ ok: false, error: 'cmd required' });
  const id = 'cmd_' + Date.now();
  pcAgentState.pendingCommand = { id, cmd };
  return res.json({ ok: true, id, cmd });
});

export const opaiApp = app;

export function startOpaiBackgroundSessions() {
  setTimeout(() => {
    for (const userId of Object.keys(db.users || {})) {
      try {
        const credsFile = path.join(SESSIONS_DIR, userId, 'creds.json');
        if (!fs.existsSync(credsFile)) continue;
        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
        if (!creds?.registered && !creds?.me) continue;
        console.log(`🔄 WhatsApp oturumu geri bağlanıyor: ${userId}`);
        startUserWhatsAppSession(userId, { mode: 'qr' }).catch((e) =>
          console.error('Oturum geri yükleme hatası:', userId, e.message)
        );
      } catch (e) {
        console.error('Oturum kontrol hatası:', userId, e.message);
      }
      try {
        const u = db.users[userId];
        if (u?.channels?.instagram?.serializedState) {
          startInstagramDirectWorker(u).catch(() => {});
        }
      } catch (_) {}
    }
  }, 1500);

  // Yerel sunucu çalışırken bulut sunucudaki bekleyen e-postaları 1.5 saniyede bir çekip gerçek Gmail SMTP ile anında gönder
  if (!process.env.OPAI_EMBEDDED && !process.env.RENDER_EXTERNAL_URL) {
    const cloudBase = 'https://avelon-wp-botavelon-wp-bot.onrender.com';
    let relaying = false;
    const relayedIds = new Set();
    setInterval(async () => {
      if (relaying) return;
      relaying = true;
      try {
        const res = await fetch(`${cloudBase}/api/auth/outbox-emails`);
        if (res.ok) {
          const data = await res.json();
          for (const item of data.emails || []) {
            if (relayedIds.has(item.id)) continue;
            relayedIds.add(item.id);
            console.log(`📧 [SMTP RELAY] Buluttan doğrulama e-postası gönderiliyor -> ${item.to} (Kod: ${item.code})`);
            const ok = await sendSmtpEmail({
              to: item.to,
              subject: item.subject,
              bodyText: item.bodyText,
            });
            if (ok) {
              console.log(`✅ [SMTP RELAY] Başarıyla gönderildi -> ${item.to}`);
              await fetch(`${cloudBase}/api/auth/outbox-emails/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id }),
              });
            } else {
              relayedIds.delete(item.id);
            }
          }
        }
      } catch (_) {
      } finally {
        relaying = false;
      }
    }, 1500);

    let igRelaying = false;
    const relayedIgIds = new Set();
    setInterval(async () => {
      if (igRelaying) return;
      igRelaying = true;
      try {
        const res = await fetch(`${cloudBase}/api/instagram/outbox-jobs`);
        if (res.ok) {
          const data = await res.json();
          for (const job of data.jobs || []) {
            if (relayedIgIds.has(job.id)) continue;
            relayedIgIds.add(job.id);
            const targetUser = (job.userId && db.users[job.userId]) || db.users['u_905525222988'] || Object.values(db.users)[0];
            console.log(`📸 [IG RELAY] Buluttan Instagram işlemi alındı -> ${job.type}`);
            let result = null;
            if (job.type === 'verify_code') {
              result = await executeLocalInstagramVerifyCode(targetUser, job.payload?.code);
            } else {
              result = await executeLocalInstagramLogin(targetUser, job.payload || {});
            }
            await fetch(`${cloudBase}/api/instagram/outbox-jobs/complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: job.id, result }),
            });
          }
        }
      } catch (_) {
      } finally {
        igRelaying = false;
      }
    }, 1200);
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMainModule && !process.env.OPAI_EMBEDDED) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 OP AI & 100 Kişiye Sorduk Production Sunucusu 0.0.0.0:${PORT} üzerinde çalışıyor: http://localhost:${PORT}`);
    startOpaiBackgroundSessions();
  });
}
