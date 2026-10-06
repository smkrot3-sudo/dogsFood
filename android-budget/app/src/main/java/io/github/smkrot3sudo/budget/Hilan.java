package io.github.smkrot3sudo.budget;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;

import org.json.JSONObject;

/**
 * What the app remembers about the user's Hilan connection, kept only on this phone:
 * the address of their attendance report and when it was last read. No password is stored;
 * the signed-in Hilan session lives in the WebView's own cookies.
 */
final class Hilan {
    private static final String PREFS = "hilan";

    /** Reads all visible text of the page and of its same-site frames; tables come out one row per line. */
    static final String EXTRACT_JS =
        "(function(){function t(d){if(!d||!d.body)return '';var s=d.body.innerText||'';" +
        "var f=d.querySelectorAll('iframe,frame');for(var i=0;i<f.length;i++){try{s+='\\n'+t(f[i].contentDocument)}catch(e){}}return s}" +
        "return t(document)})()";

    /** True when the page (or a same-site frame) shows a password box, which means Hilan wants the user to sign in. */
    static final String IS_LOGIN_JS =
        "(function(){function h(d){if(!d)return false;if(d.querySelector('input[type=password]'))return true;" +
        "var f=d.querySelectorAll('iframe,frame');for(var i=0;i<f.length;i++){try{if(h(f[i].contentDocument))return true}catch(e){}}return false}" +
        "return h(document)})()";

    private static final java.util.regex.Pattern SHIFT_ROW =
        java.util.regex.Pattern.compile("\\d{1,2}[/.\\-]\\d{1,2}[^\\n]*?\\d{1,2}:\\d\\d[^\\n]*?\\d{1,2}:\\d\\d");

    /** A line with a date followed by two clock times looks like a shift row of an attendance report. */
    static boolean looksLikeReport(String text) {
        return text != null && SHIFT_ROW.matcher(text).find();
    }

    static final String START_URL = "https://www.hilan.co.il/";

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static String reportUrl(Context c) { return prefs(c).getString("reportUrl", null); }

    static void setReportUrl(Context c, String url) { prefs(c).edit().putString("reportUrl", url).apply(); }

    static long lastSync(Context c) { return prefs(c).getLong("lastSync", 0); }

    static void setLastSync(Context c, long at) { prefs(c).edit().putLong("lastSync", at).apply(); }

    static String status(Context c) {
        try {
            return new JSONObject()
                .put("connected", reportUrl(c) != null)
                .put("lastSync", lastSync(c))
                .toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** Forgets the report address and signs out of Hilan by clearing the WebView cookies. */
    static void disconnect(Context c) {
        prefs(c).edit().clear().apply();
        CookieManager cm = CookieManager.getInstance();
        cm.removeAllCookies(null);
        cm.flush();
    }

    /** The message handed to the page's window.onHilan: status is ok, login (session expired) or error. */
    static String result(String status, String text, boolean manual) {
        try {
            return new JSONObject()
                .put("status", status)
                .put("text", text == null ? "" : text)
                .put("manual", manual)
                .put("at", System.currentTimeMillis())
                .toString();
        } catch (Exception e) {
            return "{\"status\":\"error\"}";
        }
    }

    private Hilan() {}
}
