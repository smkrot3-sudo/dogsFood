package io.github.smkrot3sudo.budget;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Decides whether a notification's text is a card or bank charge. Plain Java (no Android), so it can be tested on its own. */
final class PayParse {
    String result = "", cur = "ILS", merchant = "", text = "";
    double amount;

    // Chat and text-message apps are skipped: the owner chose notifications from payment apps only, not SMS
    private static final Set<String> SKIP = new HashSet<>(Arrays.asList(
        "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger", "com.facebook.orca", "com.google.android.gm",
        "com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms", "com.android.messaging",
        "com.microsoft.office.outlook", "com.instagram.android"));
    // Shopping apps advertise prices all day ("קנייה ב־₪9.99!"); their notifications are never the charge itself
    private static final Pattern SHOP_APP = Pattern.compile(
        "temu|aliexpress|shein|amazon|ebay|wish|joom|alibaba|zara|asos|next\\.|terminalx|ksp|ivory|bug\\.|shufersal|rami|yango|wolt|10bis|"
        + "booking|agoda|airbnb|facebook|tiktok|youtube|netflix|spotify|chrome|browser|news|ynet|walla|mako", Pattern.CASE_INSENSITIVE);
    // Banks, card companies and wallets (Google Wallet posts its charges through Google Play services, com.google.android.gms)
    private static final Pattern PAY_APP = Pattern.compile(
        "wallet|com\\.google\\.android\\.gms|spay|samsung\\.android\\.(spay|samsungpay)|leumi|poalim|discount|mizrahi|tefahot|fibi|"
        + "otsar|massad|yahav|jerusalem|mercantile|isracard|amex|\\.max|max\\.|\\.cal|cal\\.|cal-?online|bit|paybox|pepper|onezero|one\\.zero|"
        + "bank|card|pay", Pattern.CASE_INSENSITIVE);

    private static final Pattern AMOUNT = Pattern.compile(
        "(?:₪|ש\"ח|ש״ח|ILS|NIS)\\s?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s?(?:₪|ש\"ח|ש״ח|ILS|NIS|שקל)");
    private static final Pattern PAID = Pattern.compile(
        "חיוב|חויב|עסק[הת]|רכישה|רכשת|שולם|שילמת|תשלום|אושר|בוצע|העברת|charged|payment|purchase|paid|spent|transaction", Pattern.CASE_INSENSITIVE);
    // An app that isn't a bank or wallet must say outright that a card was charged, not just mention a price
    private static final Pattern PAID_STRONG = Pattern.compile(
        "חויב|חיוב (?:בסך|בסכום|של|על סך|בכרטיס)|עסק[הת] (?:בסך|בסכום|של|על סך|בכרטיס|אושרה|בוצעה)|שילמת|רכישה (?:בסך|בסכום|בכרטיס)|"
        + "your card was charged|card charged|transaction of", Pattern.CASE_INSENSITIVE);
    private static final Pattern INCOMING = Pattern.compile(
        "זיכוי|זוכה|החזר|קיבלת|הועבר[וה]? אליך|העביר לך|העבירה לך|refund|received|credited", Pattern.CASE_INSENSITIVE);
    // Foreign charges (online shops, subscriptions, trips abroad): kept in their currency, the page turns them into shekels
    private static final String NUM = "([0-9][0-9,]*(?:\\.[0-9]{1,2})?)";
    private static final String SYM = "\\$|€|£|USD|EUR|GBP|CHF|JPY|CAD|AUD|THB|TRY|CZK|HUF|PLN|RON|BGN|GEL|AED|EGP|JOD|CNY|INR|SEK|NOK|DKK|MXN|BRL|ZAR|HKD|SGD|KRW|דולר|יורו|אירו|ליש\"ט|ליש״ט|פאונד";
    private static final Pattern FOREIGN = Pattern.compile("(" + SYM + ")\\s?" + NUM + "|" + NUM + "\\s?(" + SYM + ")");

    static String code(String sym) {
        switch (sym) {
            case "$": case "דולר": return "USD";
            case "€": case "יורו": case "אירו": return "EUR";
            case "£": case "ליש\"ט": case "ליש״ט": case "פאונד": return "GBP";
            default: return sym;
        }
    }

    // Not a charge: an upcoming statement total, a one-time code, a cancelled or declined charge, a balance update, an ad
    private static final Pattern NOT_PAY = Pattern.compile(
        "חיוב צפוי|צפוי לחיוב|סך החיובים|סה\"כ חיובים|סה״כ חיובים|חיוב החודשי|דף החשבון|פירוט החיובים|"
        + "קוד אימות|קוד חד|קוד הזדהות|סיסמה חד|סיסמא חד|קוד כניסה|OTP|verification code|one.time|"
        + "בוטל|ביטול|מבוטל|נדחה|נדחתה|סורב|סירוב|לא אושר|לא אושרה|cancel|declined|reversed|"
        + "הנחה|קופון|מבצע|משלוח חינם|במתנה|רק ב|החל מ|מחיר|חסכו|חסוך|הזדמנות|בעגלה|לעגלה|"
        + "sale|discount|coupon|% off|free shipping|deal|cart|limited|hurry|price|save", Pattern.CASE_INSENSITIVE);
    // "יתרה: ₪3,000" next to a charge is the account balance, not the charge; it's cut out before looking for the amount
    private static final Pattern BALANCE = Pattern.compile(
        "(?:יתרת?|היתרה|balance)[^0-9₪$\\n]{0,25}(?:₪|ש\"ח|ש״ח)?\\s?-?[0-9][0-9,]*(?:\\.[0-9]{1,2})?\\s?(?:₪|ש\"ח|ש״ח|ILS)?", Pattern.CASE_INSENSITIVE);
    // A "merchant" that is only card digits ("כרטיס המסתיים ב-1234") is no merchant at all
    private static final Pattern CARD_BITS = Pattern.compile("^[0-9*xX•\\s-]+$|כרטיס|המסתיים|ספרות|אשראי");
    // Google Wallet and some card apps put the shop's name in the title; a bank or card company name there is not a shop
    private static final Pattern ISSUER = Pattern.compile(
        "בנק|פועלים|לאומי|דיסקונט|מזרחי|הבינלאומי|ישראכרט|מקס|כאל|אמריקן|ביט|פייבוקס|התראה|חיוב|עסקה|כרטיס|תשלום|"
        + "bank|max|cal|amex|isracard|leumi|hapoalim|discount|wallet|google|pay|bit|alert|[0-9₪$]", Pattern.CASE_INSENSITIVE);
    private static final Pattern MERCHANT = Pattern.compile(
        "(?:בבית העסק|בבית עסק|אצל|ב־|ב-|at )\\s*([^,.\\n:;]{2,40}?)(?=\\s*(?:בסך|בסכום|בתאריך|ביום|על סך|בכרטיס|,|\\.|$|\\n|₪|[0-9]))");
    // Google writes "38.00 ₪" with a no-break space and Hebrew direction marks; Java's \s matches neither
    private static final Pattern ODD_SPACE = Pattern.compile("[\\u00A0\\u2007\\u2009\\u202F\\u205F\\u3000]");
    private static final Pattern MARKS = Pattern.compile("[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]");

    static String clean(String s) {
        if (s == null) return "";
        return MARKS.matcher(ODD_SPACE.matcher(s).replaceAll(" ")).replaceAll("").trim();
    }

    static PayParse parse(String pkg, String title, String body) {
        PayParse r = new PayParse();
        title = clean(title); body = clean(body);
        if (SKIP.contains(pkg)) { r.result = "chat"; return r; }
        boolean payApp = PAY_APP.matcher(pkg).find() && !SHOP_APP.matcher(pkg).find();
        if (!payApp && SHOP_APP.matcher(pkg).find()) { r.result = "shop app"; return r; }
        String all = (title + "\n" + body).trim();
        if (all.length() > 600) all = all.substring(0, 600);
        all = BALANCE.matcher(all).replaceAll(" ").trim();
        if (!PAID.matcher(all).find()) { r.result = "not a payment"; return r; }
        if (!payApp && !PAID_STRONG.matcher(all).find()) { r.result = "not a payment app"; return r; }
        if (INCOMING.matcher(all).find()) { r.result = "incoming"; return r; }
        if (NOT_PAY.matcher(all).find()) { r.result = "not a charge"; return r; }
        Matcher m = AMOUNT.matcher(all);
        String num;
        if (m.find()) num = m.group(1) != null ? m.group(1) : m.group(2);
        else {
            m = FOREIGN.matcher(all);
            if (!m.find()) { r.result = "no amount"; return r; }
            r.cur = code(m.group(1) != null ? m.group(1) : m.group(4));
            num = m.group(2) != null ? m.group(2) : m.group(3);
        }
        // "8,50 €" in Europe is eight and a half; "1,250" is still one thousand two hundred and fifty
        if (num.matches("[0-9]+,[0-9]{2}")) num = num.replace(",", ".");
        r.amount = Double.parseDouble(num.replace(",", ""));
        if (!(r.amount > 0) || r.amount > 100000) { r.result = "amount out of range"; return r; }
        Matcher mm = MERCHANT.matcher(body.isEmpty() ? all : body);
        while (mm.find()) {
            String cand = mm.group(1).trim();
            if (!CARD_BITS.matcher(cand).find()) { r.merchant = cand; break; }
        }
        if (r.merchant.isEmpty() && title.length() >= 2 && title.length() <= 40 && !ISSUER.matcher(title).find()) r.merchant = title;
        r.text = all.length() > 200 ? all.substring(0, 200) : all;
        r.result = "ok";
        return r;
    }
}
