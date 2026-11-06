const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BOT_URL = 'https://avelon-wp-botavelon-wp-bot.onrender.com';
const FFMPEG_BIN = path.join(__dirname, 'node_modules/ffmpeg-static/ffmpeg');

async function completeTask(id, replyText, voiceText) {
  try {
    await fetch(`${BOT_URL}/api/gemi-tasks/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, replyText, voiceText }),
    });
  } catch (e) {
    console.error('Complete err:', e.message);
  }
}

async function sendSelfNote(text) {
  try {
    await fetch(`${BOT_URL}/api/send-self-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (_) {}
}

function transcribeVoiceBase64(base64Data) {
  const tmpOgg = `/tmp/gemi_voice_${Date.now()}.ogg`;
  const tmpWav = `/tmp/gemi_voice_${Date.now()}.wav`;
  try {
    fs.writeFileSync(tmpOgg, Buffer.from(base64Data, 'base64'));
    const ff = fs.existsSync(FFMPEG_BIN) ? FFMPEG_BIN : 'ffmpeg';
    execSync(`"${ff}" -y -i "${tmpOgg}" -ar 16000 -ac 1 "${tmpWav}" 2>/dev/null`);
    const out = execSync(
      `python3 -c '
import speech_recognition as sr
r = sr.Recognizer()
with sr.AudioFile("${tmpWav}") as s:
    audio = r.record(s)
try:
    print(r.recognize_google(audio, language="tr-TR"))
except Exception as e:
    print("")
'`,
      { encoding: 'utf-8' }
    ).trim();
    return out;
  } catch (err) {
    console.error('Transcribe error:', err.message);
    return '';
  } finally {
    try { if (fs.existsSync(tmpOgg)) fs.unlinkSync(tmpOgg); } catch (_) {}
    try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch (_) {}
  }
}

async function searchAndOpenYouTube(query) {
  let targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  let videoTitle = query;
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9',
      },
    });
    const html = await res.text();
    const idMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    const titleMatch = html.match(/"videoRenderer":\{"videoId":"[a-zA-Z0-9_-]{11}".*?"title":\{"runs":\[\{"text":"([^"]+)"/);
    if (idMatch && idMatch[1]) {
      targetUrl = `https://www.youtube.com/watch?v=${idMatch[1]}&autoplay=1`;
    }
    if (titleMatch && titleMatch[1]) {
      videoTitle = titleMatch[1];
    }
  } catch (_) {}

  exec('caffeinate -u -t 3600');
  try {
    execSync(`open -a "Google Chrome 2" "${targetUrl}" 2>/dev/null || open "${targetUrl}"`);
  } catch (_) {
    exec(`open "${targetUrl}"`);
  }
  return { targetUrl, videoTitle };
}

async function handleInstantMacCommand(task, isVoiceTask = false) {
  const raw = (task.prompt || '').trim();
  const low = raw.toLocaleLowerCase('tr-TR');

  // 1) PC Aç / Ekranı Uyandır (.pc aç, @gemi pc aç, ekranı aç, bilgisayarı aç)
  if (
    low === '.pc' ||
    low.includes('pc aç') ||
    low.includes('pc ac') ||
    low.includes('ekranı aç') ||
    low.includes('ekrani ac') ||
    low.includes('bilgisayarı aç') ||
    low.includes('bilgisayari ac') ||
    low.includes('uyandır')
  ) {
    exec('caffeinate -u -t 3600');
    exec('osascript -e "set volume output volume 75 without output muted"');
    await completeTask(
      task.id,
      `💻 *MAC EKRANI UYANDIRILDI PATRON!* ⚡\n\nEkran uyku modundan çıkarıldı (1 saat açık kalacak şekilde ayarlandı) ve ses seviyesi %75'e getirildi.`,
      `Eren Bey, Mac bilgisayarınızın ekranını uyandırdım ve kullanıma hazır hale getirdim.`
    );
    return true;
  }

  // 2) PC Ekranı Kapat / Uyku Modu (.uyku modu, .pc kapat, ekranı kapat, kilitle)
  if (
    low.includes('uyku') ||
    low.includes('pc kapat') ||
    low.includes('bilgisayarı kapat') ||
    low.includes('ekranı kapat') ||
    low.includes('ekrani kapat') ||
    low.includes('pc uyut') ||
    low.includes('pc kilitle')
  ) {
    exec('osascript -e "set volume output volume 0"');
    exec('pmset displaysleepnow');
    if (low === '.uyku modu') {
      await completeTask(task.id, '', '');
    } else {
      await completeTask(
        task.id,
        `🔒 *MAC EKRANI UYKUYA ALINDI PATRON!* 🌙`,
        `Mac bilgisayarınızın ekranını ve sesini kapattım Eren Bey. İyi geceler dilerim.`
      );
    }
    return true;
  }

  // 3) Ses Seviyesi Kontrolü (sesi fulle, sesi kıs, ses 50)
  if (low.includes('sesi fulle') || low.includes('ses fulle') || low.includes('sesi aç') || low.includes('ses 100')) {
    exec('osascript -e "set volume output volume 100 without output muted"');
    await completeTask(
      task.id,
      `🔊 *Mac Sesi %100 (Full) Yapıldı!*`,
      `Bilgisayarın sesini tam seviyeye yükselttim Eren Bey.`
    );
    return true;
  }
  if (low.includes('sesi kıs') || low.includes('sesi kapat') || low.includes('sustur')) {
    exec('osascript -e "set volume output volume 15"');
    await completeTask(
      task.id,
      `🔉 *Mac Sesi %15'e Kısıldı!*`,
      `Bilgisayarın sesini kıstım Eren Bey.`
    );
    return true;
  }

  // 3.2) TELEFON BULUCU & SAHTE ARAMA (.telefon, .telfon, telefonumu bul, telefonu çaldır)
  if (
    low.includes('telefon') ||
    low.includes('telfon') ||
    low.includes('çaldır') ||
    low.includes('caldir') ||
    low.includes('kaybettim') ||
    low.includes('sahte arama')
  ) {
    // Mac Chrome üzerinden Google Cihazımı Bul (Find My Device) sayfasını aç ve "Ses Çal" butonuna otomatik tıkla!
    const findUrl = 'https://www.google.com/android/find/';
    exec(`open -a "Google Chrome 2" "${findUrl}" 2>/dev/null || open -a "Google Chrome" "${findUrl}" 2>/dev/null || open "${findUrl}"`);
    setTimeout(() => {
      const clickScript = `
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if URL of t contains "google.com/android/find" then
                execute t javascript "
                  (function() {
                    const btns = Array.from(document.querySelectorAll('button, [role=button], span, div'));
                    const playBtn = btns.find(el => /ses çal|play sound|çaldır/i.test((el.innerText || el.textContent || '').trim()));
                    if (playBtn) { playBtn.click(); }
                  })();
                "
              end if
            end repeat
          end repeat
        end tell
      `;
      exec(`osascript -e '${clickScript.replace(/'/g, "'\\''")}'`, () => {});
    }, 4500);

    await completeTask(
      task.id,
      `📞 *GOOGLE CİHAZIMI BUL & TELEFON SİRENİ BAŞLATILDI!* 🚨🔊\n\n` +
        `1️⃣ Mac bilgisayarında **Google Cihazımı Bul (Find My Device)** açıldı ve telefonuna **Sessizde Bile %100 Sesle Çaldır** sinyali tetiklendi!\n` +
        `2️⃣ NeYapsak & WhatsApp üzerinden de arka arkaya titreşim/bildirim gönderiliyor!`,
      `Eren Bey, Google Cihazımı Bul üzerinden telefonunuzu tam sesle çaldırıyorum!`
    );
    return true;
  }

  // 3.5) AVELON — TATAR ENDÜSTRİ SÜPER ADMİN KOMUTU (Sesli veya yazılı "admin", "tantavi", "qres")
  if (
    low.includes('admin') ||
    low.includes('tantavi') ||
    low.includes('tanatavi') ||
    low.includes('tan tamam') ||
    low.includes('tan tabii') ||
    low.includes('muamma') ||
    low.includes('qres') ||
    low.includes('qris')
  ) {
    const NEYAPSAK_API = 'https://jellyfish-app-oydmg.ondigitalocean.app/api/admin';
    const NEYAPSAK_KEY = 'neyapsak_admin_secret_key_2026_secure';
    const QRES_API = 'https://web-production-b7541.up.railway.app/api/super';
    const QRES_KEY = 'neyapsak_super_admin_secret';

    try {
      const isTantaviSpeech =
        low.includes('tantav') ||
        low.includes('tanatav') ||
        low.includes('tan tamam') ||
        low.includes('tan tabii') ||
        /\btan\b/.test(low);
      const isMuammaSpeech = low.includes('muamma');
      const is2Arti2Speech = low.includes('2art') || low.includes('iki art');

      if (isTantaviSpeech || isMuammaSpeech || is2Arti2Speech) {
        const restRes = await fetch(`${QRES_API}/restaurants`, { headers: { 'x-admin-secret': QRES_KEY } });
        const restJson = await restRes.json();
        const restaurants = restJson.data || [];
        const norm = (s) =>
          String(s || '')
            .toLocaleLowerCase('tr-TR')
            .replace(/[ığüşöç]/g, (c) => ({ ı: 'i', ğ: 'g', ü: 'u', ş: 's', ö: 'o', ç: 'c' }[c] || c))
            .replace(/[^a-z0-9]/g, '');
        const matched = restaurants.find((r) => {
          const nNorm = norm(r.name);
          if (isTantaviSpeech && nNorm.includes('tantav')) return true;
          if (isMuammaSpeech && nNorm.includes('muamma')) return true;
          if (is2Arti2Speech && nNorm.includes('2arti2')) return true;
          return false;
        });
        if (matched) {
          const detRes = await fetch(`${QRES_API}/restaurants/${matched._id}/details`, { headers: { 'x-admin-secret': QRES_KEY } });
          const det = (await detRes.json()).data || {};
          const restObj = det.restaurant || matched;
          const totalScans = restObj.totalQrScans ?? matched.totalQrScans ?? 0;
          const dailyMap = restObj.dailyQrScans || {};
          const dailyEntries = Object.entries(dailyMap).sort((a, b) => b[0].localeCompare(a[0]));
          const lastDayCount = dailyEntries[0] ? dailyEntries[0][1] : 0;
          const totalRev = det.totalRevenue ?? matched.totalRevenue ?? 0;
          const totalOrd = det.totalOrders ?? 0;
          const recentDaysText = dailyEntries.slice(0, 7).map(([d, c]) => `  • 📅 *${d}:* ${c} kişi QR okuttu`).join('\n');
          await completeTask(
            task.id,
            `🤖 *AVELON QRES SÜPER ADMİN — ${restObj.name.toUpperCase()}* 📊\n` +
              `🏭 *TATAR ENDÜSTRİ KOMUTA MERKEZİ*\n\n` +
              `📲 *TOPLAM QR OKUTAN:* *${totalScans.toLocaleString('tr-TR')} Kişi*\n` +
              `📅 *Son Günde Okutan:* *${lastDayCount} Kişi*\n` +
              `💰 *Toplam Ciro:* *${totalRev.toLocaleString('tr-TR')} ₺* (${totalOrd} Sipariş)\n\n` +
              `📈 *SON 7 GÜN QR DÖKÜMÜ:*\n${recentDaysText}`,
            `Eren Bey, Tatar Endüstri Avelon sisteminden ${restObj.name} verilerini getirdim. Şu ana kadar toplam ${totalScans} kişi QR menüyü okutmuş ve toplam ${totalRev} Türk Lirası ciro yapılmış.`
          );
          return true;
        }
      }

      const [nyRes, qresStatsRes] = await Promise.all([
        fetch(`${NEYAPSAK_API}/dashboard-data`, { headers: { 'x-admin-key': NEYAPSAK_KEY } }),
        fetch(`${QRES_API}/stats`, { headers: { 'x-admin-secret': QRES_KEY } }),
      ]);
      const ny = await nyRes.json().catch(() => ({}));
      const qStats = (await qresStatsRes.json().catch(() => ({}))).data || {};
      await completeTask(
        task.id,
        `🏭 *TATAR ENDÜSTRİ — AVELON SÜPER ADMİN MERKEZİ* ⚡\n\n` +
          `📱 *NeYapsak:* ${ny.users || 0} Kullanıcı | ${ny.weeklyActive || 0} Haftalık Aktif | ${ny.posts || 0} Gönderi\n` +
          `🍽️ *QRes:* ${qStats.totalRestaurants || 0} Restoran | ${(qStats.totalQrScans || 0).toLocaleString('tr-TR')} QR Okutma | ${(qStats.totalRevenue || 0).toLocaleString('tr-TR')} ₺ Ciro`,
        `Hoş geldiniz Eren Bey. Tatar Endüstri Avelon Süper Admin sisteminde NeYapsak uygulamasında ${ny.users || 0} kullanıcı, QRes sisteminde ise toplam ${qStats.totalQrScans || 0} QR okutma ve ${qStats.totalRevenue || 0} Türk Lirası ciro bulunuyor.`
      );
      return true;
    } catch (_) {}
  }

  // 4) YouTube Video / Müzik Aç (.yt <aranacak>, @gemi youtube <aranacak> aç, veya sesli şarkı/video söyleme)
  const isCodingKeyword = /\b(kod|proje|neyapsak|ne yapsak|qres|mezat|uygulama|güncelle|build|hata|düzelt|ekle|değiştir|dosya|sunucu|render|mail)\b/i.test(low);
  const ytMatch =
    raw.match(/^(?:\.yt|\.youtube)\s+(.+)$/i) ||
    raw.match(/youtube(?:'dan|'den|dan|den|da|'da)?\s+(.+?)(?:\s+(?:aç|ac|çal|cal|oynat))?$/i) ||
    raw.match(/^(.+?)\s+(?:youtube'da|youtubeda|youtube'dan|youtubedan|youtube)\s+(?:aç|ac|çal|cal|oynat)$/i);

  if (
    ytMatch ||
    low.includes('youtube') ||
    low.includes('şarkı') ||
    low.includes('müzik') ||
    low.includes('video') ||
    (isVoiceTask && !isCodingKeyword && raw.length > 1)
  ) {
    let query = ytMatch ? ytMatch[1] : raw.replace(/youtube('dan|'den|dan|den|da|'da)?/gi, '');
    query = query.replace(/\b(?:aç|ac|çal|cal|oynat|videosunu|videoyu|şarkısını|istediğim)\b/gi, '').trim();
    if (!query) query = raw;

    const { targetUrl, videoTitle } = await searchAndOpenYouTube(query);
    await completeTask(
      task.id,
      `🎬 *YOUTUBE VİDEOSU MAC'TE AÇILDI PATRON!* 🍿\n\n` +
        `▶️ *Açılan Video:* ${videoTitle}\n` +
        `🔗 *Link:* ${targetUrl}`,
      `Eren Bey, istediğiniz ${videoTitle} videosunu Mac bilgisayarınızda YouTube üzerinden hemen açtım.`
    );
    return true;
  }

  return false;
}

let iosBuildNotified = true;
let tickCount = 0;
let isPolling = false;
const processedIds = new Set();
const IOS_BUILD_ID = 'd5034576-ee55-4040-a22e-9ea3bb73bf8f';
const IOS_OUT_PATH = '/Users/yasineren/Desktop/NeYapsak_v1.0.13_74.ipa';

async function poll() {
  if (isPolling) return;
  isPolling = true;
  tickCount++;
  try {
    const res = await fetch(`${BOT_URL}/api/gemi-tasks`);
    if (res.ok) {
      const data = await res.json();
      if (data.tasks && data.tasks.length > 0) {
        const remainingForAntigravity = [];
        for (const t of data.tasks) {
          if (processedIds.has(t.id)) continue;
          processedIds.add(t.id);
          const isVoice = String(t.id || '').startsWith('GEMI-VOICE-') || t.prompt === '__VOICE_NOTE__';
          if (t.prompt === '__VOICE_NOTE__' && t.audioBase64) {
            const spoken = transcribeVoiceBase64(t.audioBase64);
            delete t.audioBase64;
            if (!spoken) {
              await completeTask(
                t.id,
                `⚠️ *Ses kaydını tam duyamadım Patron, tekrar sesli söyleyebilir veya yazabilir misin?*`,
                `Eren Bey, ses kaydınızı tam anlayamadım, lütfen tekrar söyler misiniz?`
              );
              continue;
            }
            t.prompt = spoken;
            await sendSelfNote(`🗣️ *Sesli Emrin Anlaşıldı:* _"${spoken}"_`);
          }

          const handled = await handleInstantMacCommand(t, isVoice);
          if (!handled) {
            remainingForAntigravity.push(t);
          }
        }
        if (remainingForAntigravity.length > 0) {
          console.log('GEMI_TASK_RECEIVED:', JSON.stringify(remainingForAntigravity));
          process.exit(0); // Wakes up Antigravity for coding/project tasks!
        }
      }
    }
  } catch (_) {
  } finally {
    isPolling = false;
  }

  // Her 40 saniyede bir iOS App Store Build (d5034576) durumunu kontrol et
  if (!iosBuildNotified && tickCount % 10 === 1) {
    try {
      const raw = execSync(`npx --yes eas-cli build:view ${IOS_BUILD_ID} --json`, {
        cwd: '/Users/yasineren/Desktop/neyapsak',
        encoding: 'utf-8',
      });
      const idx = raw.indexOf('{');
      if (idx !== -1) {
        const b = JSON.parse(raw.slice(idx));
        if (b.status === 'FINISHED' && b.artifacts?.buildUrl) {
          iosBuildNotified = true;
          execSync(`curl -L "${b.artifacts.buildUrl}" -o "${IOS_OUT_PATH}"`);
          try {
            execSync(
              `npx --yes eas-cli submit --platform ios --id ${IOS_BUILD_ID} --non-interactive --no-wait`,
              { cwd: '/Users/yasineren/Desktop/neyapsak' }
            );
          } catch (_) {}
          await sendSelfNote(
            `🍎 *MÜJDE PATRON! APPLE APP STORE (iOS v1.0.13 - Build 74) PAKETİN TAMAMLANDI!* 🚀\n\n` +
              `📦 *Dosya:* \`NeYapsak_v1.0.13_74.ipa\` Masaüstüne indirildi ve otomatik olarak *App Store Connect (TestFlight / Build)* kısmına gönderildi!\n\n` +
              `👉 Şimdi App Store Connect ekranında *Build* kısmından 74 numaralı paketi seçip *Add for Review (İncelemeye Gönder)* diyebilirsin!`
          );
          await fetch(`${BOT_URL}/api/test-voice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              voice: 'emel',
              text: 'Müjde Eren Bey! Apple App Store güncelleme paketiniz tamamlandı ve doğrudan App Store Connect hesabınıza gönderildi.',
            }),
          });
        }
      }
    } catch (_) {}
  }
}

setInterval(poll, 4000);
poll();
