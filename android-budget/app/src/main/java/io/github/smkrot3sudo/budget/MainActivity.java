package io.github.smkrot3sudo.budget;

import android.app.Activity;
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
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** A full-screen WebView around the budget website, with file picking, file saving and the back button wired up. */
public class MainActivity extends Activity {
    private static final String HOME = "https://smkrot3-sudo.github.io/dogsFood/budget/";
    private static final int PICK_FILE = 1;

    private WebView web;
    private ValueCallback<Uri[]> pendingPick;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        setContentView(web);

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

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
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

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.setVisibility(View.GONE); web.destroy(); }
        super.onDestroy();
    }
}
