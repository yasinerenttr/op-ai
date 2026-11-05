import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import express from 'express';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Patron Eren'in kendi "Siz" (905525222988) sohbetine anlık sekreter raporu gönderen fonksiyon
async function notifyOwnerSelfChat(reportText) {
  try {
    if (!sock || connectionStatus !== 'connected') return;
    const selfJid = '905525222988@s.whatsapp.net';
    const sent = await sock.sendMessage(selfJid, { text: reportText });
    if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
  } catch (err) {
    console.error('Owner self-chat bildirim hatası:', err.message);
  }
}

// Türkçe Yapay Zeka Sekreter Sesli Mesajı (🎤 Mavi Mikrofon / PTT) Üretip Gönderen Fonksiyon
async function sendVoiceNote(targetJid, spokenText) {
  if (!sock || !spokenText) return null;
  try {
    await sock.sendPresenceUpdate('recording', targetJid);
    // Metni doğal cümle parçalarına böl (Google TTS 180 karakter sınırı için)
    const cleanSpeech = spokenText
      .replace(/[*_~`#]/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

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

    if (mp3Buffers.length === 0) {
      await sock.sendPresenceUpdate('paused', targetJid);
      return null;
    }

    const fullMp3 = Buffer.concat(mp3Buffers);
    let finalAudio = fullMp3;
    let finalMime = 'audio/mp4';

    // Sistemde ffmpeg varsa gerçek OGG Opus WhatsApp Sesli Notuna çevir
    const tmpIn = path.join('/tmp', `avl_tts_${Date.now()}.mp3`);
    const tmpOut = path.join('/tmp', `avl_tts_${Date.now()}.ogg`);
    try {
      fs.writeFileSync(tmpIn, fullMp3);
      execSync(
        `ffmpeg -y -i "${tmpIn}" -c:a libopus -b:a 32k -vbr on -compression_level 10 -application voip "${tmpOut}" 2>/dev/null`
      );
      if (fs.existsSync(tmpOut)) {
        finalAudio = fs.readFileSync(tmpOut);
        finalMime = 'audio/ogg; codecs=opus';
      }
    } catch (_) {
      // ffmpeg yoksa MP3/MP4 olarak gönder
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
    console.log(`🎙️ Sesli Sekreter Mesajı Gönderildi -> ${targetJid}`);
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

  return { cleanPhone, questionText };
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

  sock.ev.on('messaging-history.set', ({ contacts }) => {
    syncAuthInfoContactsAndLids();
    let changed = false;
    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        const idNum = cleanNumber(c?.id || '');
        const lidNum = cleanNumber(c?.lid || '');
        const phoneNum = cleanNumber(c?.phoneNumber || '');
        const savedContactName = c?.name;
        if (lidNum && phoneNum) {
          lidToPhone[lidNum] = phoneNum;
          phoneToLid[phoneNum] = lidNum;
        }
        if (savedContactName && !savedContactName.startsWith('@')) {
          for (const k of [idNum, lidNum, phoneNum]) {
            if (k && !c?.id?.endsWith('@g.us')) {
              stateData.knownNumbers[k] = {
                name: savedContactName,
                source: 'Rehber',
                addedAt: new Date().toISOString(),
                lastAutoReplyAt: stateData.knownNumbers[k]?.lastAutoReplyAt || 0,
              };
              changed = true;
            }
          }
        }
      }
    }
    if (changed) saveData();
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
        const extractedText = extractMessageText(msg.message);
        const isSelfChat =
          (connectedUser?.id && (canonicalKey === connectedUser.id || rawNum === connectedUser.id)) ||
          canonicalKey === '905525222988' ||
          rawNum === '73560022323225';

        // 2) PATRON EREN'İN KENDİ "SİZ" SOHBETİ KOMUTA MERKEZİ VEYA KENDİ ATTIĞI MESAJLAR:
        if (msg.key?.fromMe || isSelfChat) {
          if (msgId && botSentMsgIds.has(msgId)) continue;
          if (!extractedText) continue;

          const trimmedRaw = extractedText.trim();
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

          // B) Patron Eren'in "Siz" sohbetinden (veya "." ile başlayan) Özel Kalem Komutları:
          if (
            isSelfChat ||
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
            myText.startsWith('.hatirlat ') ||
            myText.startsWith('.hatırlat ')
          ) {
            // 1. ".ara 0532xxxxxxx Yarın için müsait misiniz?" veya doğal dille "0532xxxxxxx ara yarın için müsait misiniz"
            const callMatch =
              trimmedRaw.match(/^(?:\.ara|\.sesli|\.sekreter|ara|sesli)\s+(\+?\d[\d\s]{8,15})\s*(.*)$/i) ||
              trimmedRaw.match(/^(\+?\d[\d\s]{9,15})\s+(?:ara|sor|yaz|de\s*ki)\s*(.*)$/i);

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

            // 4. ".mod toplanti" | ".mod btm" | ".mod uyku" | ".mod normal"
            if (myText.startsWith('.mod ')) {
              const modeArg = myText.replace('.mod ', '').trim();
              stateData.currentMode = modeArg;
              if (modeArg === 'btm' || modeArg === 'toplanti' || modeArg === 'toplantı') {
                stateData.knownReplyText =
                  "Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim. Eren Bey şu anda BTM yerleşkesinde girişimcilik ve yatırım toplantısında olduğu için telefonuna bakamamaktadır. Mesajınızı kendisine ilettim, toplantı bitiminde size dönüş yapacaktır.";
              } else if (modeArg === 'uyku' || modeArg === 'gece') {
                stateData.knownReplyText =
                  "Merhabalar, ben Avelon 🤖 Eren Bey'in Yapay Zeka Yönetici Sekreteriyim. Eren Bey şu anda istirahatte olduğu için mesajınızı sabah brifing listesine ekledim; uyandığında ilk iş size dönüş sağlayacaktır.";
              } else {
                stateData.knownReplyText = defaultData.knownReplyText;
              }
              saveData();
              await notifyOwnerSelfChat(`🎛️ *Avelon Modu Değiştirildi:* *${modeArg.toUpperCase()}*\nYeni otomatik yanıt:\n"${stateData.knownReplyText}"`);
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
          }

          if (isSelfChat) continue;

          // Eren başka birinin sohbetine bizzat kendisi yazdıysa sadece 15 saniye boyunca Avelon araya girmesin
          if (extractedText) {
            ownerActiveChats[canonicalKey] = Date.now();
            ownerActiveChats[rawNum] = Date.now();
          }
          continue;
        }

        if (!stateData.enabled) continue;

        // Eren son 15 saniye içinde bu kişiye bizzat mesaj yazdıysa Avelon o anlık araya girmesin
        if (
          (ownerActiveChats[canonicalKey] && Date.now() - ownerActiveChats[canonicalKey] < 15 * 1000) ||
          (ownerActiveChats[rawNum] && Date.now() - ownerActiveChats[rawNum] < 15 * 1000)
        ) {
          console.log(`⏸️ Eren bu sohbete son 15 sn içinde bizzat yazdığı için Avelon araya girmedi (+${canonicalKey}).`);
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

          if (msg.pushName && (!entry.name || entry.name.startsWith('Aktif Rehber') || entry.name.startsWith('Rehber'))) {
            entry.name = msg.pushName;
          }

          const lastReply = entry.lastAutoReplyAt || 0;
          const cooldownMs = Math.max(1, Number(stateData.knownCooldownMinutes) || 3) * 60 * 1000;

          if (Date.now() - lastReply < cooldownMs) {
            console.log(`⏳ Kayıtlı kişi (${entry.name}) bekleme süresinde olduğu için tekrar yazılmadı.`);
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

  // Gelen WhatsApp Sesli / Görüntülü Aramalarını Dinle ve SESLİ SEKRETER (🎤) + Yazılı Yanıt Ver
  const recentCallReplies = {};
  sock.ev.on('call', async (calls) => {
    if (!stateData.enabled || !Array.isArray(calls)) return;

    for (const call of calls) {
      try {
        if (call.status !== 'offer' || call.isGroup) continue;
        const callerJid = call.from || call.chatId;
        if (!callerJid || callerJid.endsWith('@g.us')) continue;

        const rawNum = cleanNumber(callerJid);
        const canonicalKey = getCanonicalKey(rawNum);
        if (!canonicalKey) continue;
        if (connectedUser?.id && (canonicalKey === connectedUser.id || rawNum === connectedUser.id)) continue;

        // Aynı aramaya 2 dakika içinde tekrar tekrar mesaj atmasın
        if (recentCallReplies[canonicalKey] && Date.now() - recentCallReplies[canonicalKey] < 2 * 60 * 1000) {
          continue;
        }
        recentCallReplies[canonicalKey] = Date.now();

        const callTypeLabel = call.isVideo ? 'görüntülü aramanızı' : 'sesli aramanızı';

        if (isKnownPerson(rawNum) || isKnownPerson(canonicalKey)) {
          if (!stateData.replyToKnownContacts) continue;
          const entry = stateData.knownNumbers[canonicalKey] || stateData.knownNumbers[rawNum];
          const contactName = entry?.name || 'Rehber Kişisi';
          console.log(`📞 Kayıtlı kişiden (${contactName} - +${canonicalKey}) WhatsApp araması geldi, Avelon SESLİ yanıt gönderiyor...`);

          setTimeout(async () => {
            try {
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

              await notifyOwnerSelfChat(
                `📞 *CEVAPSIZ WHATSAPP ARAMASI (Avelon Sesli Açtı)* 🎙️\n\n` +
                `👤 *Arayan:* ${contactName} (+${canonicalKey})\n` +
                `📱 *Tür:* ${call.isVideo ? 'Görüntülü Arama' : 'Sesli Arama'}\n` +
                `🗣️ *Avelon'un Söylediği:* "Şu an Eren Bey müsait değil, müsait olunca sizi arayacak."`
              );
            } catch (e) {
              console.error('Arama yanıt hatası (kayıtlı):', e.message);
            }
          }, 3000);
        } else {
          console.log(`📞 Yabancı numaradan (+${canonicalKey}) WhatsApp araması geldi, Avelon SESLİ randevu yanıtı gönderiyor...`);
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

          setTimeout(async () => {
            try {
              const voiceCallStranger =
                `Merhabalar, ben Avelon, Yasin Eren Bey'in yapay zeka yönetici sekreteriyim. ` +
                `Şu an Eren Bey müsait değil, müsait olunca dönüş yapacaktır. Numaranız özel rehberde kayıtlı görünmüyor; lütfen kim olduğunuzu ve hangi konuda aradığınızı yazılı olarak iletin, size hemen randevu sırası oluşturayım.`;
              await sendVoiceNote(callerJid, voiceCallStranger);

              const sent = await sock.sendMessage(callerJid, {
                text: stateData.firstReplyText,
              });
              if (sent?.key?.id) botSentMsgIds.add(sent.key.id);

              await notifyOwnerSelfChat(
                `📞 *YABANCI NUMARADAN CEVAPSIZ ARAMA (Avelon Sesli Karşıladı)* 🎙️\n\n` +
                `📱 *Numara:* +${canonicalKey}\n` +
                `🗣️ *Avelon:* Sesli olarak "Eren Bey şu an müsait değil" dedi ve kimliğini/konusunu sordu.`
              );
            } catch (e) {
              console.error('Arama yanıt hatası (yabancı):', e.message);
            }
          }, 3000);
        }
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
  });
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
  const clean = cleanNumber(number || '');
  if (!clean) return res.status(400).json({ error: 'Geçersiz numara' });
  stateData.knownNumbers[clean] = {
    name: name || 'Manuel Eklendi',
    source: 'Manuel',
    addedAt: new Date().toISOString(),
    lastAutoReplyAt: 0,
  };
  delete stateData.strangerStages[clean];
  saveData();
  res.json({ ok: true });
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
    const { text } = req.body;
    if (!sock || connectionStatus !== 'connected') {
      return res.status(503).json({ error: 'WhatsApp bağlı değil' });
    }
    const selfJid = '905525222988@s.whatsapp.net';
    const sent = await sock.sendMessage(selfJid, { text });
    if (sent?.key?.id) botSentMsgIds.add(sent.key.id);
    console.log(`📬 Patron Eren (Siz) sohbetine önemli bildirim iletildi.`);
    res.json({ ok: true, id: sent?.key?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
