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

/** A full-screen WebView around the budget website, with file picking, file saving and the back button wired up. */
public class MainActivity extends Activity {
    private static final String HOME = "https://smkrot3-sudo.github.io/dogsFood/budget/";
    private static final int PICK_FILE = 1, HILAN = 2;

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

        if (!openSignIn(getIntent())) {
            if (state != null) web.restoreState(state);
            else web.loadUrl(HOME);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
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
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
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

    /** Hands a Hilan result to the page's window.onHilan. */
    private void toPage(String json) {
        if (destroyed) return;
        runOnUiThread(() -> web.evaluateJavascript("window.onHilan&&window.onHilan(" + JSONObject.quote(json) + ")", null));
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Coming back to the app counts as opening it: the page decides whether a Hilan sync is due
        if (web != null) web.evaluateJavascript("window.hilanOnResume&&window.hilanOnResume()", null);
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
