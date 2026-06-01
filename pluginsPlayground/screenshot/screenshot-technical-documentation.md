# KoBar Screenshot Studio - Teknik Mimari ve Çalışma Prensibi

## 1. Genel Bakış (Overview)
KoBar "Screenshot Studio", işletim sisteminin native yetenekleriyle entegre çalışan, çoklu monitör (multi-monitor) destekli gelişmiş bir ekran görüntüsü alma aracıdır. Kullanıcıya tam ekran veya bölgesel seçim yapma imkanı tanır. Alınan ekran görüntüsü, KoBar'ın özel "Annotation Editor" (Açıklama Düzenleyicisi) üzerinde anında düzenlenebilir; metin, çizim ve şekillerle zenginleştirildikten sonra panoya kopyalanabilir veya kaydedilebilir.

---

## 2. Mimari ve Katmanlar (Architecture)

Screenshot Studio özelliği üç temel katmandan oluşur:

1. **Electron Main Katmanı (`main.cts`)**: İşletim sistemiyle konuşur. Ekran izinlerini denetler, çoklu monitör koordinatlarını hesaplar ve `desktopCapturer` aracılığıyla pikselleri kaydeder.
2. **Preload Katmanı (`preload.cts`)**: Güvenli IPC (Inter-Process Communication) köprüsüdür. React frontend'inin `window.api` üzerinden arka plandaki Electron metodlarını tetiklemesini sağlar.
3. **React UI Katmanı**: Zustand üzerinden state yönetimi yapar. Seçim aşaması (`ScreenshotOverlay.tsx`) ve düzenleme aşaması (`AnnotationEditor.tsx`) olarak iki ayrı birimden oluşur.

---

## 3. Çalışma Akışı ve İşlevler (Workflow & Functions)

### A. Yakalama İsteğinin Başlatılması (`start-screenshot-capture`)
Kullanıcı araç çubuğundaki "Ekran Görüntüsü" butonuna tıkladığında süreç başlar.

1. **İzin Kontrolü**: macOS'te `systemPreferences.getMediaAccessStatus('screen')` kullanılarak Screen Recording izinleri denetlenir. İzin yoksa süreç iptal edilir ve native ayarlar penceresi tetiklenir.
2. **Bound Hesaplama (Multi-Monitor)**: `screen.getAllDisplays()` kullanılarak fiziksel ekrana bağlı tüm monitörlerin köşe koordinatları (minX, minY, maxX, maxY) birleştirilir.
3. **Ghost Window (Hayalet Pencere) Yaklaşımı**: 
   - KoBar ana penceresi geçici olarak gizlenir (Capture sırasında ekranda çıkmaması için).
   - Ana pencerenin `Bounds` değerleri güncellenerek tüm monitörleri kapsayacak şekilde devasa bir boyuta (`width: maxX - minX`, vb.) genişletilir.
4. **Desktop Capturer ile Yakalama**: Electron'un `desktopCapturer.getSources` metodu ile o anki ekranların `thumbnail` boyutlu snapshotları çekilir ve base64 formatında frontend'e döndürülür.
5. **Arayüzün Gösterilmesi**: KoBar devasa hayalet penceresiyle görünür hale gelir. Kullanıcı artık kendi masaüstünü değil, masaüstünün anlık fotoğrafının basıldığı dev bir React Canvas'ını (ScreenshotOverlay) görmektedir.

### B. Seçim Modları (`ScreenshotOverlay.tsx`)

React tarafı devralsa da, kullanıcının iki farklı modda ekranı yakalama şansı vardır:
- **Tam Ekran (Fullscreen)**: Anında birincil monitörü kapsayacak şekilde seçim yapar.
- **Bölgesel (Region)**: Kullanıcı fareyi sürükleyerek bir kutu çizer. Bu esnada `Loupe` (Büyüteç/Magnifier) bileşeni devreye girer. Fare imlecinin altındaki pikseller 4 kat (4x) büyütülerek hassas kırpma yapılması sağlanır.

Seçim işlemi `cropAndTransition` fonksiyonu ile tamamlandığında, master canvas'tan sadece o koordinatlardaki pikseller kesilir (`cropCanvas.getContext('2d').drawImage`) ve `editing` (düzenleme) fazına geçilir.

### C. Açıklama Düzenleyicisi (`AnnotationEditor.tsx`)

Düzenleme modunda, arka planda devasa hayalet pencere devam ederken ekranın tam ortasında `react-konva` kütüphanesi kullanılarak bir çizim tahtası oluşturulur.

- **Araçlar**: Seçme (Select), Kalem (Pen), Fosforlu Kalem (Highlighter), Metin (Text), Ok (Arrow), Dikdörtgen (Rect) ve Daire (Circle).
- **Özelleştirme**: Renk paleti, çizgi kalınlıkları (Stroke width), içi dolu/boş şekil (Fill) ve font seçenekleri sunulur.
- **Image Border (Çerçeve)**: Ekran görüntüsünün tamamına global bir renkli sınır çizgisi eklenebilir.
- **Katman Mimarisi**: Orijinal resim bir `Layer`'da, üzerine çizilen vektörel elementler ise farklı bir `Layer`'da barındırılır.

### D. Dışa Aktarma ve İptal (Export & Cancel)

Kullanıcı işini bitirdiğinde üç eylemden birini seçer:

1. **Panoya Kopyalama (Copy)**: `getCompositeDataUrl` üzerinden Konva Stage'in tüm render işlemi veri URI'sine çevrilir ve `ipcRenderer.send('copy-screenshot-to-clipboard')` çağrılarak panoya bir Bitmap olarak aktarılır.
2. **Kaydetme (Save)**: Yine veri URI'si oluşturulur, `save-screenshot` IPC event'i ile Electron'a yollanır. Node.js `fs.promises.writeFile` aracılığıyla belirlenen `.png`, `.jpg` veya `.webp` formatında diske yazılır.
3. **Tamamlama / İptal (Done / Cancel)**: Ekran görüntüsü süreci kapatıldığında, devasa KoBar penceresi (`preScreenshotBounds` hafızası sayesinde) eski küçük dikey "Sidebar" boyutuna ve orijinal pozisyonuna küçülür.

---

## 4. Cross-Platform İyileştirmeleri (Windows vs. macOS)
Ekran görüntüsü özelliğinde Windows ve macOS davranışları birbirine entegredir:
- macOS özelinde *Screen Recording* izni zaruridir, izni almadan işlem yapılamaz.
- KoBar penceresini en öne getirme (Always On Top) mantığında, macOS pencerelerinde `'floating'`, Windows'ta ise `'screen-saver'` seviyesi kullanılarak z-index önceliği korunur.
- Native klavye kısayolu (Örn. PrintScreen veya `ms-screenclip:`) gibi "Legacy" ekran görüntüsü özellikleri de geri dönük uyumluluk adına hala `main.cts` içerisinde barındırılır ancak ana odak özel stüdyodur.

## 5. Güvenlik ve İzolasyon Standartları
- Ekran alıntısı tamamen izole bir süreçte ilerler. UI frontend'i Node.js `fs` veya `child_process` kütüphanelerine asla doğrudan erişemez. 
- Kaydetme işlemleri Electron `dialog` API'si ile kullanıcı onayı alınarak native diyalog pencerelerinde yapılır. Veri transferi sadece spesifik olarak tanımlanmış Preload IPC tipleri üzerinden geçirilir.
