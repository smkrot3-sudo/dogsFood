package io.github.smkrot3sudo.budget;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Reads the saved attendance report in an invisible WebView, using the Hilan session the user signed in with.
 * It never types anything into Hilan: if Hilan asks for a sign-in, it reports "login" so the page can ask the user.
 */
final class HilanSync {
    interface Done { void done(String status, String text); }

    private static final long SETTLE_MS = 2000, GIVE_UP_MS = 45000;
    private static final int MAX_CHECKS = 8;

    private final Activity act;
    private final ViewGroup host;
    private final Handler h = new Handler(Looper.getMainLooper());
    private WebView web;
    private Done done;
    private int checks;
    private final Runnable check = this::check;
    private final Runnable giveUp = () -> finish("error", "");

    HilanSync(Activity act, ViewGroup host) { this.act = act; this.host = host; }

    boolean running() { return web != null; }

    void start(Done cb) {
        String url = Hilan.reportUrl(act);
        if (url == null) { cb.done("notconnected", ""); return; }
        if (running()) return;
        done = cb;
        checks = 0;
        web = new WebView(act);
        web.setAlpha(0f);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView v, String u) {
                h.removeCallbacks(check);
                h.postDelayed(check, SETTLE_MS);
            }
        });
        // Behind the budget page, full size so the report lays out as it would on screen
        host.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        h.postDelayed(giveUp, GIVE_UP_MS);
        web.loadUrl(url);
    }

    private void check() {
        if (web == null) return;
        web.evaluateJavascript(Hilan.IS_LOGIN_JS, isLogin -> {
            if (web == null) return;
            if ("true".equals(isLogin)) { finish("login", ""); return; }
            web.evaluateJavascript(Hilan.EXTRACT_JS, raw -> {
                String text = HilanActivity.decode(raw);
                if (Hilan.looksLikeReport(text)) finish("ok", text);
                else if (++checks < MAX_CHECKS) h.postDelayed(check, SETTLE_MS);
                else finish("error", "");
            });
        });
    }

    private void finish(String status, String text) {
        h.removeCallbacks(check);
        h.removeCallbacks(giveUp);
        if (web != null) {
            host.removeView(web);
            web.destroy();
            web = null;
        }
        if ("ok".equals(status)) {
            Hilan.setLastSync(act, System.currentTimeMillis());
            CookieManager.getInstance().flush();
        }
        Done cb = done;
        done = null;
        if (cb != null) cb.done(status, text);
    }

    void cancel() { finish("error", ""); }
}
