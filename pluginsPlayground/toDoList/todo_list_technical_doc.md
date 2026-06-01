# KoBar - To-Do List (Yapılacaklar Listesi) Teknik Dökümantasyonu

## 1. Genel Bakış
KoBar'ın **To-Do List** özelliği, kullanıcıların görevlerini yönetmesini sağlayan hafif, sürüklenebilir ve ana KoBar penceresine bağlı olarak çalışan (floating) bir arayüz bileşenidir. Görevler sıralı bir şekilde saklanır ve uygulama kapansa dahi Zustand kalıcılık (persistence) altyapısı sayesinde veriler güvenle korunur.

## 2. Teknik Altyapı ve Durum Yönetimi (State Management)

To-Do listesinin tüm durumu ve iş mantığı `src/store/useAppStore.ts` içerisindeki merkezi Zustand mağazası (store) ile yönetilmektedir.

### Veri Modeli
Her bir görev aşağıdaki yapıya sahip bir `Todo` objesidir:
```typescript
export interface Todo {
    id: string;
    text: string;
    completed: boolean;
    dueDate?: string; // İsteğe bağlı tarih
}
```

### State Değişkenleri
- `todos`: Tüm görevlerin tutulduğu ana dizi.
- `isTodoListOpen`: Listenin ekranda görünür olup olmadığını kontrol eder.
- `todoListAnchorRect`: Popup'ın ekranda nereye sabitleneceğini belirleyen (örneğin butonun) DOM koordinatları.
- `isTodoListEnabled`: Özelliğin ayarlar menüsünden aktif/pasif edilme durumu.

### Fonksiyonlar (Actions)
- `addTodo()`: Listeye yeni ve boş bir görev ekler (ID olarak `Date.now()` kullanır).
- `updateTodoText(id, text)`: Görevin metnini anlık günceller.
- `toggleTodo(id)`: Görevin tamamlandı/tamamlanmadı (checkbox) durumunu değiştirir.
- `deleteTodo(id)`: Görevi listeden siler.
- `reorderTodos(startIndex, endIndex)`: Sürükle-bırak (Drag & Drop) işlemi sonucunda görevlerin sırasını günceller.

## 3. Kullanıcı Arayüzü (UI) ve Mimari

Özelliğin görsel bileşeni **`src/components/layout/TodoListPopup.tsx`** dosyasında bir React Functional Component olarak tasarlanmıştır.

### Önemli Mekanizmalar:

1. **Dinamik Konumlandırma (Smart Positioning)**
   - Popup, ana KoBar uygulamasının yönelimine (`orientation`: yatay/dikey) ve kenara yaslanma durumuna (`edgePosition`) göre kendini konumlandırır.
   - `screenBounds` verisi baz alınarak, popup'ın ekran dışına taşması engellenir. Taşma durumlarında minimum ve maksimum koordinatlar (minLeft/maxLeft, minTop/maxTop) sınırlandırılır.

2. **KoBar Sürükleme Entegrasyonu**
   - KoBar penceresi sürüklendiğinde özel `kobar-drag` event'i dinlenir.
   - Bu sayede KoBar hareket ettiğinde To-Do listesi kapatılmaz; aksine ana pencereyle senkronize bir şekilde anlık koordinat değişimi yaparak sürüklenir.

3. **Sürükle ve Bırak (Drag & Drop)**
   - HTML5 Native Drag and Drop API'si kullanılmıştır (`draggable`, `onDragStart`, `onDragEnter`, `onDragEnd`).
   - Her bir görev için `draggedItemIndex` durumu takip edilir, sürüklenen elemanın stil özellikleri anlık olarak yarı saydam (opacity) yapılarak kullanıcıya geri bildirim verilir.

4. **İlerleme Çubuğu (Progress Bar)**
   - Tamamlanan görev sayısının tüm görevlere oranı matematiksel olarak hesaplanır: `(completedCount / todos.length) * 100`.
   - Çıkan sonuç yüzde (%) cinsinden arayüzde dinamik bir progress bar olarak işlenir.

## 4. İşletim Sistemi Uyumluğu ve Tasarım Etkileri

- **Cam Efekti (Glassmorphism):** Uygulama `style2` (modern/transparan tasarım) modundayken popup'ın arkaplanında blur efekti uygulanır. 
- **macOS / Windows Farklılıkları:** `isMac` state'i kullanılarak platforma özgü estetik ayar yapılır. macOS sistemlerde Apple'ın native bulanıklığı baz alınıp blur değeri `8px` verilirken, Windows tarafında şeffaflığı dengelemek için blur `20px` olarak uygulanır.
- **Dil Desteği (i18n):** `todoEmptyState`, `todoPlaceholder`, `todoListHeader` gibi arayüz içi metinlerin hepsi merkezi çeviri sisteminden (`t` fonksiyonu) çekilir, böylece farklı dillere tam uyumludur.

## 5. Electron Özel Entegrasyonu ve Performans

- **Drag ve No-Drag Sınırları:** Electron'un pencere sürükleme mekanizmasını yönetmek için arayüzdeki input ve butonlar `-webkit-app-region: no-drag` (`no-drag-region` class'ı) özelliğine sahiptir. Aksi halde input'a tıklandığında bütün uygulama penceresi hareket edebilirdi.
- **Render Optimizasyonu:** `useAppStore` hook'u kullanılırken her bir state değişkeni (örn: `const todos = useAppStore(state => state.todos)`) ayrı ayrı çekilmiştir. Bu, React bileşeninin yalnızca ilgili durum değiştiğinde re-render edilmesini sağlar.
- **Z-Index:** Popup, arayüzde diğer bileşenlerin altında kalmaması için `99999` z-index değeriyle absolut olarak yerleştirilmiştir.
