package io.github.smkrot3sudo.budget;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;

/**
 * The user's own Hilan site inside the app. They sign in themselves, open their monthly attendance report,
 * and tap the button at the bottom. The app then remembers the report's address and hands its text to the budget page.
 */
public class HilanActivity extends Activity {
    /** The report text of the last tap, read by MainActivity when this screen closes (too big for an Intent extra). */
    static String lastText;

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.VERTICAL);
        head.setBackgroundColor(Color.parseColor("#DB3577"));
        int pad = dp(14);
        head.setPadding(pad, pad, pad, pad);
        TextView title = text("🔗 חיבור לחילן", 19, true);
        TextView hint = text("1. התחבר לחילן כרגיל.  2. פתח את דוח הנוכחות של החודש (הטבלה עם שעות הכניסה והיציאה).  3. לחץ על הכפתור למטה.", 14, false);
        head.addView(title);
        head.addView(hint);
        root.addView(head);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient());
        root.addView(web, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        Button done = new Button(this);
        done.setText("✓ זה דוח הנוכחות שלי. ייבוא המשמרות");
        done.setAllCaps(false);
        done.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        done.setTypeface(Typeface.DEFAULT_BOLD);
        done.setTextColor(Color.WHITE);
        done.setBackgroundColor(Color.parseColor("#7A46DE"));
        done.setPadding(pad, dp(16), pad, dp(16));
        done.setOnClickListener(v -> takeReport());
        root.addView(done, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        setContentView(root);
        String saved = Hilan.reportUrl(this);
        web.loadUrl(saved != null ? saved : Hilan.START_URL);
    }

    private void takeReport() {
        web.evaluateJavascript(Hilan.EXTRACT_JS, raw -> {
            String text = decode(raw);
            if (!Hilan.looksLikeReport(text)) {
                Toast.makeText(this, "לא מצאתי בעמוד הזה משמרות. פתח את דוח הנוכחות של החודש ונסה שוב.", Toast.LENGTH_LONG).show();
                return;
            }
            Hilan.setReportUrl(this, web.getUrl());
            Hilan.setLastSync(this, System.currentTimeMillis());
            CookieManager.getInstance().flush();
            lastText = text;
            setResult(RESULT_OK, new Intent());
            finish();
        });
    }

    /** evaluateJavascript hands back a JSON value; a string result arrives quoted. */
    static String decode(String raw) {
        if (raw == null || "null".equals(raw)) return "";
        try { return new JSONArray("[" + raw + "]").optString(0, ""); } catch (Exception e) { return ""; }
    }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setGravity(Gravity.START);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        CookieManager.getInstance().flush();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
