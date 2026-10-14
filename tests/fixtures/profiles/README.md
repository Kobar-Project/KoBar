# Profil fikstürleri (zincir testi)

Bu klasördeki her `vN/` klasörü, profil (zincir) sürümü N'deki (`LATEST_PROFILE_VERSION` sayacı; `kobar-storage` sürümü değil) **tamamen sentetik** bir kullanıcı profilidir
(gerçek kullanıcı verisi asla konmaz).

- `vN/localStorage.json` — localStorage girdileri (anahtar -> string değer): `kobar-storage` (Zustand persist
  `{ state, version }`), eklenti verisi anahtarları, `_iso_` anahtarları.
- `vN/userData/` — Electron `userData` dosyaları: `kobar-system.json`, `window-state.json`,
  `extensions-config.json`, `extensions/`, `KoBox/` (hepsi sahte/minimal). Şekiller main'in yazdığıyla uyumludur:
  `window-state.json` yalnızca `{x, y}`, `extensions-config.json` `Record<string, boolean>`.
  `kobar-system.json` şimdilik **yer tutucu** `{}`'dir (kodda şekli doğrulanamadı); gerçek migration testi
  yazmadan önce sahibine sor.

Testler `tests/chain/` altındadır. `migrateProfileToLatest(profile)` profili tek çağrıda en güncel duruma taşır.
Fikstürler yalnızca metin dosyası içermelidir (okuyucu utf8 + CRLF normalizasyonu yapar).
Sohbet (chat) fikstürü `apiKeys` alanını bilerek içermez: fikstürlere hiçbir sır/anahtar konmaz.

## İki ayrı sürüm sayacı
- `KOBAR_STORAGE_VERSION`: `kobar-storage` persist sürümü (`useAppStore` persist `version` ile aynı olmalı;
  `store-persist-options.dom.test.ts` bunu doğrular).
- `LATEST_PROFILE_VERSION`: profil (zincir) sürümü. Yalnızca `MIGRATION_STEPS` adımları artırır.
  Zincir `BASE_PROFILE_VERSION` (21, en eski fikstür) ile başlar.

`migrateProfileToLatest` önce `kobar-storage` blob'unu HER ZAMAN `migrateKobarStorageBlob` ile taşır (Zustand gibi
blob'un kendi `version` alanına bakar, güncelse dokunmaz), sonra profil sürümünün önündeki adımları sırayla uygular.

## Yeni bir migration eklerken
1. **Yalnızca `kobar-storage` değişiyorsa:** `src/store/migrations/index.ts` içindeki `migrateVersionedBlocks` fonksiyonuna yeni `if (version < N)` bloğunu
   (mantık ayrı `vN.ts` dosyasında) ekle, store persist `version`'ını ve `runChain.ts` içindeki `KOBAR_STORAGE_VERSION`'ı artır. **Adım ekleme,
   `LATEST_PROFILE_VERSION`'a dokunma.** Beklenen yeni alanı `chain.test.ts`'e yaz.
2. **`userData` (veya başka kalıcı dosya) değişiyorsa:** `MIGRATION_STEPS` listesinin SONUNA bir adım ekle:
   `{ from: <önceki to ya da BASE_PROFILE_VERSION>, to: <yeni profil sürümü>, name, apply(profile) }`,
   `LATEST_PROFILE_VERSION`'ı artır. Eski `vN/` fikstürünü olduğu gibi bırak (eski profil hâlâ yükseltilebilmeli);
   yeni şekil için `v(N+1)/` fikstürü ekleyip beklenen çıktıyı `chain.test.ts`'e yaz. Adım `kobar-storage`'a
   dokunmamalıdır (o iş 1. maddedeki mekanizmanın).
3. İkisi birden değişiyorsa 1 ve 2'yi birlikte yap. Prosedürün çalışır örneği `chain.test.ts` içindeki
   "simulated future migrations" testleridir (sahte adım ve sahte sürüm `options` ile enjekte edilir).
4. Kural: localStorage anahtarı silinmez. Yeni adım `userData` dosyalarına dokunuyorsa önce yedek almalı ve
   `chain.test.ts` içindeki "leaves userData files and KoBox untouched today" testi bilinçli olarak güncellenmelidir.

## Zincir kuralları
- Adım listesi boşluksuz olmalı, ilk adım `BASE_PROFILE_VERSION`'dan başlamalı, son adım `LATEST_PROFILE_VERSION`'da
  bitmeli (test kontrol eder). Bugün liste boştur.
- `kobar-storage` değişiklikleri ayrı bir adımda tekrar uygulanmaz (iki kez çalışırdı).
