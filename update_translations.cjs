const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'i18n', 'translations.ts');
let content = fs.readFileSync(filePath, 'utf8');

const keysEn = `
        noteEditorEngine: "Note Editor Engine",
        editorTiptap: "Tiptap (Rich Text)",
        editorEditorJs: "Editor.js (Block)",
        editorjsPlaceholder: "Press '/' or click '+' to add a block...",
        blockHeading: "Heading",
        blockBulletedList: "Bulleted List",
        blockNumberedList: "Numbered List",
        blockChecklist: "Checklist",
        blockCode: "Code",
        blockQuote: "Quote",
        blockImage: "Image",
        blockDivider: "Divider"`;

const keysTr = `
        noteEditorEngine: "Not Editör Motoru",
        editorTiptap: "Tiptap (Zengin Metin)",
        editorEditorJs: "Editor.js (Blok)",
        editorjsPlaceholder: "Blok eklemek için '/' tuşuna veya '+' simgesine tıklayın...",
        blockHeading: "Başlık",
        blockBulletedList: "Madde İşaretli Liste",
        blockNumberedList: "Numaralı Liste",
        blockChecklist: "Kontrol Listesi",
        blockCode: "Kod",
        blockQuote: "Alıntı",
        blockImage: "Görsel",
        blockDivider: "Ayırıcı"`;

content = content.replace(/(todoEmptyState:\s*".*?")/g, (match) => {
    if (match.includes("Hepsi tamam")) {
        return match + "," + keysTr;
    } else {
        return match + "," + keysEn;
    }
});

fs.writeFileSync(filePath, content, 'utf8');
console.log("Translations fixed successfully!");
