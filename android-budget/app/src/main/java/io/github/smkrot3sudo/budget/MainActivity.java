package io.github.smkrot3sudo.budget;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.RecognizerIntent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/** A full-screen WebView around the budget website, with file picking, file saving and the back button wired up. */
public class MainActivity extends Activity {
    private static final String HOME = "https://smkrot3-sudo.github.io/dogsFood/budget/";
    private static final int PICK_FILE = 1, HILAN = 2, VOICE = 4;
    static final String EXTRA_SHIFT_DATE = "shiftDate";

    private WebView web;
    private ValueCallback<Uri[]> pendingPick;
    private HilanSync hilanSync;
    private boolean destroyed;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        setContentView(root);
        hilanSync = new HilanSync(this, root);
        hideNavigation();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " BudgetApp/" + BuildConfigVersion.NAME);

        web.addJavascriptInterface(new Bridge(), "BudgetApp");
        // Phone notification when a new app version comes out, also while the app is closed
        UpdateCheck.schedule(this);
        askNotifications();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String url = u.toString();
                if (url.startsWith(HOME) || "iteswfqwzbtpsjfwcptr.supabase.co".equals(u.getHost())) return false;
                // Anything else (mail links, other sites) opens outside the app
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException e) { /* nothing can open it */ }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingPick != null) pendingPick.onReceiveValue(null);
                pendingPick = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "בחירת קובץ"), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingPick = null;
                    return false;
                }
                return true;
            }
        });

        String shiftDate = getIntent().getStringExtra(EXTRA_SHIFT_DATE);
        if (shiftDate != null) {
            // From the shift reminder: the page opens the new-shift form for that day once it has loaded
            Reminder.cancel(this);
            getIntent().removeExtra(EXTRA_SHIFT_DATE);
            web.loadUrl(HOME + "?newShift=" + Uri.encode(shiftDate) + "#shifts");
        } else if (!openSignIn(getIntent())) {
            if (state != null) web.restoreState(state);
            else web.loadUrl(HOME);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String shiftDate = intent.getStringExtra(EXTRA_SHIFT_DATE);
        if (shiftDate != null) {
            Reminder.cancel(this);
            web.evaluateJavascript("window.openShiftFromApp?(window.openShiftFromApp(" + JSONObject.quote(shiftDate) + "),1):0", r -> {
                if (!"1".equals(r)) web.loadUrl(HOME + "?newShift=" + Uri.encode(shiftDate) + "#shifts");
            });
            return;
        }
        openSignIn(intent);
    }

    /** The browser hands back Google sign-in as io.github.smkrot3sudo.budget://auth#access_token=...; the page reads the session from its address. */
    private boolean openSignIn(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u == null || !"io.github.smkrot3sudo.budget".equals(u.getScheme())) return false;
        String query = u.getEncodedQuery(), fragment = u.getEncodedFragment();
        web.loadUrl(HOME + (query != null ? "?" + query : "") + (fragment != null ? "#" + fragment : ""));
        return true;
    }

    /** Hides the phone's bottom navigation buttons; a swipe up from the bottom brings them back for a moment. */
    @SuppressWarnings("deprecation")
    private void hideNavigation() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            View v = getWindow().getDecorView();
            v.setSystemUiVisibility(v.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @SuppressWarnings("deprecation")
    private void paintBars(boolean dark) { paintBars(dark ? 0xFF17121F : 0xFFFFF6EE, dark); }

    @SuppressWarnings("deprecation")
    private void paintBars(int color, boolean dark) {
        getWindow().setStatusBarColor(color);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) c.setSystemBarsAppearance(dark ? 0 : WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
        } else {
            View v = getWindow().getDecorView();
            int f = v.getSystemUiVisibility();
            v.setSystemUiVisibility(dark ? f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideNavigation();
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == HILAN) {
            String text = HilanActivity.lastText;
            HilanActivity.lastText = null;
            if (result == RESULT_OK && text != null) toPage(Hilan.result("ok", text, true));
            return;
        }
        if (request == VOICE) {
            ArrayList<String> heard = result == RESULT_OK && data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
            voiceToPage(heard != null && !heard.isEmpty() ? heard.get(0) : "");
            return;
        }
        if (request == PICK_FILE && pendingPick != null) {
            Uri[] picked = null;
            if (result == RESULT_OK && data != null && data.getData() != null) picked = new Uri[] { data.getData() };
            pendingPick.onReceiveValue(picked);
            pendingPick = null;
            return;
        }
        super.onActivityResult(request, result, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Close an open sheet in the page first, then go back in history, then leave
        web.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return 1}return 0})()", r -> {
            if ("1".equals(r)) return;
            if (web.canGoBack()) web.goBack();
            else finish();
        });
    }

    /** Called from the page: window.BudgetApp.saveFile(name, text) saves an export into Downloads. */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(String name, String text) {
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, "text/csv");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IllegalStateException("no uri");
                    try (OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(bytes); }
                    toast("נשמר בתיקיית ההורדות: " + safe);
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    File f = new File(dir, safe);
                    try (FileOutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                    toast("נשמר ב־" + f.getAbsolutePath());
                }
            } catch (Exception e) {
                toast("השמירה נכשלה");
            }
        }

        @JavascriptInterface
        public String version() { return BuildConfigVersion.NAME; }

        @JavascriptInterface
        public int versionCode() { return BuildConfigVersion.CODE; }

        @JavascriptInterface
        public boolean updateNotes() { return true; }

        /** Downloads a newer APK and opens the Android installer for it when the download finishes. */
        @JavascriptInterface
        public void installUpdate(String url) {
            if (url == null || !url.startsWith("https://smkrot3-sudo.github.io/")) return;
            runOnUiThread(() -> startUpdate(url));
        }

        /** Hilan connection state for the page: {"connected": bool, "lastSync": ms}. */
        @JavascriptInterface
        public String hilanStatus() { return Hilan.status(MainActivity.this); }

        /** Opens the Hilan screen where the user signs in and picks their attendance report. */
        @JavascriptInterface
        public void hilanConnect() {
            runOnUiThread(() -> startActivityForResult(new Intent(MainActivity.this, HilanActivity.class), HILAN));
        }

        /** Reads the saved report in the background; the result arrives at window.onHilan. */
        @JavascriptInterface
        public void hilanSync(boolean manual) {
            runOnUiThread(() -> {
                if (hilanSync.running()) return;
                hilanSync.start((status, text) -> toPage(Hilan.result(status, text, manual)));
            });
        }

        @JavascriptInterface
        public void hilanDisconnect() {
            runOnUiThread(() -> { if (hilanSync.running()) hilanSync.cancel(); Hilan.disconnect(MainActivity.this); });
        }

        /** Shift reminder state for the page: {"on": bool, "time": "HH:MM"}. */
        @JavascriptInterface
        public String reminderStatus() {
            try { return new JSONObject().put("on", Reminder.isOn(MainActivity.this)).put("time", Reminder.time(MainActivity.this)).toString(); }
            catch (Exception e) { return "{}"; }
        }

        /** Turns the daily shift reminder on or off at HH:MM; asks for notification permission where Android needs it. */
        @JavascriptInterface
        public void setReminder(boolean on, String time) {
            if (time == null || !time.matches("\\d\\d:\\d\\d")) time = "22:30";
            Reminder.set(MainActivity.this, on, time);
            if (on) askNotifications();
        }

        /** The page reports which recent days already have a shift or a "didn't work" mark (comma-separated yyyy-mm-dd). */
        @JavascriptInterface
        public void setDoneDays(String csv) { Reminder.setDoneDays(MainActivity.this, csv); }

        /** Days marked "didn't work" from the notification since the page last asked. */
        @JavascriptInterface
        public String takeOffDays() { return Reminder.takeOffDays(MainActivity.this); }

        /** The page's reminder times per day for the coming weeks (Fridays and holiday eves come earlier, Shabbat is skipped). */
        @JavascriptInterface
        public void setReminderPlan(String csv) { Reminder.setPlan(MainActivity.this, csv); }

        /** The phone's top bar takes the page's background: cream with dark icons, or dark purple with light ones. */
        @JavascriptInterface
        public void setBars(String theme) {
            final boolean dark = "dark".equals(theme);
            runOnUiThread(() -> paintBars(dark));
        }

        /** The top bar takes the page's background color (the user's palette), with light or dark icons. */
        @JavascriptInterface
        public void setBarColor(String hex, boolean dark) {
            final int c;
            try { c = 0xFF000000 | Integer.parseInt(hex.replace("#", ""), 16); } catch (Exception e) { return; }
            runOnUiThread(() -> paintBars(c, dark));
        }

        /** A notification right now, e.g. a category that just went over its budget. */
        @JavascriptInterface
        public void notifyNow(String title, String text) {
            if (title == null || title.isEmpty()) return;
            askNotifications();
            Notes.show(MainActivity.this, title, text == null ? "" : text, 100 + (int) (System.currentTimeMillis() / 1000 % 100));
        }

        /** Scheduled notifications (JSON list), such as the weekly summary after Shabbat. */
        @JavascriptInterface
        public void setNotes(String json) { Notes.set(MainActivity.this, json); }

        /** Speech to text in Hebrew; the words arrive at window.onVoice. */
        @JavascriptInterface
        public void listen() {
            runOnUiThread(() -> {
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "he-IL")
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, "מה קנית ובכמה?");
                try { startActivityForResult(i, VOICE); }
                catch (ActivityNotFoundException e) { toast("אין בטלפון זיהוי דיבור"); voiceToPage(""); }
            });
        }

        /** The phone's share menu (WhatsApp and the like) with a ready text. */
        @JavascriptInterface
        public void share(String text) {
            if (text == null) return;
            runOnUiThread(() -> {
                Intent s = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
                try { startActivity(Intent.createChooser(s, "שיתוף")); } catch (ActivityNotFoundException e) { toast("אין אפליקציה לשיתוף"); }
            });
        }

        /** Opens a page (Google sign-in) in the phone's browser, since Google blocks it inside apps. */
        @JavascriptInterface
        public void openExternal(String url) {
            if (url == null || !url.startsWith("https://")) return;
            runOnUiThread(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (ActivityNotFoundException e) { toast("אין דפדפן לפתוח בו את ההתחברות"); }
            });
        }
    }

    private void askNotifications() {
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            runOnUiThread(() -> requestPermissions(new String[] { android.Manifest.permission.POST_NOTIFICATIONS }, 3));
    }

    private void voiceToPage(String text) {
        if (destroyed) return;
        runOnUiThread(() -> web.evaluateJavascript("window.onVoice&&window.onVoice(" + JSONObject.quote(text) + ")", null));
    }

    /** Hands a Hilan result to the page's window.onHilan. */
    private void toPage(String json) {
        if (destroyed) return;
        runOnUiThread(() -> web.evaluateJavascript("window.onHilan&&window.onHilan(" + JSONObject.quote(json) + ")", null));
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Coming back to the app counts as opening it: the page decides whether a Hilan sync is due
        if (web != null) web.evaluateJavascript("window.hilanOnResume&&window.hilanOnResume();window.appResumed&&window.appResumed()", null);
    }

    private long updateId = -1;
    private BroadcastReceiver updateDone;

    private void startUpdate(String url) {
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        File old = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "budget-update.apk");
        if (old.exists()) old.delete();
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url))
            .setTitle("עדכון התקציב שלי")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "budget-update.apk");
        updateId = dm.enqueue(req);
        if (updateDone == null) {
            updateDone = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent i) {
                    long id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id != updateId) return;
                    Uri apk = dm.getUriForDownloadedFile(id);
                    if (apk == null) { toast("ההורדה נכשלה. נסה שוב."); return; }
                    Intent install = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(apk, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { startActivity(install); } catch (ActivityNotFoundException e) { toast("לא נמצא מתקין אפליקציות בטלפון"); }
                }
            };
            IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(updateDone, f, Context.RECEIVER_EXPORTED);
            else registerReceiver(updateDone, f);
        }
        toast("מוריד את העדכון…");
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        if (hilanSync != null && hilanSync.running()) hilanSync.cancel();
        if (updateDone != null) { unregisterReceiver(updateDone); updateDone = null; }
        if (web != null) { web.setVisibility(View.GONE); web.destroy(); }
        super.onDestroy();
    }
}
