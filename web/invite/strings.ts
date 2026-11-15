// Invite page wording (ADR 11.3: en, hi, id at launch; apps add more). "{app}" is replaced with the app name.
// Hindi and Indonesian need a native speaker's review before launch (docs/TODO.md).
import type { Lang, Strings } from "./render.ts";

export const STRINGS: Record<Lang, Strings> = {
  en: {
    title: "{app}: you're invited",
    lead: "Your friend invited you to {app}. Add this code when you sign up:",
    copy: "Copy code",
    copied: "Code copied",
    appStore: "Get it on the App Store",
    appStoreNote: "Tapping this copies the code. Paste it in the app after installing.",
    googlePlay: "Get it on Google Play",
    playNote: "On Android the code is filled in for you after installing.",
    terms: "Invite program terms",
    invalid: "This invite link is not complete. Ask your friend for their code, or get {app} below.",
  },
  hi: {
    title: "{app}: आपको आमंत्रण मिला है",
    lead: "आपके दोस्त ने आपको {app} पर बुलाया है। साइन अप करते समय यह कोड डालें:",
    copy: "कोड कॉपी करें",
    copied: "कोड कॉपी हो गया",
    appStore: "App Store से डाउनलोड करें",
    appStoreNote: "इस पर टैप करने से कोड कॉपी हो जाता है। ऐप इंस्टॉल करने के बाद उसमें पेस्ट करें।",
    googlePlay: "Google Play से डाउनलोड करें",
    playNote: "Android पर इंस्टॉल के बाद कोड अपने आप भर जाता है।",
    terms: "आमंत्रण प्रोग्राम की शर्तें",
    invalid: "यह आमंत्रण लिंक अधूरा है। अपने दोस्त से उनका कोड माँगें, या नीचे से {app} डाउनलोड करें।",
  },
  id: {
    title: "{app}: kamu diundang",
    lead: "Temanmu mengundangmu ke {app}. Masukkan kode ini saat mendaftar:",
    copy: "Salin kode",
    copied: "Kode disalin",
    appStore: "Unduh di App Store",
    appStoreNote: "Mengetuk ini akan menyalin kode. Tempel di aplikasi setelah dipasang.",
    googlePlay: "Unduh di Google Play",
    playNote: "Di Android, kode terisi otomatis setelah dipasang.",
    terms: "Ketentuan program undangan",
    invalid: "Tautan undangan ini tidak lengkap. Minta kode ke temanmu, atau unduh {app} di bawah.",
  },
};
