package com.tatar.avelonjarvis;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQ_PERMS = 1001;
    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private boolean nativeListeningActive = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#040711"));
        setContentView(webView);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setUserAgentString(ws.getUserAgentString() + " TatarAvelonAPK/2026_x99_secret");

        webView.addJavascriptInterface(new AndroidJarvisBridge(), "AndroidJarvis");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    try {
                        request.grant(request.getResources());
                    } catch (Exception ignored) {}
                });
            }
        });

        requestNeededPermissions();
        startGuardService();
        webView.loadUrl("https://avelon-wp-botavelon-wp-bot.onrender.com/jarvis?pin=1453&apk=tatar_x99");
    }

    public class AndroidJarvisBridge {
        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public void startListening() {
            runOnUiThread(() -> startNativeRecognizer());
        }

        @JavascriptInterface
        public void stopListening() {
            runOnUiThread(() -> stopNativeRecognizer());
        }
    }

    private void startNativeRecognizer() {
        try {
            if (!SpeechRecognizer.isRecognitionAvailable(this)) return;
            if (speechRecognizer != null) {
                try {
                    speechRecognizer.cancel();
                    speechRecognizer.destroy();
                } catch (Exception ignored) {}
                speechRecognizer = null;
            }
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 2);

            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    evalJs("if(document.getElementById('heardBox')) document.getElementById('heardBox').textContent='🎙️ Telefon Mikrofonu Dinliyor...';");
                }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override
                public void onError(int error) {
                    if (nativeListeningActive && webView != null) {
                        webView.postDelayed(() -> {
                            evalJs("if(typeof isListening !== 'undefined' && isListening && !isSpeaking) startSpeechRecognition();");
                        }, 650);
                    }
                }
                @Override
                public void onResults(Bundle results) {
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) {
                        String text = matches.get(0);
                        evalJs("handleSpokenPhrase(" + JSONObject.quote(text) + ");");
                    }
                    if (nativeListeningActive && webView != null) {
                        webView.postDelayed(() -> {
                            evalJs("if(typeof isListening !== 'undefined' && isListening && !isSpeaking) startSpeechRecognition();");
                        }, 450);
                    }
                }
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });

            nativeListeningActive = true;
            speechRecognizer.startListening(intent);
        } catch (Exception ignored) {}
    }

    private void stopNativeRecognizer() {
        nativeListeningActive = false;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            } catch (Exception ignored) {}
            speechRecognizer = null;
        }
    }

    private void evalJs(String script) {
        if (webView == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.evaluateJavascript(script, null);
        } else {
            webView.loadUrl("javascript:" + script);
        }
    }

    private void requestNeededPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        List<String> needed = new ArrayList<>();
        String[] perms = new String[]{
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.READ_PHONE_STATE,
                Manifest.permission.READ_CALL_LOG,
                Manifest.permission.READ_CONTACTS,
                Manifest.permission.ANSWER_PHONE_CALLS,
                "android.permission.POST_NOTIFICATIONS"
        };
        for (String p : perms) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                needed.add(p);
            }
        }
        if (!needed.isEmpty()) {
            requestPermissions(needed.toArray(new String[0]), REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        Intent syncIntent = new Intent(this, CallGuardService.class);
        syncIntent.putExtra("cmd", "SYNC_CONTACTS");
        startGuardServiceWithIntent(syncIntent);
    }

    private void startGuardService() {
        startGuardServiceWithIntent(new Intent(this, CallGuardService.class));
    }

    private void startGuardServiceWithIntent(Intent serviceIntent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception ignored) {}
    }

    @Override
    protected void onDestroy() {
        stopNativeRecognizer();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }
}
