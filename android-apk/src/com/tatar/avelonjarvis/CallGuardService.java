package com.tatar.avelonjarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.ContactsContract;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.telecom.TelecomManager;
import android.telephony.PhoneStateListener;
import android.telephony.TelephonyManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class CallGuardService extends Service implements TextToSpeech.OnInitListener {
    private static final String CHANNEL_ID = "avelon_jarvis_guard";
    private static final String BOT_BASE = "https://avelon-wp-botavelon-wp-bot.onrender.com";

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private Handler mainHandler;
    private TelephonyManager telephonyManager;
    private PhoneStateListener phoneStateListener;
    private Set<String> announcedCallIds = new HashSet<>();
    private Set<String> executedDecisionCallIds = new HashSet<>();
    private long lastSimRingTime = 0;
    private String lastSimRingNumber = "";
    private int savedRingVolume = -1;
    private boolean pollRunning = false;

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(Looper.getMainLooper());
        tts = new TextToSpeech(this, this);
        startForegroundNotification();
        registerPhoneListener();
        startCloudCallPoller();
        syncContactsToCloudAsync();
    }

    private void startForegroundNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Avelon Jarvis Nöbet Servisi",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }

        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, openIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        Notification notification = builder
                .setContentTitle("⚡ Avelon Jarvis Nöbette")
                .setContentText("SIM & WhatsApp Gelen Arama Anonsu ve Sesli Aç/Kapat Aktif")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();

        startForeground(1453, notification);
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS && tts != null) {
            tts.setLanguage(new Locale("tr", "TR"));
            tts.setSpeechRate(1.02f);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                tts.setAudioAttributes(attrs);
            }
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {}

                @Override
                public void onDone(String utteranceId) {
                    restoreRingVolume();
                    if (utteranceId != null && utteranceId.startsWith("CALL_ASK_")) {
                        mainHandler.postDelayed(() -> listenForVoiceDecisionOnPhone(), 300);
                    }
                }

                @Override
                public void onError(String utteranceId) {
                    restoreRingVolume();
                }
            });
            ttsReady = true;
        }
    }

    private void registerPhoneListener() {
        try {
            telephonyManager = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
            if (telephonyManager != null) {
                phoneStateListener = new PhoneStateListener() {
                    @Override
                    public void onCallStateChanged(int state, String phoneNumber) {
                        if (state == TelephonyManager.CALL_STATE_RINGING) {
                            handleIncomingSimCall(phoneNumber);
                        } else if (state == TelephonyManager.CALL_STATE_IDLE || state == TelephonyManager.CALL_STATE_OFFHOOK) {
                            restoreRingVolume();
                        }
                    }
                };
                telephonyManager.listen(phoneStateListener, PhoneStateListener.LISTEN_CALL_STATE);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String callState = intent.getStringExtra("call_state");
            String incomingNum = intent.getStringExtra("incoming_number");
            if (TelephonyManager.EXTRA_STATE_RINGING.equals(callState)) {
                handleIncomingSimCall(incomingNum);
            } else if ("SYNC_CONTACTS".equals(intent.getStringExtra("cmd"))) {
                syncContactsToCloudAsync();
            }
        }
        return START_STICKY;
    }

    private synchronized void handleIncomingSimCall(String rawNumber) {
        long now = System.currentTimeMillis();
        String num = rawNumber != null ? rawNumber.trim() : "";
        if (now - lastSimRingTime < 3000 && (num.isEmpty() || num.equals(lastSimRingNumber))) {
            return;
        }
        if (now - lastSimRingTime < 8000 && !lastSimRingNumber.isEmpty() && num.isEmpty()) {
            return;
        }
        lastSimRingTime = now;
        if (!num.isEmpty()) lastSimRingNumber = num;

        String savedName = lookupContactName(num);
        final String displayCaller = (savedName != null && !savedName.isEmpty())
                ? savedName
                : (!num.isEmpty() ? num : "Bilinmeyen Numara");

        final String spoken = "Efendim, şu an " + displayCaller + " sizi arıyor. Açayım mı, yoksa sekreter olarak ben mi konuşayım?";
        speakOverRingtone(spoken, "CALL_ASK_" + now);

        new Thread(() -> {
            try {
                String urlStr = BOT_BASE + "/api/incoming-gsm-call?caller="
                        + URLEncoder.encode(num, "UTF-8")
                        + "&name=" + URLEncoder.encode(displayCaller, "UTF-8");
                HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception ignored) {}
        }).start();
    }

    private String lookupContactName(String phoneNumber) {
        if (phoneNumber == null || phoneNumber.trim().isEmpty()) return null;
        Cursor cursor = null;
        try {
            Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phoneNumber));
            cursor = getContentResolver().query(
                    uri,
                    new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME},
                    null, null, null
            );
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    private void speakOverRingtone(String text, String utteranceId) {
        if (!ttsReady || tts == null) return;
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                if (savedRingVolume == -1) {
                    savedRingVolume = am.getStreamVolume(AudioManager.STREAM_RING);
                }
                int maxRing = am.getStreamMaxVolume(AudioManager.STREAM_RING);
                am.setStreamVolume(AudioManager.STREAM_RING, Math.max(1, maxRing / 5), 0);

                int maxAlarm = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                am.setStreamVolume(AudioManager.STREAM_ALARM, maxAlarm, 0);
            }
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Bundle params = new Bundle();
            params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_ALARM);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
        } else {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null);
        }
    }

    private void restoreRingVolume() {
        try {
            if (savedRingVolume != -1) {
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.setStreamVolume(AudioManager.STREAM_RING, savedRingVolume, 0);
                }
                savedRingVolume = -1;
            }
        } catch (Exception ignored) {}
    }

    private void listenForVoiceDecisionOnPhone() {
        try {
            if (!SpeechRecognizer.isRecognitionAvailable(this)) return;
            SpeechRecognizer sr = SpeechRecognizer.createSpeechRecognizer(this);
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);

            sr.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onError(int error) {
                    try { sr.destroy(); } catch (Exception ignored) {}
                }
                @Override
                public void onResults(Bundle results) {
                    try {
                        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (matches != null && !matches.isEmpty()) {
                            String heard = matches.get(0).toLowerCase(new Locale("tr", "TR"));
                            if (heard.contains("kapat") || heard.contains("açma") || heard.contains("acma")
                                    || heard.contains("reddet") || heard.contains("meşgul") || heard.contains("sen konuş")
                                    || heard.contains("hayır")) {
                                executeRejectCall();
                            } else if (heard.contains("aç") || heard.contains("ac") || heard.contains("evet")
                                    || heard.contains("bağla") || heard.contains("tamam")) {
                                executeAcceptCall();
                            }
                        }
                    } catch (Exception ignored) {
                    } finally {
                        try { sr.destroy(); } catch (Exception ignored) {}
                    }
                }
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });
            sr.startListening(intent);
        } catch (Exception ignored) {}
    }

    public void executeAcceptCall() {
        restoreRingVolume();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                TelecomManager tm = (TelecomManager) getSystemService(Context.TELECOM_SERVICE);
                if (tm != null) {
                    tm.acceptRingingCall();
                }
            }
            mainHandler.postDelayed(() -> {
                try {
                    AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (am != null) {
                        am.setMode(AudioManager.MODE_IN_CALL);
                        am.setSpeakerphoneOn(true);
                    }
                } catch (Exception ignored) {}
            }, 800);
        } catch (Exception ignored) {}

        sendDecisionToServer("accept");
    }

    public void executeRejectCall() {
        restoreRingVolume();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                TelecomManager tm = (TelecomManager) getSystemService(Context.TELECOM_SERVICE);
                if (tm != null) {
                    tm.endCall();
                }
            }
        } catch (Exception ignored) {}

        sendDecisionToServer("reject");
        speakOverRingtone("Emredersiniz Efendim, aramayı meşgule attım ve sekreter olarak ben yanıtlıyorum.", "CALL_REJECT_DONE");
    }

    private void sendDecisionToServer(String action) {
        new Thread(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(BOT_BASE + "/api/call-action").openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                String body = "{\"action\":\"" + action + "\"}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes("UTF-8"));
                }
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception ignored) {}
        }).start();
    }

    private void startCloudCallPoller() {
        if (pollRunning) return;
        pollRunning = true;
        new Thread(() -> {
            while (pollRunning) {
                try {
                    HttpURLConnection conn = (HttpURLConnection) new URL(BOT_BASE + "/api/incoming-call-poll").openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(4000);
                    conn.setReadTimeout(4000);
                    if (conn.getResponseCode() == 200) {
                        BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line);
                        br.close();

                        JSONObject obj = new JSONObject(sb.toString());
                        boolean active = obj.optBoolean("active", false);
                        String callId = obj.optString("callId", "");
                        String decision = obj.optString("decision", "");
                        boolean isGsm = obj.optBoolean("isGsm", false);

                        if (!callId.isEmpty() && !decision.isEmpty() && !executedDecisionCallIds.contains(callId)) {
                            executedDecisionCallIds.add(callId);
                            if ("accept".equals(decision)) {
                                mainHandler.post(this::executeAcceptCall);
                            } else if ("reject".equals(decision)) {
                                mainHandler.post(this::executeRejectCall);
                            }
                        } else if (active && !callId.isEmpty() && !isGsm && !announcedCallIds.contains(callId)) {
                            announcedCallIds.add(callId);
                            String phone = obj.optString("phone", "");
                            String localName = lookupContactName(phone);
                            String callerName = (localName != null && !localName.isEmpty())
                                    ? localName
                                    : obj.optString("callerName", "Bilinmeyen Numara");
                            String alertText = "Efendim, şu an " + callerName + " sizi WhatsApp üzerinden arıyor. Açayım mı?";
                            mainHandler.post(() -> speakOverRingtone(alertText, "CALL_ASK_" + callId));
                        }
                    }
                    conn.disconnect();
                } catch (Exception ignored) {}
                try { Thread.sleep(1500); } catch (InterruptedException ignored) {}
            }
        }).start();
    }

    public void syncContactsToCloudAsync() {
        new Thread(() -> {
            Cursor cursor = null;
            try {
                cursor = getContentResolver().query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        new String[]{
                                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                                ContactsContract.CommonDataKinds.Phone.NUMBER
                        },
                        null, null, null
                );
                if (cursor == null) return;
                JSONArray arr = new JSONArray();
                while (cursor.moveToNext()) {
                    String name = cursor.getString(0);
                    String num = cursor.getString(1);
                    if (name != null && num != null && !name.trim().isEmpty() && !num.trim().isEmpty()) {
                        JSONObject item = new JSONObject();
                        item.put("name", name.trim());
                        item.put("tel", num.trim());
                        arr.put(item);
                    }
                }
                if (arr.length() > 0) {
                    JSONObject payload = new JSONObject();
                    payload.put("contacts", arr);
                    HttpURLConnection conn = (HttpURLConnection) new URL(BOT_BASE + "/api/sync-phone-contacts").openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                    conn.setDoOutput(true);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payload.toString().getBytes("UTF-8"));
                    }
                    conn.getResponseCode();
                    conn.disconnect();
                }
            } catch (Exception ignored) {
            } finally {
                if (cursor != null) cursor.close();
            }
        }).start();
    }

    @Override
    public void onDestroy() {
        pollRunning = false;
        restoreRingVolume();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
