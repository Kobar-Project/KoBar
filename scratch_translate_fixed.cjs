const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/i18n/translations.ts');
let text = fs.readFileSync(filePath, 'utf8');

const translationsToAdd = {
    en: {
        restartTutorial: "Reset Tutorial",
        tutorialFarewellMessage: "I am leaving, but you can activate the tutorial anytime from the settings ;)",
        tutorialBtnOk: "OK",
        tutorialBtnOkExclaim: "OK!",
        tutorialStep0Message: "Hey!\\nWould you like me to briefly show you KoBar's features?",
        tutorialBtnYes: "Yes!",
        tutorialBtnTerminate: "Terminate",
        tutorialBtnLater: "Later",
        tutorialStep1Message: "You need to click the 'Notch' to access Notes, Settings, and Plugins.",
        tutorialBtnSkip: "Skip",
        tutorialStep2Message: "You can take quick notes here.",
        tutorialStep3Message: "You can access KoBar's settings using the button on the top right.",
        tutorialStep4Message: "You can personalize KoBar's appearance, shortcuts, and behaviors from the settings panel.",
        tutorialStep5Message: "You can add new features to KoBar and expand your workspace from the plugins tab.",
        tutorialStep6Message: "You can manage your installed plugins here. You have completed the tutorial!"
    },
    tr: {
        restartTutorial: "Tutorial'ı Yeniden Başlat",
        tutorialFarewellMessage: "Ben gidiyorum ama istediğin zaman settings'deki tutorial kısmından tutorial'ı aktifleştirebilirsin ;)",
        tutorialBtnOk: "Tamam",
        tutorialBtnOkExclaim: "Tamam!",
        tutorialStep0Message: "Hey!\\nKoBar'ın özelliklerinden kısaca bahsetmemi ister misin?",
        tutorialBtnYes: "Evet!",
        tutorialBtnTerminate: "Sonlandır",
        tutorialBtnLater: "Sonra",
        tutorialStep1Message: "Note, Ayarlar ve Pluginlere erişmek için 'Çentiğe' tıklaman gerekiyor.",
        tutorialBtnSkip: "Atla",
        tutorialStep2Message: "Burada hızlıca notlar alabilirsin",
        tutorialStep3Message: "KoBar'ın settings'ine sağ üstteki buton ile ulaşabilirsin",
        tutorialStep4Message: "Ayarlar panelinden KoBar'ın görünümünü, kısayollarını ve davranışlarını kişiselleştirebilirsin.",
        tutorialStep5Message: "Pluginler sekmesinden KoBar'a yeni özellikler ekleyebilir ve çalışma alanını genişletebilirsin.",
        tutorialStep6Message: "Burada yüklediğin eklentileri yönetebilirsin. Öğreticiyi tamamladın!"
    },
    de: {
        restartTutorial: "Tutorial zurücksetzen",
        tutorialFarewellMessage: "Ich gehe jetzt, aber du kannst das Tutorial jederzeit in den Einstellungen aktivieren ;)",
        tutorialBtnOk: "OK",
        tutorialBtnOkExclaim: "OK!",
        tutorialStep0Message: "Hey!\\nMöchtest du, dass ich dir kurz die Funktionen von KoBar zeige?",
        tutorialBtnYes: "Ja!",
        tutorialBtnTerminate: "Beenden",
        tutorialBtnLater: "Später",
        tutorialStep1Message: "Du musst auf die 'Kerbe' klicken, um auf Notizen, Einstellungen und Plugins zuzugreifen.",
        tutorialBtnSkip: "Überspringen",
        tutorialStep2Message: "Hier kannst du schnelle Notizen machen.",
        tutorialStep3Message: "Du kannst die Einstellungen von KoBar über die Schaltfläche oben rechts aufrufen.",
        tutorialStep4Message: "Im Einstellungsfeld kannst du das Erscheinungsbild, die Tastenkombinationen und das Verhalten von KoBar anpassen.",
        tutorialStep5Message: "Auf der Registerkarte Plugins kannst du KoBar neue Funktionen hinzufügen und deinen Arbeitsbereich erweitern.",
        tutorialStep6Message: "Hier kannst du deine installierten Plugins verwalten. Du hast das Tutorial abgeschlossen!"
    },
    fr: {
        restartTutorial: "Réinitialiser le tutoriel",
        tutorialFarewellMessage: "Je pars, mais vous pouvez activer le tutoriel à tout moment depuis les paramètres ;)",
        tutorialBtnOk: "OK",
        tutorialBtnOkExclaim: "OK !",
        tutorialStep0Message: "Hé !\\nVoulez-vous que je vous montre brièvement les fonctionnalités de KoBar ?",
        tutorialBtnYes: "Oui !",
        tutorialBtnTerminate: "Terminer",
        tutorialBtnLater: "Plus tard",
        tutorialStep1Message: "Vous devez cliquer sur l'Encoche pour accéder aux Notes, Paramètres et Plugins.",
        tutorialBtnSkip: "Passer",
        tutorialStep2Message: "Vous pouvez prendre des notes rapides ici.",
        tutorialStep3Message: "Vous pouvez accéder aux paramètres de KoBar à l'aide du bouton en haut à droite.",
        tutorialStep4Message: "Vous pouvez personnaliser l'apparence, les raccourcis et le comportement de KoBar depuis le panneau des paramètres.",
        tutorialStep5Message: "Vous pouvez ajouter de nouvelles fonctionnalités à KoBar et étendre votre espace de travail depuis l'onglet plugins.",
        tutorialStep6Message: "Vous pouvez gérer vos plugins installés ici. Vous avez terminé le tutoriel !"
    },
    es: {
        restartTutorial: "Restablecer tutorial",
        tutorialFarewellMessage: "Me voy, pero puedes activar el tutorial en cualquier momento desde la configuración ;)",
        tutorialBtnOk: "Aceptar",
        tutorialBtnOkExclaim: "¡Aceptar!",
        tutorialStep0Message: "¡Hola!\\n¿Te gustaría que te muestre brevemente las características de KoBar?",
        tutorialBtnYes: "¡Sí!",
        tutorialBtnTerminate: "Terminar",
        tutorialBtnLater: "Más tarde",
        tutorialStep1Message: "Debes hacer clic en la 'Muesca' para acceder a Notas, Configuración y Plugins.",
        tutorialBtnSkip: "Omitir",
        tutorialStep2Message: "Puedes tomar notas rápidas aquí.",
        tutorialStep3Message: "Puedes acceder a la configuración de KoBar usando el botón en la parte superior derecha.",
        tutorialStep4Message: "Puedes personalizar la apariencia, los atajos y el comportamiento de KoBar desde el panel de configuración.",
        tutorialStep5Message: "Puedes agregar nuevas funciones a KoBar y expandir tu espacio de trabajo desde la pestaña de plugins.",
        tutorialStep6Message: "Puedes gestionar tus plugins instalados aquí. ¡Has completado el tutorial!"
    },
    ru: {
        restartTutorial: "Сбросить обучение",
        tutorialFarewellMessage: "Я ухожу, но вы можете активировать обучение в любое время в настройках ;)",
        tutorialBtnOk: "ОК",
        tutorialBtnOkExclaim: "ОК!",
        tutorialStep0Message: "Привет!\\nХочешь, я кратко покажу тебе функции KoBar?",
        tutorialBtnYes: "Да!",
        tutorialBtnTerminate: "Завершить",
        tutorialBtnLater: "Позже",
        tutorialStep1Message: "Вам нужно нажать на 'Выемку', чтобы получить доступ к Заметкам, Настройкам и Плагинам.",
        tutorialBtnSkip: "Пропустить",
        tutorialStep2Message: "Здесь вы можете делать быстрые заметки.",
        tutorialStep3Message: "Вы можете получить доступ к настройкам KoBar с помощью кнопки в правом верхнем углу.",
        tutorialStep4Message: "Вы можете настроить внешний вид, сочетания клавиш и поведение KoBar в панели настроек.",
        tutorialStep5Message: "Вы можете добавить новые функции в KoBar и расширить свое рабочее пространство на вкладке плагинов.",
        tutorialStep6Message: "Здесь вы можете управлять установленными плагинами. Вы завершили обучение!"
    },
    ar: {
        restartTutorial: "إعادة تعيين البرنامج التعليمي",
        tutorialFarewellMessage: "سأغادر، ولكن يمكنك تنشيط البرنامج التعليمي في أي وقت من الإعدادات ;)",
        tutorialBtnOk: "حسناً",
        tutorialBtnOkExclaim: "حسناً!",
        tutorialStep0Message: "مرحباً!\\nهل ترغب في أن أعرض لك ميزات KoBar باختصار؟",
        tutorialBtnYes: "نعم!",
        tutorialBtnTerminate: "إنهاء",
        tutorialBtnLater: "لاحقاً",
        tutorialStep1Message: "تحتاج إلى النقر على 'الشق' للوصول إلى الملاحظات والإعدادات والإضافات.",
        tutorialBtnSkip: "تخطي",
        tutorialStep2Message: "يمكنك تدوين ملاحظات سريعة هنا.",
        tutorialStep3Message: "يمكنك الوصول إلى إعدادات KoBar باستخدام الزر الموجود في أعلى اليمين.",
        tutorialStep4Message: "يمكنك تخصيص مظهر KoBar واختصاراته وسلوكياته من لوحة الإعدادات.",
        tutorialStep5Message: "يمكنك إضافة ميزات جديدة إلى KoBar وتوسيع مساحة عملك من علامة تبويب الإضافات.",
        tutorialStep6Message: "يمكنك إدارة إضافاتك المثبتة هنا. لقد أكملت البرنامج التعليمي!"
    },
    zh: {
        restartTutorial: "重置教程",
        tutorialFarewellMessage: "我先走了，但你可以随时从设置中激活教程 ;)",
        tutorialBtnOk: "确定",
        tutorialBtnOkExclaim: "确定！",
        tutorialStep0Message: "嘿！\\n你想让我简单向你展示KoBar的功能吗？",
        tutorialBtnYes: "是的！",
        tutorialBtnTerminate: "终止",
        tutorialBtnLater: "稍后",
        tutorialStep1Message: "你需要点击“缺口”来访问笔记、设置和插件。",
        tutorialBtnSkip: "跳过",
        tutorialStep2Message: "你可以从这里快速记笔记。",
        tutorialStep3Message: "你可以使用右上角的按钮访问KoBar的设置。",
        tutorialStep4Message: "你可以从设置面板个性化KoBar的外观、快捷键和行为。",
        tutorialStep5Message: "你可以从插件选项卡向KoBar添加新功能并扩展你的工作区。",
        tutorialStep6Message: "你可以从这里管理你安装的插件。你已完成教程！"
    },
    ja: {
        restartTutorial: "チュートリアルをリセット",
        tutorialFarewellMessage: "私は行きますが、設定からいつでもチュートリアルを有効にできます ;)",
        tutorialBtnOk: "OK",
        tutorialBtnOkExclaim: "OK!",
        tutorialStep0Message: "こんにちは！\\nKoBarの機能を簡単に紹介しましょうか？",
        tutorialBtnYes: "はい！",
        tutorialBtnTerminate: "終了",
        tutorialBtnLater: "後で",
        tutorialStep1Message: "メモ、設定、プラグインにアクセスするには、「ノッチ」をクリックする必要があります。",
        tutorialBtnSkip: "スキップ",
        tutorialStep2Message: "ここで簡単なメモを取ることができます。",
        tutorialStep3Message: "右上のボタンを使用してKoBarの設定にアクセスできます。",
        tutorialStep4Message: "設定パネルからKoBarの外観、ショートカット、動作をパーソナライズできます。",
        tutorialStep5Message: "プラグインタブからKoBarに新機能を追加し、ワークスペースを拡張できます。",
        tutorialStep6Message: "ここでインストールされたプラグインを管理できます。チュートリアルを完了しました！"
    },
    hi: {
        restartTutorial: "ट्यूटोरियल रीसेट करें",
        tutorialFarewellMessage: "मैं जा रहा हूँ, लेकिन आप सेटिंग से किसी भी समय ट्यूटोरियल को सक्रिय कर सकते हैं ;)",
        tutorialBtnOk: "ठीक है",
        tutorialBtnOkExclaim: "ठीक है!",
        tutorialStep0Message: "नमस्ते!\\nक्या आप चाहेंगे कि मैं आपको संक्षेप में KoBar की विशेषताएं दिखाऊं?",
        tutorialBtnYes: "हाँ!",
        tutorialBtnTerminate: "समाप्त करें",
        tutorialBtnLater: "बाद में",
        tutorialStep1Message: "नोट्स, सेटिंग्स और प्लगइन्स तक पहुंचने के लिए आपको 'नॉच' पर क्लिक करना होगा।",
        tutorialBtnSkip: "छोड़ें",
        tutorialStep2Message: "आप यहां त्वरित नोट्स ले सकते हैं।",
        tutorialStep3Message: "आप शीर्ष दाईं ओर स्थित बटन का उपयोग करके KoBar की सेटिंग्स तक पहुंच सकते हैं।",
        tutorialStep4Message: "आप सेटिंग्स पैनल से KoBar की उपस्थिति, शॉर्टकट और व्यवहार को वैयक्तिकृत कर सकते हैं।",
        tutorialStep5Message: "आप प्लगइन्स टैब से KoBar में नई सुविधाएँ जोड़ सकते हैं और अपने कार्यक्षेत्र का विस्तार कर सकते हैं।",
        tutorialStep6Message: "आप अपने इंस्टॉल किए गए प्लगइन्स को यहां प्रबंधित कर सकते हैं। आपने ट्यूटोरियल पूरा कर लिया है!"
    }
};

Object.keys(translationsToAdd).forEach(lang => {
    const langObj = translationsToAdd[lang];
    const additions = Object.entries(langObj)
        .map(([k, v]) => `        ${k}: "${v.replace(/\\n/g, '\\\\n').replace(/"/g, '\\"')}",`)
        .join('\\n');
        
    // Find the exportDataDesc line for this language by replacing the text block
    const regex = new RegExp(`(^\\s*${lang}: \\{[\\s\\S]*?exportDataDesc: ".*?",?)`, 'm');
    text = text.replace(regex, `$1\\n${additions}`);
});

fs.writeFileSync(filePath, text, 'utf8');
console.log('Done!');
