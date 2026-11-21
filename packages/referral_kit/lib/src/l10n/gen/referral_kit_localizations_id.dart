// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'referral_kit_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Indonesian (`id`).
class ReferralKitLocalizationsId extends ReferralKitLocalizations {
  ReferralKitLocalizationsId([String locale = 'id']) : super(locale);

  @override
  String get inviteTitle => 'Undang teman';

  @override
  String get yourCode => 'Kode undangan Anda';

  @override
  String get share => 'Bagikan';

  @override
  String get copyCode => 'Salin kode';

  @override
  String get codeCopied => 'Kode disalin';

  @override
  String get termsLink => 'Ketentuan program';

  @override
  String get rewardsEarned => 'Hadiah yang didapat';

  @override
  String get pendingRewards => 'Sedang diproses';

  @override
  String pendingItem(String reward, String date) {
    return '$reward, sekitar $date';
  }

  @override
  String bankedItem(String reward) {
    return '$reward, ditambahkan saat paket Anda saat ini berakhir.';
  }

  @override
  String skippedCap(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count hadiah melebihi batas');
    return '$_temp0';
  }

  @override
  String joinedCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count teman bergabung');
    return '$_temp0';
  }

  @override
  String claimedCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count teman memakai kode Anda. Hadiah Anda datang setelah mereka mulai memakai aplikasi.',
    );
    return '$_temp0';
  }

  @override
  String rulesJoinedEach(String reward) {
    return 'Anda dan teman masing-masing mendapat $reward saat mereka mendaftar dan mulai memakai aplikasi.';
  }

  @override
  String rulesJoinedBoth(String sharerReward, String friendReward) {
    return 'Anda mendapat $sharerReward dan teman Anda mendapat $friendReward saat mereka mendaftar dan mulai memakai aplikasi.';
  }

  @override
  String rulesJoinedSharerOnly(String reward) {
    return 'Anda mendapat $reward saat teman yang Anda undang mendaftar dan mulai memakai aplikasi.';
  }

  @override
  String rulesJoinedFriendOnly(String reward) {
    return 'Teman Anda mendapat $reward saat mereka mendaftar dan mulai memakai aplikasi.';
  }

  @override
  String rulesPaid(String reward) {
    return 'Anda mendapat $reward saat teman yang Anda undang berlangganan (setelah masa uji coba gratis, jika ada).';
  }

  @override
  String capJoins(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Maksimal $count teman per bulan yang dihitung.',
    );
    return '$_temp0';
  }

  @override
  String capPaid(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Maksimal $count teman yang berlangganan per tahun yang dihitung.',
    );
    return '$_temp0';
  }

  @override
  String paywallLine(String reward) {
    return 'Atau dapatkan $reward gratis saat teman yang Anda undang berlangganan.';
  }

  @override
  String get friendDisclosureBoth =>
      'Pengundang Anda mendapat hadiah saat Anda mulai memakai aplikasi, dan satu lagi jika Anda berlangganan, jadi mereka akan tahu saat itu terjadi. Mereka tidak pernah melihat email Anda atau apa yang Anda beli.';

  @override
  String get friendDisclosureJoined =>
      'Pengundang Anda mendapat hadiah saat Anda mulai memakai aplikasi, jadi mereka akan tahu saat itu terjadi. Mereka tidak pernah melihat email Anda atau apa yang Anda beli.';

  @override
  String get friendDisclosurePaid =>
      'Pengundang Anda mendapat hadiah jika Anda berlangganan, jadi mereka akan tahu saat itu terjadi. Mereka tidak pernah melihat email Anda atau apa yang Anda beli.';

  @override
  String friendWelcome(String reward) {
    return 'Bonus selamat datang: $reward, berkat undangan Anda.';
  }

  @override
  String sharerJoinedReward(String reward) {
    return 'Teman yang Anda undang mulai memakai aplikasi. Anda mendapat $reward.';
  }

  @override
  String sharerPaidReward(String reward) {
    return 'Teman yang Anda undang berlangganan. Anda mendapat $reward.';
  }

  @override
  String shareTextBoth(String app, String code, String reward, String link) {
    return 'Ini $reward di $app dari saya: gabung dengan kode saya $code dan kita berdua mendapatkannya setelah Anda mulai memakai aplikasi. $link';
  }

  @override
  String shareTextSharerOnly(String app, String code, String link) {
    return 'Saya memakai $app. Gabung dengan kode saya $code dan saya dapat bonus: $link';
  }

  @override
  String shareTextFriendOnly(String app, String code, String reward, String link) {
    return 'Ini $reward di $app dari saya: gabung dengan kode saya $code dan Anda mendapatkannya setelah mulai memakai aplikasi. $link';
  }

  @override
  String shareTextPlain(String app, String code, String link) {
    return 'Saya memakai $app. Gabung dengan kode saya $code: $link';
  }

  @override
  String emptyEach(String reward) {
    return 'Belum ada undangan. Bagikan kode Anda: kalian masing-masing dapat $reward saat teman mulai memakai aplikasi.';
  }

  @override
  String emptySharerOnly(String reward) {
    return 'Belum ada undangan. Bagikan kode Anda: Anda dapat $reward saat teman mulai memakai aplikasi.';
  }

  @override
  String get emptyPlain => 'Belum ada undangan. Bagikan kode Anda ke teman.';

  @override
  String get paused => 'Undangan sedang dijeda. Hadiah yang sudah Anda dapat tetap aman.';

  @override
  String get codeDisabled => 'Kode Anda dijeda selama kami meninjaunya. Hadiah yang sudah Anda dapat tetap aman.';

  @override
  String get loadFailed => 'Undangan tidak dapat dimuat. Periksa koneksi lalu coba lagi.';

  @override
  String get retry => 'Coba lagi';

  @override
  String get notAvailable => 'Undangan belum tersedia. Coba lagi nanti.';

  @override
  String get notAvailableCodeKept =>
      'Kode undangan belum tersedia. Kode Anda sudah kami simpan dan akan ditambahkan saat tersedia.';

  @override
  String get dismiss => 'Oke';

  @override
  String get enterCodeTitle => 'Punya kode undangan?';

  @override
  String get codeFieldLabel => 'Kode undangan';

  @override
  String get addCode => 'Tambahkan kode';

  @override
  String useCode(String code) {
    return 'Pakai kode $code';
  }

  @override
  String get enterDifferentCode => 'Masukkan kode lain';

  @override
  String get paste => 'Tempel';

  @override
  String windowCountdown(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Anda bisa menambahkan kode undangan $days hari lagi',
    );
    return '$_temp0';
  }

  @override
  String windowOver(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Kode undangan hanya bisa ditambahkan dalam $days hari pertama Anda',
    );
    return '$_temp0';
  }

  @override
  String get claimOk => 'Kode ditambahkan.';

  @override
  String get offlineQueued => 'Kode Anda akan kami terapkan saat Anda kembali online.';

  @override
  String get errOwnCode => 'Itu kode Anda sendiri. Bagikan ke teman saja.';

  @override
  String get errAlreadyReferred => 'Anda sudah memakai kode undangan.';

  @override
  String get errUnknownCode =>
      'Kode itu tidak ditemukan. Kode terdiri dari 8 huruf atau angka dan tidak pernah berisi O, 0, I, 1, atau L.';

  @override
  String errWindowClosed(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Kode undangan bisa ditambahkan dalam $days hari pertama Anda.',
    );
    return '$_temp0';
  }

  @override
  String errRateLimited(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'Terlalu banyak percobaan. Coba lagi dalam $minutes menit.',
    );
    return '$_temp0';
  }

  @override
  String get errNotVerified => 'Konfirmasi email Anda, lalu kode Anda akan kami tambahkan.';

  @override
  String get errSameInstall => 'Kode ini tidak bisa dipakai di perangkat ini.';

  @override
  String get errProgramPaused => 'Undangan sedang dijeda.';

  @override
  String get errUnavailable => 'Undangan tidak tersedia untuk akun ini.';

  @override
  String get errGeneric => 'Kode itu tidak bisa ditambahkan sekarang. Coba lagi nanti.';

  @override
  String rewardMinutes(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count menit');
    return '$_temp0';
  }

  @override
  String rewardEntitlementDays(int count, String name) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count hari $name');
    return '$_temp0';
  }

  @override
  String rewardOther(String amount, String kind) {
    return '$amount $kind';
  }

  @override
  String giftWaiting(String reward) {
    return 'Hadiah menunggumu: $reward';
  }

  @override
  String get giftWaitingPlain => 'Hadiah dari teman menunggumu';

  @override
  String daysLeftToAdd(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Tinggal $count hari untuk menambahkan kode',
      one: 'Hari terakhir untuk menambahkan kode',
    );
    return '$_temp0';
  }

  @override
  String get stepsTitle => 'Cara mendapatkannya';

  @override
  String get stepAddCode => 'Tambahkan kode temanmu';

  @override
  String stepStartUsing(String app) {
    return 'Mulai gunakan $app';
  }

  @override
  String stepRewardYou(String reward) {
    return '$reward masuk ke akunmu';
  }

  @override
  String stepRewardBoth(String reward) {
    return '$reward untukmu, dan untuk temanmu';
  }

  @override
  String get stepGift => 'Hadiahmu terbuka';

  @override
  String get almostTitle => 'Hampir jadi milikmu';

  @override
  String almostLine(String reward) {
    return 'Mulai gunakan aplikasinya dan $reward milikmu terbuka.';
  }

  @override
  String almostLineBoth(String reward) {
    return 'Mulai gunakan aplikasinya dan $reward milikmu terbuka. Temanmu juga mendapatkannya.';
  }

  @override
  String get almostLinePlain => 'Mulai gunakan aplikasinya dan hadiahmu terbuka.';

  @override
  String get almostProgress => '1 dari 2 selesai: kode ditambahkan';

  @override
  String cannotAddClosed(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Kode hanya untuk $days hari pertamamu, dan itu sudah lewat.',
      one: 'Kode hanya untuk hari pertamamu, dan itu sudah lewat.',
    );
    return '$_temp0';
  }

  @override
  String cannotAddNotEligible(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other:
          'Kode teman bisa ditambahkan sekali, dalam $days hari pertamamu. Akun ini tidak bisa menambahkannya sekarang.',
      one: 'Kode teman bisa ditambahkan sekali, di hari pertamamu. Akun ini tidak bisa menambahkannya sekarang.',
    );
    return '$_temp0';
  }

  @override
  String noLinkHint(String app) {
    return 'Temanmu mengunduh $app dari toko aplikasi lalu mengetik kode ini.';
  }

  @override
  String shareTextNoLinkBoth(String app, String code, String reward, String link) {
    return 'Ini $reward di $app dari saya: unduh, tambahkan kode undangan saya $code dan kita berdua mendapatkannya setelah Anda mulai memakai aplikasi. $link';
  }

  @override
  String shareTextNoLinkFriend(String app, String code, String reward, String link) {
    return 'Ini $reward di $app dari saya: unduh, tambahkan kode undangan saya $code dan Anda mendapatkannya setelah mulai memakai aplikasi. $link';
  }

  @override
  String shareTextNoLinkPlain(String app, String code, String link) {
    return 'Aku pakai $app. Unduh dan tambahkan kode undanganku $code: $link';
  }

  @override
  String shareTextCodeOnly(String app, String code) {
    return 'Aku pakai $app. Unduh dan tambahkan kode undanganku $code.';
  }

  @override
  String get signInToInvite => 'Masuk untuk mendapatkan kode undanganmu dan menambahkan kode teman.';

  @override
  String get signIn => 'Masuk';

  @override
  String get notInThisVersion => 'Undangan tidak ada di versi aplikasi ini.';

  @override
  String shareTextEach(String app, String code, String reward, String link) {
    return 'Ini $reward di $app dari saya: gabung dengan kode saya $code dan Anda mendapatkannya setelah mulai memakai aplikasi (saya juga dapat bonus). $link';
  }

  @override
  String shareTextNoLinkEach(String app, String code, String reward, String link) {
    return 'Ini $reward di $app dari saya: unduh, tambahkan kode undangan saya $code dan Anda mendapatkannya setelah mulai memakai aplikasi (saya juga dapat bonus). $link';
  }

  @override
  String inviteHeadlineBoth(String reward) {
    return 'Beri teman $reward, dan dapatkan yang sama, saat mereka bergabung dengan kode Anda dan mulai memakai aplikasi';
  }

  @override
  String inviteHeadlineEach(String friendReward, String sharerReward) {
    return 'Beri teman $friendReward dan dapatkan $sharerReward saat mereka bergabung dengan kode Anda dan mulai memakai aplikasi';
  }

  @override
  String inviteHeadlineFriend(String reward) {
    return 'Beri teman $reward saat mereka bergabung dengan kode Anda dan mulai memakai aplikasi';
  }

  @override
  String inviteHeadlineSharer(String reward) {
    return 'Dapatkan $reward saat teman bergabung dengan kode Anda dan mulai memakai aplikasi';
  }

  @override
  String waitingFriends(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count teman memakai kode Anda.');
    return '$_temp0';
  }

  @override
  String waitingNextStep(String step) {
    return 'Langkah berikutnya untuk mereka: $step.';
  }

  @override
  String waitingRewardBoth(int count, String reward) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Untuk setiap teman yang melakukannya, Anda berdua mendapat $reward.',
      one: 'Saat mereka melakukannya, Anda berdua mendapat $reward.',
    );
    return '$_temp0';
  }

  @override
  String waitingRewardYou(int count, String reward) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Untuk setiap teman yang melakukannya, Anda mendapat $reward.',
      one: 'Saat mereka melakukannya, Anda mendapat $reward.',
    );
    return '$_temp0';
  }

  @override
  String waitingRewardEach(int count, String sharerReward, String friendReward) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Untuk setiap teman yang melakukannya, Anda mendapat $sharerReward dan dia mendapat $friendReward.',
      one: 'Saat mereka melakukannya, Anda mendapat $sharerReward dan mereka mendapat $friendReward.',
    );
    return '$_temp0';
  }

  @override
  String waitingRewardFriend(int count, String reward) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Setiap teman yang melakukannya mendapat $reward.',
      one: 'Saat mereka melakukannya, mereka mendapat $reward.',
    );
    return '$_temp0';
  }

  @override
  String get whatsApp => 'WhatsApp';

  @override
  String get showQr => 'Tampilkan kode QR';

  @override
  String get qrTitle => 'Tautan undangan Anda';

  @override
  String get qrHint => 'Teman memindai ini dengan kamera ponselnya untuk membuka undangan Anda.';

  @override
  String get qrSemantics => 'Kode QR tautan undangan Anda';

  @override
  String get close => 'Tutup';

  @override
  String boostDouble(String date) {
    return 'Hadiah ganda sampai $date untuk setiap teman yang menambahkan kode Anda sebelum itu.';
  }

  @override
  String boostTimes(String multiplier, String date) {
    return 'Hadiah $multiplier× sampai $date untuk setiap teman yang menambahkan kode Anda sebelum itu.';
  }

  @override
  String boostFriendDouble(String date) {
    return 'Hadiah sambutan ganda sampai $date untuk teman yang menambahkan kode Anda sebelum itu.';
  }

  @override
  String boostFriendTimes(String multiplier, String date) {
    return 'Hadiah sambutan $multiplier× sampai $date untuk teman yang menambahkan kode Anda sebelum itu.';
  }

  @override
  String get invitePageTitle => 'Halaman undangan Anda';

  @override
  String get showFirstName => 'Tampilkan nama depan saya';

  @override
  String get firstNameLabel => 'Nama depan';

  @override
  String get invitePageExplainRewarded =>
      'Nama depan Anda ditampilkan kepada teman yang membuka tautan Anda, dengan catatan bahwa Anda mendapat hadiah jika mereka bergabung.';

  @override
  String get invitePageExplain => 'Nama depan Anda ditampilkan kepada teman yang membuka tautan Anda.';

  @override
  String get nameErrEmpty => 'Masukkan nama depan Anda.';

  @override
  String get nameErrTooLong => 'Gunakan paling banyak 40 karakter.';

  @override
  String get nameErrNoLetter => 'Gunakan setidaknya satu huruf.';

  @override
  String get nameErrEmailOrLink => 'Nama tidak boleh berisi @ atau tautan.';

  @override
  String get save => 'Simpan';

  @override
  String get saved => 'Tersimpan';

  @override
  String get saveFailed => 'Tidak dapat menyimpan. Periksa koneksi Anda dan coba lagi.';

  @override
  String get leaveProgram => 'Keluar dari program undangan';

  @override
  String get leaveConfirmTitle => 'Keluar dari program undangan?';

  @override
  String get leaveConfirmBody =>
      'Kode Anda berhenti berlaku untuk teman baru dan nama Anda tidak lagi ditampilkan. Hadiah yang sedang diproses tetap masuk. Anda bisa bergabung lagi kapan saja dengan kode yang sama.';

  @override
  String get leaveConfirm => 'Keluar';

  @override
  String get cancel => 'Batal';

  @override
  String get leftTitle => 'Anda keluar dari program undangan';

  @override
  String get leftBody => 'Kode Anda tidak berlaku untuk teman baru. Hadiah yang sedang diproses tetap masuk.';

  @override
  String get joinAgain => 'Bergabung lagi';

  @override
  String welcomeWaiting(String reward, String step) {
    return 'Hadiah sambutan $reward menunggu Anda: $step.';
  }

  @override
  String welcomeWaitingPlain(String step) {
    return 'Hadiah sambutan menunggu Anda: $step.';
  }

  @override
  String welcomeDaysLeft(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Tinggal $count hari.',
      one: 'Hari terakhir.',
    );
    return '$_temp0';
  }

  @override
  String passItOn(String reward) {
    return 'Teruskan: beri teman $reward saat mereka bergabung dengan kode Anda dan mulai memakai aplikasi.';
  }

  @override
  String passItOnPlain(String app) {
    return 'Teruskan: undang teman ke $app.';
  }

  @override
  String get inviteAFriend => 'Undang teman';
}
