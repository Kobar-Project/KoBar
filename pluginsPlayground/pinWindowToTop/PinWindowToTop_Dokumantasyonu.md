# Pin Window to Top (Pin Injector) Özelliği - Teknik Dokümantasyon

## 1. Özelliğin Amacı ve İşlevi
"Pin Window to Top" (Kod içindeki adıyla **Pin Injector**), KoBar kullanıcılarının masaüstündeki herhangi bir üçüncü parti uygulama penceresini "Her Zaman Üstte" (Always on Top) moduna geçirmesini sağlayan bir sistem entegrasyonudur. Bu özellik sayesinde kullanıcılar, not alırken, video izlerken veya referans bir dosyaya bakarken o pencerenin diğer pencerelerin altında kaybolmasını engelleyebilirler.

## 2. Kullanıcı Deneyimi (UI/UX)
Özellik, KoBar Sidebar'ı üzerinden yönetilir ve kullanıcıya görsel geri bildirimlerle (animasyonlar ve renkler) durum bilgisi verir.

- **İkon ve Durumlar:**
  - **Varsayılan:** `push_pin` ikonu (Gri/Pasif).
  - **Hedef Seçim Modu (Targeting Mode):** Kullanıcı ikona bir kez tıkladığında ikon kırmızıya döner ve yanıp sönmeye (pulse animasyonu) başlar. Ayrıca kırmızı bir gölge efekti uygulanır.
  - **Sabitlenmiş Mod (Pinned):** Bir pencere başarıyla sabitlendiğinde ikon `bookmark_remove` şeklini alır, yeşil renge döner ve parlak yeşil bir gölge efekti kazanır.
- **Kullanım Senaryoları:**
  - **Tek Tık:** Hedef seçim moduna girer (veya zaten bir pencere sabitliyse onu serbest bırakır).
  - **Çift Tık:** Sabitlenmiş **tüm** pencerelerin sabitlemesini kaldırır (Unpin All).
- **Görsel Takip Çerçevesi (Border):** Windows'ta sabitlenen pencerenin etrafında kırmızı renkli, saydam, 8px kalınlığında bir çerçeve (border) belirir. Böylece kullanıcı hangi pencerenin sabitlendiğini kolayca görebilir.

## 3. Mimari ve Teknik Altyapı

Bu özellik **React (Frontend)**, **Electron (Main Process)** ve **Windows API (PowerShell / user32.dll)** üçgeninde çalışır.

### A. React Frontend (`Sidebar.tsx` ve `useAppStore`)
- Kullanıcı ikona tıkladığında `setIsTargetingMode(true)` ile React state'i güncellenir.
- Preload script üzerinden açılan `window.api.enterPinTargetingMode()` IPC çağrısı ile Electron main process'ine haber verilir.
- `pinnedWindowHwnd` (Sabitlenen pencerenin işletim sistemi seviyesindeki ID'si) dinlenerek butonun yeşil olup olmayacağına karar verilir.

### B. Electron Backend (`main.cts`)
Asıl karmaşık iş mantığı burada yer alır. Özellik, çapraz platform (Windows ve macOS) uyumluluğu gözetilerek iki farklı şekilde implemente edilmiştir:

#### 1. Windows İmplementasyonu (Gerçek Enjeksiyon)
Windows, `user32.dll` kütüphanesi aracılığıyla pencerelerin Z-index (derinlik) sıralamasının değiştirilmesine izin verir. Ancak Node.js (Electron) doğrudan C++ API'lerine erişemediği için arka planda **kalıcı bir PowerShell süreci (child_process.spawn)** çalıştırılır ve içine anlık komutlar (stdin) gönderilir.

- **Hedefin Yakalanması:** 
  - `enter-pin-targeting` olayı geldiğinde main process `isAwaitingPinTarget = true` bayrağını kaldırır.
  - Kullanıcı hedef pencereye tıkladığında KoBar'ın odağı kaybolur (`browser-window-blur` eventi tetiklenir).
  - Uygulama 200ms bekleyip (işletim sisteminin yeni pencereye odaklanması için) PowerShell üzerinden `GetForegroundWindow()` C# komutunu çalıştırır ve hedef pencerenin Handle'ını (HWND) alır.
- **Sabitleme İşlemi (SetWindowPos):**
  - Hedefin `GWL_EXSTYLE` bayrakları okunur. Eğer zaten `WS_EX_TOPMOST` ise bu özellik kaldırılır (`HWND_NOTOPMOST`). Değilse eklenir (`HWND_TOPMOST`).
- **Pencere Takip Sistemi (Window Tracking):**
  - Başarıyla sabitlenen pencerenin fiziksel koordinatlarını takip etmek için `borderWindow` adında tıklanamayan (ignoreMouseEvents), transparan, sadece kırmızı sınırları (border) olan özel bir Electron `BrowserWindow` oluşturulur.
  - `setInterval` ile her 50ms'de bir PowerShell üzerinden hedefin konumu (`GetWindowRect`) okunur.
  - **Önemli Matematik (DPI/Scale Factor):** Windows'un native C++ kodları fiziksel (physical) pikselleri döndürürken, Electron mantıksal (logical) pikselleri kullanır. Aradaki fark `screen.getPrimaryDisplay().scaleFactor` ile bölünerek hesaplanır ve `borderWindow` hedef pencerenin üstüne "yapıştırılır".

#### 2. macOS İmplementasyonu (Alternatif Yaklaşım)
Apple'ın güvenlik mimarisi (Sandbox ve Accessibility kısıtlamaları) gereği bir uygulamanın (KoBar) diğer uygulamaların Z-sıralamasını basit scriptlerle kalıcı olarak değiştirmesi zordur. Bu yüzden KoBar ekibi burada felsefi bir manevra yapmıştır:
- macOS'ta `Pin Injector` dışarıdaki bir pencereyi üste almak yerine, **KoBar'ın kendisini** sistem seviyesinde `screen-saver` katmanına taşır ve tüm çalışma alanlarında (All Workspaces/Mission Control) görünür kılar.
- MacOS tarafında hedef seçimi yapılmaz, doğrudan KoBar "süper üstte" (super-top) moda geçer.

## 4. IPC (Inter-Process Communication) Akışı
- **Frontend -> Backend:**
  - `enter-pin-targeting`: Hedef moduna gir.
  - `unpin-current-window`: Seçili HWND'nin sabitlemesini kaldır.
  - `unpin-all-windows`: `allPinnedHwnds` listesindeki tüm HWND'leri serbest bırak.
- **Backend -> Frontend:**
  - `pin-targeting-complete`: Seçim işlemi bittiğinde arayüzü normale döndür.
  - `pinned-window-changed`: Sabitlenen HWND değiştiğinde (veya null olduğunda) arayüzdeki ikon rengini/işlevini (yeşil/gri) güncelle.

## 5. İptal ve Temizlik İşlemleri
- Özellik kapatılırken veya `unpin-all-windows` çağrıldığında, `borderWindow` anında yok edilir (`destroy()`).
- 50ms'lik polling interval'i `clearInterval` ile temizlenir.
- PowerShell'e tüm pencereler için `HWND_NOTOPMOST` emri gönderilir ve bellek temizlenir.
- Uygulama tamamen kapatıldığında (`will-quit` eventi) açık kalan PowerShell çocuğu (`psProcess.kill()`) sonlandırılarak zombi process'ler engellenir.
