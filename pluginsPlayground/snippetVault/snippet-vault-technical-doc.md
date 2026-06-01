# KoBar - Snippet Vault Teknik Dökümantasyonu

## 1. Sisteme Genel Bakış
**Snippet Vault** (Kod/Metin Kasası), KoBar masaüstü uygulamasının kullanıcılarına sık kullandıkları kod parçacıklarını, hazır cevap metinlerini, notları veya hassas verileri saklama imkanı sunan gelişmiş bir eklentidir. Bu modül sadece pasif bir depolama alanı değil; şifreleme, renk bazlı kategorizasyon, akıllı arama ve KoBar'ın temel fonksiyonu olan **çoklu pano (clipboard) slotlarına entegrasyon** yetenekleri sunan interaktif bir veri yönetim aracıdır.

## 2. Teknik Mimari ve Kullanılan Teknolojiler
Snippet Vault, uygulamanın genel mimarisine sadık kalarak, modern ve performans odaklı bir yapıda geliştirilmiştir.

*   **Frontend ve UI:** `React` (Fonksiyonel bileşenler) ve `Tailwind CSS` kullanılmıştır.
*   **State Management (Durum Yönetimi):** `Zustand` kullanılmıştır. Snippet'ların tutulduğu ve genel durumun yönetildiği yer `useAppStore`, panoya aktarım sağlayan entegrasyon noktası ise `useClipboardStore`'dur.
*   **Kriptografi (Şifreleme):** `crypto-js` kütüphanesinin AES (Advanced Encryption Standard) algoritması ile kullanıcı tarafında (client-side) şifreleme gerçekleştirilmektedir.
*   **Platformlar Arası Uyumluluk:** Electron'un dinamik yapısına uygun şekilde, uygulamanın Windows veya macOS üzerinde çalışmasına veya ekranın farklı kenarlarına yapışık (Top, Bottom, Left, Right) konumlanmasına uyumlu özel bir rendering mekanizması içerir.

## 3. Veri Modeli (Data Schema)
Snippet verileri, uygulama state'inde aşağıdaki arayüz (interface) ile temsil edilir ve saklanır:

```typescript
export interface Snippet {
    id: string;           // Benzersiz UUID, snippet kimliği.
    title: string;        // Snippet başlığı.
    content: string;      // Snippet içeriği. Eğer şifreleme devredeyse, bu alan AES ile şifrelenmiş (ciphertext) metni barındırır.
    tags: string[];       // Hızlı arama ve filtreleme için tanımlanmış etiket dizisi.
    password?: string;    // Kullanıcı tarafından atanmış özel kilit şifresi (Sadece kontrol amaçlı tutulur, asıl güvenlik AES algoritması üzerinden sağlanır).
    color?: string;       // UI için Hex formatında renk kodu ataması (Örn: #ef4444).
}
```

## 4. Temel Özellikler ve Çalışma Prensipleri

### 4.1. Uçtan Uca Şifreleme ve Güvenlik (Client-Side Encryption)
Uygulama, hassas verileri saklamak için özel bir "Kilit (Lock)" mekanizması barındırır.
*   **Şifreleme (Encryption):** Yeni bir snippet eklenirken şifre girildiğinde, `content` alanı doğrudan `CryptoJS.AES.encrypt(content, password).toString()` fonksiyonu ile şifrelenir. 
*   **Şifre Çözme (Decryption):** Kullanıcı kilitli bir snippet'ı okumak, kopyalamak veya slotlara göndermek istediğinde sistem bir "şifre istemi (prompt)" çıkarır. Girilen şifre ile `CryptoJS.AES.decrypt` işlemi denenir. Şifre doğruysa, veri orijinal haline döndürülüp bellekte sadece o işlem anı için işlenir.
*   **Avantajı:** Bu sistem, kullanıcının yerel diskindeki ayar dosyası veya JSON dışarı sızsa bile kilitli verilerin üçüncü şahıslar tarafından okunamamasını (encryption at rest mantığıyla) sağlar.

### 4.2. KoBar Pano (Clipboard) Sistemi ile Derin Entegrasyon
Snippet Vault içerisindeki bir veri, iki farklı şekilde dışarı çıkarılabilir:
1.  **İşletim Sistemi Panosuna Kopyalama (Copy to OS):** `navigator.clipboard.writeText()` API'si kullanılarak doğrudan Windows veya macOS panosuna aktarılır.
2.  **KoBar Slotlarına Gönderme (Send to Slot):** Modülün en güçlü yanlarından biridir. Kullanıcı bir snippet'i, KoBar'ın aktif pano geçmişine doğrudan bir "Slot" olarak enjekte edebilir. Bu işlem, `useClipboardStore` içerisindeki `forceAddClipboardItem('text', content)` fonksiyonu çağrılarak yapılır.

### 4.3. Dinamik Konumlandırma ve Akıllı Taşıma (Smart Positioning)
Snippet Vault, KoBar'ın aktif pozisyonunu (yatay veya dikey bar) ve ekranın sınırlarını (screen bounds) sürekli hesaplayan bir algoritmaya sahiptir.
*   **Hesaplama Algoritması:** `getPopupStyle()` fonksiyonu, ana uygulamanın (anchor) x/y koordinatlarını, boyut değerlerini, barın ekrandaki kenarını (edgePosition) alarak Snippet Vault'un render edileceği en uygun `Absolute` pozisyonu hesaplar.
*   **Ekran Dışına Çıkmayı Önleme (Clamp):** `isSmartPositioning` ayarı aktifse, popup'ın ebatları ekran sınırlarını aşıyorsa (`maxLeft`, `maxTop`, `minLeft`, `minTop` limitleri ile kontrol edilir), sistem popup'ı ekranın görünür sınırları içine doğru kaydırır.
*   **Sürükleme (Drag) Senkronizasyonu:** Electron ana uygulamasının fare ile sürüklenmesi durumunda fırlatılan özel `kobar-drag` event'i dinlenir (`document.addEventListener('kobar-drag', onDrag)`). Böylece KoBar arayüzü hareket ettirildiğinde, Snippet Vault penceresi de ana uygulama ile aynı hizada senkronize bir şekilde ekranda süzülür.

### 4.4. Gelişmiş Filtreleme (Arama) Mekanizması
Arama işlemi ve performansı optimize etmek için React'ın `useMemo` kancası (hook) kullanılarak filtrelenmiş sonuçlar önbelleğe alınmıştır.
Arama çubuğuna girilen değer (`searchQuery`), listeyi şu kriterlere göre anında filtreler:
*   Başlık (`title`) eşleşmesi.
*   Etiket (`tags`) eşleşmesi.
*   İçerik (`content`) eşleşmesi. **Önemli Not:** Güvenlik nedeniyle, şifrelenmiş snippet'ların içerikleri şifresi çözülmeden arama indeksine dahil edilmez; böylece aramalar veri gizliliğini ihlal etmez.

### 4.5. Arayüz Görünüm Modları (Compact & Normal View)
Kullanıcının ekran alanını verimli kullanabilmesi için iki farklı listeleme modu (View Mode) bulunur:
*   **Normal Görünüm:** Başlık, içerik özeti (line-clamp ile 2 satırla sınırlanmış), renk paletleri, etiketler ve eylem butonlarının bariz şekilde vurgulandığı genişletilmiş klasik arayüz.
*   **Kompakt Görünüm (`isSnippetVaultCompact`):** Yalnızca snippet başlıklarının alt alta minimum boşlukla sıralandığı, kopyalama, slota gönderme veya silme butonlarının yalnızca o satırın üzerine gelindiğinde (hover:opacity-100) belirdiği, yüksek performanslı ve kalabalık snippet listelerine uygun görünüm modu.

## 5. UI/UX Tasarım Kalıpları ve Mikro Etkileşimler
*   **Glassmorphism (Buzlu Cam):** `getPopupStyle()` içerisinde `backdrop-filter: blur(20px)` (macOS için `8px` blur) kullanılarak tasarım sistemi KoBar'ın felsefesine uygun hale getirilmiştir. Arka plandaki pencereler estetik bir şekilde bulanıklaştırılır.
*   **Etkileşim Geçirgenliği (Pointer Events):** Uygulama div'ine girildiğinde `window.api?.setIgnoreMouseEvents?.(false)` çağrılır. Fare (mouse) modülün dışına çıktığında ise `true` yapılarak tıklamaların uygulamanın arkasında kalan diğer Windows/Mac uygulamalarına geçmesine izin verilir (Click-through).
*   **Renk Paleti ve Vurgu:** Özel olarak tanımlanmış 6 adet renk profili (Kırmızı, Mavi, Yeşil, Sarı, Mor, Turuncu), Tailwind CSS `border` ve `bg` sınıflarının alpha (saydamlık) değerleriyle harmanlanarak UI üzerinde yumuşak bir arka plan (`snippet.color + '15'`) ve kenarlık ile kullanıcıya görsel bir gruplama hissi sağlar.
*   **Akıcı Animasyonlar:** Yeni eylem pencerelerinin (örneğin kilit açma penceresi veya arama kutusu ikonları) ekranda belirmesi Tailwind'in `animate-in`, `fade-in`, `slide-in-from-left-2`, `zoom-in-95` sınıflarıyla 200ms sürede pürüzsüzce sağlanmıştır.

## 6. Özet
Snippet Vault; salt basit bir metin kayıt aracı olmaktan çıkarak:
1.  **Güvenlik:** Kriptografik şifreleme ile veri koruması,
2.  **Sistem Entegrasyonu:** KoBar slotlarına ve işletim sistemi panosuna anlık aktarım,
3.  **Kullanıcı Deneyimi:** Sürükleme senkronizasyonu, dinamik konumlandırma, iki farklı listeleme modu ve zengin arama algoritmaları
gibi bileşenleri bir araya getiren *kompleks ve son derece etkili* bir kişisel bilgi kütüphanesidir.
