(function() {
  "use strict";
  const React = window.React;
  const useAppStore = window.useAppStore;
  const TRANSLATIONS = {
    en: {
      focusMode: "Focus Mode",
      minutes: "Minutes",
      seconds: "Seconds",
      loop: "Loop",
      start: "Start",
      stop: "Stop",
      focusModeFinished: "Focus Mode Finished",
      focusModeFinishedDesc: "Your focus session has ended. Take a break!"
    },
    tr: {
      focusMode: "Odak Modu",
      minutes: "Dakika",
      seconds: "Saniye",
      loop: "Döngü",
      start: "Başlat",
      stop: "Durdur",
      focusModeFinished: "Odaklanma Modu Bitti",
      focusModeFinishedDesc: "Odaklanma süreniz doldu. Biraz ara verin!"
    },
    de: {
      focusMode: "Fokus-Modus",
      minutes: "Minuten",
      seconds: "Sekunden",
      loop: "Schleife",
      start: "Starten",
      stop: "Stoppen",
      focusModeFinished: "Fokus-Modus beendet",
      focusModeFinishedDesc: "Ihre Fokus-Sitzung ist beendet. Machen Sie eine Pause!"
    },
    fr: {
      focusMode: "Mode Concentration",
      minutes: "Minutes",
      seconds: "Secondes",
      loop: "Boucle",
      start: "Démarrer",
      stop: "Arrêter",
      focusModeFinished: "Mode Concentration Terminé",
      focusModeFinishedDesc: "Votre session de concentration est terminée. Faites une pause !"
    },
    es: {
      focusMode: "Modo Concentración",
      minutes: "Minutos",
      seconds: "Segundos",
      loop: "Bucle",
      start: "Iniciar",
      stop: "Detener",
      focusModeFinished: "Modo Concentración Finalizado",
      focusModeFinishedDesc: "Tu sesión de concentración ha terminado. ¡Toma un descanso!"
    },
    zh: {
      focusMode: "专注模式",
      minutes: "分钟",
      seconds: "秒",
      loop: "循环",
      start: "开始",
      stop: "停止",
      focusModeFinished: "专注模式结束",
      focusModeFinishedDesc: "您的专注时间已结束。休息一下吧！"
    },
    ja: {
      focusMode: "集中モード",
      minutes: "分",
      seconds: "秒",
      loop: "ループ",
      start: "開始",
      stop: "停止",
      focusModeFinished: "集中モード終了",
      focusModeFinishedDesc: "集中セッションが終了しました。休憩してください！"
    },
    ru: {
      focusMode: "Режим фокуса",
      minutes: "Минуты",
      seconds: "Секунды",
      loop: "Цикл",
      start: "Старт",
      stop: "Стоп",
      focusModeFinished: "Режим фокуса завершен",
      focusModeFinishedDesc: "Ваш сеанс фокусировки завершен. Сделайте перерыв!"
    },
    ar: {
      focusMode: "وضع التركيز",
      minutes: "دقائق",
      seconds: "ثواني",
      loop: "تكرار",
      start: "ابدأ",
      stop: "إيقاف",
      focusModeFinished: "انتهى وضع التركيز",
      focusModeFinishedDesc: "انتهت جلسة التركيز الخاصة بك. خذ استراحة!"
    },
    hi: {
      focusMode: "फोकस मोड",
      minutes: "मिनट",
      seconds: "सेकंड",
      loop: "लूप",
      start: "प्रारंभ",
      stop: "रोकें",
      focusModeFinished: "फोकस मोड समाप्त",
      focusModeFinishedDesc: "आपका फोकस सत्र समाप्त हो गया है। ब्रेक लें!"
    }
  };
  const getLocalText = (key) => {
    const lang = useAppStore.getState().language || "en";
    const dict = TRANSLATIONS[lang] || TRANSLATIONS["en"];
    return dict[key] || key;
  };
  class FocusStore {
    constructor() {
      this.state = {
        isFocusPopupOpen: false,
        focusAnchorRect: null,
        focusSettings: { minutes: 25, seconds: 0, melody: "Calming", loop: false },
        isFocusActive: false,
        focusRemainingTime: 0,
        isAlarmRinging: false
      };
      this.listeners = /* @__PURE__ */ new Set();
      this.interval = null;
      this.alarmAudio = null;
    }
    getState() {
      return this.state;
    }
    setState(partial) {
      this.state = { ...this.state, ...partial };
      this.notify();
    }
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    notify() {
      for (const listener of this.listeners) {
        listener();
      }
    }
    startTimer() {
      const total = this.state.focusSettings.minutes * 60 + this.state.focusSettings.seconds;
      if (total > 0) {
        this.setState({ isFocusActive: true, focusRemainingTime: total, isAlarmRinging: false });
        this.stopAlarm();
        if (this.interval) clearInterval(this.interval);
        let lastTime = total;
        this.interval = setInterval(() => {
          const current = this.state.focusRemainingTime;
          if (current <= 1) {
            this.setState({ focusRemainingTime: 0 });
            if (this.state.isFocusActive && lastTime > 0 && this.state.focusRemainingTime === 0) {
              this.triggerAlarm();
              this.sendNotification();
              this.setState({ isFocusActive: false });
            }
          } else {
            this.setState({ focusRemainingTime: current - 1 });
          }
          lastTime = this.state.focusRemainingTime;
        }, 1e3);
      }
    }
    stopTimer() {
      if (this.interval) clearInterval(this.interval);
      this.setState({ isFocusActive: false, focusRemainingTime: 0 });
      this.stopAlarm();
    }
    async triggerAlarm() {
      try {
        const base64 = await window.api?.getMelodyAudio("Alarm");
        if (base64) {
          if (!this.alarmAudio) {
            this.alarmAudio = new Audio();
          }
          this.alarmAudio.src = `${base64}`;
          this.alarmAudio.loop = this.state.focusSettings.loop;
          this.alarmAudio.load();
          this.alarmAudio.play();
          this.setState({ isAlarmRinging: true });
        }
      } catch (e) {
        console.error("Alarm play error", e);
      }
    }
    stopAlarm() {
      if (this.alarmAudio) {
        this.alarmAudio.pause();
        this.alarmAudio.currentTime = 0;
      }
      this.setState({ isAlarmRinging: false });
    }
    sendNotification() {
      const title = getLocalText("focusModeFinished");
      const desc = getLocalText("focusModeFinishedDesc");
      window.api?.sendNotification?.(title, desc);
    }
  }
  const focusStore = new FocusStore();
  function useFocusStore() {
    const [state, setState] = React.useState(focusStore.getState());
    React.useEffect(() => {
      return focusStore.subscribe(() => setState(focusStore.getState()));
    }, []);
    return state;
  }
  const TooltipButton = ({ label, onClick, className, style, children, buttonRef }) => {
    return /* @__PURE__ */ window.React.createElement(
      "button",
      {
        ref: buttonRef,
        onClick,
        className: `group relative ${className}`,
        style,
        title: label
      },
      children
    );
  };
  const FocusButtonWidget = () => {
    const store = useFocusStore();
    const [lang, setLang] = React.useState(() => useAppStore.getState().language);
    React.useEffect(() => {
      return useAppStore.subscribe((state) => {
        setLang(state.language);
      });
    }, []);
    const t = getLocalText;
    const buttonRef = React.useRef(null);
    const formatTime = (totalSeconds) => {
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };
    const handleMainButtonClick = (e) => {
      if (store.isAlarmRinging) {
        focusStore.stopAlarm();
        return;
      }
      const rect = buttonRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
      focusStore.setState({
        focusAnchorRect: rect,
        isFocusPopupOpen: !store.isFocusPopupOpen
      });
    };
    return /* @__PURE__ */ window.React.createElement("div", { className: "relative group flex items-center justify-center w-full no-drag-region" }, /* @__PURE__ */ window.React.createElement(
      TooltipButton,
      {
        buttonRef,
        onClick: handleMainButtonClick,
        className: `p-1.5 transition-colors relative flex items-center justify-center w-12 h-12 rounded-full transition-all active:scale-95 shadow-lg focus-trigger-btn
                    ${store.isAlarmRinging ? "animate-[pulse_1s_ease-in-out_infinite] bg-red-500/30 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]" : store.isFocusPopupOpen ? "bg-primary/20 text-primary border border-primary/50 scale-110" : "bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10 hover:scale-110"}
                `,
        label: t("focusMode"),
        style: { borderWidth: store.isFocusPopupOpen ? "1px" : "0px" }
      },
      store.isFocusActive ? /* @__PURE__ */ window.React.createElement("span", { className: "text-xs font-bold text-primary tracking-wider" }, formatTime(store.focusRemainingTime)) : /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[20px]" }, "hourglass_empty")
    ));
  };
  window.KoBarExtensions.registerInlineWidget("focus-mode-plugin-btn", {
    id: "focus-mode-plugin-btn",
    render: () => React.createElement(FocusButtonWidget)
  });
  const MELODIES = ["Alarm", "Bells", "Calming", "Cosmic", "Guitar", "Hiphop", "Ringtones"];
  const FocusPopupWidget = ({ onClose, anchorRect }) => {
    const store = useFocusStore();
    const [appState, setAppState] = React.useState(() => {
      const s = useAppStore.getState();
      return {
        language: s.language,
        screenBounds: s.screenBounds,
        sidebarPosition: s.sidebarPosition,
        orientation: s.orientation,
        isPopupSmartPositioning: s.isPopupSmartPositioning,
        edgePosition: s.edgePosition
      };
    });
    React.useEffect(() => {
      return useAppStore.subscribe((state) => {
        setAppState({
          language: state.language,
          screenBounds: state.screenBounds,
          sidebarPosition: state.sidebarPosition,
          orientation: state.orientation,
          isPopupSmartPositioning: state.isPopupSmartPositioning,
          edgePosition: state.edgePosition
        });
      });
    }, []);
    const t = getLocalText;
    const [isPlayingPreview, setIsPlayingPreview] = React.useState(false);
    const [melodyDropdownOpen, setMelodyDropdownOpen] = React.useState(false);
    const audioPreviewRef = React.useRef(null);
    const [localMin, setLocalMin] = React.useState(store.focusSettings.minutes);
    const [localSec, setLocalSec] = React.useState(store.focusSettings.seconds);
    const [localMelody, setLocalMelody] = React.useState(store.focusSettings.melody);
    const [localLoop, setLocalLoop] = React.useState(store.focusSettings.loop);
    const popupRef = React.useRef(null);
    const stopPreview = () => {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        audioPreviewRef.current.currentTime = 0;
      }
      setIsPlayingPreview(false);
    };
    const togglePreview = async () => {
      if (isPlayingPreview) {
        stopPreview();
        return;
      }
      try {
        const base64 = await window.api?.getMelodyAudio(localMelody);
        if (base64) {
          if (!audioPreviewRef.current) {
            audioPreviewRef.current = new Audio();
          }
          audioPreviewRef.current.src = `${base64}`;
          audioPreviewRef.current.load();
          audioPreviewRef.current.play();
          setIsPlayingPreview(true);
          audioPreviewRef.current.onended = () => setIsPlayingPreview(false);
        }
      } catch (e) {
        console.error("Preview error", e);
      }
    };
    const handleStart = () => {
      focusStore.setState({
        focusSettings: {
          minutes: localMin,
          seconds: localSec,
          melody: localMelody,
          loop: localLoop
        }
      });
      stopPreview();
      focusStore.startTimer();
      onClose();
    };
    React.useEffect(() => {
      if (!store.isFocusActive) {
        setLocalMin(store.focusSettings.minutes);
        setLocalSec(store.focusSettings.seconds);
        setLocalMelody(store.focusSettings.melody);
        setLocalLoop(store.focusSettings.loop);
      }
    }, [store.isFocusActive, store.focusSettings]);
    React.useEffect(() => {
      const handleClickOutside = (e) => {
        if (popupRef.current && !popupRef.current.contains(e.target)) {
          if (!e.target.closest(".focus-trigger-btn")) {
            onClose();
          }
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);
    const getPopupStyle = () => {
      if (!anchorRect) return { display: "none" };
      const popupHeight = 280;
      const popupWidth = 256;
      const screenHeight = appState.screenBounds?.height ?? 800;
      const screenWidth = appState.screenBounds?.width ?? 1200;
      const offsetTop = appState.sidebarPosition ? appState.sidebarPosition.y : 0;
      const offsetLeft = appState.sidebarPosition ? appState.sidebarPosition.x : 0;
      const style = {
        position: "absolute",
        zIndex: 99999,
        backgroundColor: "var(--theme-surface)",
        borderColor: "var(--theme-border)",
        willChange: "transform, opacity",
        transitionProperty: "opacity, transform, filter"
      };
      const screenXInViewport = (appState.screenBounds?.x ?? 0) - window.screenX;
      const screenYInViewport = (appState.screenBounds?.y ?? 0) - window.screenY;
      if (appState.orientation === "horizontal") {
        let adjustedLeft = anchorRect.left - offsetLeft + anchorRect.width / 2 - popupWidth / 2;
        const maxLeft = screenXInViewport + (screenWidth - offsetLeft) - popupWidth - 20;
        const minLeft = screenXInViewport - offsetLeft + 20;
        if (adjustedLeft < minLeft) adjustedLeft = minLeft;
        if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
        if (!appState.isPopupSmartPositioning) {
          style.left = "50%";
          style.transform = "translateX(-50%)";
        } else {
          style.left = adjustedLeft;
        }
        if (appState.edgePosition === "top") {
          style.top = "100%";
          style.marginTop = "12px";
        } else {
          style.bottom = "100%";
          style.marginBottom = "12px";
        }
      } else {
        let adjustedTop = anchorRect.top - offsetTop - 20 + anchorRect.height / 2 - popupHeight / 2;
        const maxTop = screenYInViewport + (screenHeight - offsetTop) - popupHeight - 20;
        const minTop = screenYInViewport - offsetTop + 20;
        if (adjustedTop < minTop) adjustedTop = minTop;
        if (adjustedTop > maxTop) adjustedTop = maxTop;
        if (!appState.isPopupSmartPositioning) {
          style.top = "50%";
          style.transform = "translateY(-50%)";
        } else {
          style.top = adjustedTop;
        }
        if (appState.edgePosition === "left") {
          style.left = "100%";
          style.marginLeft = "12px";
        } else {
          style.right = "100%";
          style.marginRight = "12px";
        }
      }
      return style;
    };
    const isSmartRef = React.useRef(appState.isPopupSmartPositioning);
    React.useEffect(() => {
      isSmartRef.current = appState.isPopupSmartPositioning;
    }, [appState.isPopupSmartPositioning]);
    React.useEffect(() => {
      const onDrag = (e) => {
        if (!popupRef.current || !anchorRect || !isSmartRef.current) return;
        const newX = e.detail.x;
        const newY = e.detail.y;
        const popupHeight = 280;
        const popupWidth = 256;
        const screenXInViewport = (appState.screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (appState.screenBounds?.y ?? 0) - window.screenY;
        if (appState.orientation === "horizontal") {
          const screenWidth = appState.screenBounds?.width ?? 1200;
          let adjustedLeft = anchorRect.left - newX + anchorRect.width / 2 - popupWidth / 2;
          const maxLeft = screenXInViewport + (screenWidth - newX) - popupWidth - 20;
          const minLeft = screenXInViewport - newX + 20;
          if (adjustedLeft < minLeft) adjustedLeft = minLeft;
          if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
          popupRef.current.style.left = `${adjustedLeft}px`;
        } else {
          const screenHeight = appState.screenBounds?.height ?? 800;
          let adjustedTop = anchorRect.top - newY - 20 + anchorRect.height / 2 - popupHeight / 2;
          const maxTop = screenYInViewport + (screenHeight - newY) - popupHeight - 20;
          const minTop = screenYInViewport - newY + 20;
          if (adjustedTop < minTop) adjustedTop = minTop;
          if (adjustedTop > maxTop) adjustedTop = maxTop;
          popupRef.current.style.top = `${adjustedTop}px`;
        }
      };
      document.addEventListener("kobar-drag", onDrag);
      return () => document.removeEventListener("kobar-drag", onDrag);
    }, [anchorRect, appState.screenBounds, appState.orientation]);
    return /* @__PURE__ */ window.React.createElement(
      "div",
      {
        ref: popupRef,
        className: "w-64 rounded-xl border p-4 shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-visible",
        style: getPopupStyle()
      },
      /* @__PURE__ */ window.React.createElement("div", { className: "flex justify-between items-center mb-4" }, /* @__PURE__ */ window.React.createElement("h3", { className: "text-primary font-bold" }, t("focusMode")), /* @__PURE__ */ window.React.createElement("button", { onClick: onClose, className: "text-slate-400 hover:text-white transition-colors" }, /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "close"))),
      /* @__PURE__ */ window.React.createElement("div", { className: "flex gap-4 mb-4" }, /* @__PURE__ */ window.React.createElement("div", { className: "flex-1" }, /* @__PURE__ */ window.React.createElement("label", { className: "text-xs text-slate-400 mb-1 block" }, t("minutes")), /* @__PURE__ */ window.React.createElement("div", { className: "flex items-center border rounded overflow-hidden", style: { borderColor: "var(--theme-border)" } }, /* @__PURE__ */ window.React.createElement(
        "button",
        {
          type: "button",
          disabled: store.isFocusActive || localMin <= 0,
          onClick: () => setLocalMin((m) => Math.max(0, m - 1)),
          className: "px-2 py-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[14px]" }, "remove")
      ), /* @__PURE__ */ window.React.createElement(
        "input",
        {
          type: "number",
          disabled: store.isFocusActive,
          value: localMin,
          onChange: (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val)) val = 0;
            setLocalMin(Math.min(120, Math.max(0, val)));
          },
          className: "flex-1 w-full text-center text-slate-200 text-sm py-1 tabular-nums bg-transparent outline-none focus:bg-primary/10 transition-colors disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none no-drag-region"
        }
      ), /* @__PURE__ */ window.React.createElement(
        "button",
        {
          type: "button",
          disabled: store.isFocusActive || localMin >= 120,
          onClick: () => setLocalMin((m) => Math.min(120, m + 1)),
          className: "px-2 py-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[14px]" }, "add")
      ))), /* @__PURE__ */ window.React.createElement("div", { className: "flex-1" }, /* @__PURE__ */ window.React.createElement("label", { className: "text-xs text-slate-400 mb-1 block" }, t("seconds")), /* @__PURE__ */ window.React.createElement("div", { className: "flex items-center border rounded overflow-hidden", style: { borderColor: "var(--theme-border)" } }, /* @__PURE__ */ window.React.createElement(
        "button",
        {
          type: "button",
          disabled: store.isFocusActive || localSec <= 0,
          onClick: () => setLocalSec((s) => Math.max(0, s - 1)),
          className: "px-2 py-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[14px]" }, "remove")
      ), /* @__PURE__ */ window.React.createElement(
        "input",
        {
          type: "number",
          disabled: store.isFocusActive,
          value: localSec,
          onChange: (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val)) val = 0;
            setLocalSec(Math.min(59, Math.max(0, val)));
          },
          className: "flex-1 w-full text-center text-slate-200 text-sm py-1 tabular-nums bg-transparent outline-none focus:bg-primary/10 transition-colors disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none no-drag-region"
        }
      ), /* @__PURE__ */ window.React.createElement(
        "button",
        {
          type: "button",
          disabled: store.isFocusActive || localSec >= 59,
          onClick: () => setLocalSec((s) => Math.min(59, s + 1)),
          className: "px-2 py-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[14px]" }, "add")
      )))),
      /* @__PURE__ */ window.React.createElement("div", { className: "mb-4" }, /* @__PURE__ */ window.React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ window.React.createElement("div", { className: "flex-1 relative" }, /* @__PURE__ */ window.React.createElement(
        "button",
        {
          type: "button",
          onClick: () => !store.isFocusActive && setMelodyDropdownOpen(!melodyDropdownOpen),
          disabled: store.isFocusActive,
          className: "w-full bg-black/20 border rounded px-2 py-1.5 text-slate-200 text-left flex items-center justify-between disabled:opacity-50 cursor-pointer hover:border-primary/50 transition-colors",
          style: { borderColor: "var(--theme-border)" }
        },
        /* @__PURE__ */ window.React.createElement("span", null, localMelody),
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[16px] text-slate-400" }, melodyDropdownOpen ? "expand_less" : "expand_more")
      ), melodyDropdownOpen && /* @__PURE__ */ window.React.createElement(
        "div",
        {
          className: "absolute top-full left-0 w-full mt-1 rounded border shadow-xl overflow-y-auto",
          style: { backgroundColor: "var(--theme-surface)", borderColor: "var(--theme-border)", zIndex: 1e4 }
        },
        MELODIES.map((m) => /* @__PURE__ */ window.React.createElement(
          "button",
          {
            key: m,
            type: "button",
            onClick: () => {
              setLocalMelody(m);
              setMelodyDropdownOpen(false);
              stopPreview();
            },
            className: `w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-primary/20 ${m === localMelody ? "text-primary font-semibold bg-primary/10" : "text-slate-300"}`
          },
          m
        ))
      )), /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: togglePreview,
          disabled: store.isFocusActive,
          className: "w-8 h-8 flex items-center justify-center rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 border border-primary/30"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, isPlayingPreview ? "stop" : "play_arrow")
      ))),
      /* @__PURE__ */ window.React.createElement("div", { className: "flex items-center justify-between mb-6" }, /* @__PURE__ */ window.React.createElement("span", { className: "text-sm text-slate-300 font-medium" }, t("loop")), /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: () => !store.isFocusActive && setLocalLoop(!localLoop),
          disabled: store.isFocusActive,
          className: `w-11 h-6 rounded-full transition-colors relative flex items-center border border-black/20 disabled:opacity-50 no-drag-region ${localLoop ? "bg-primary" : "bg-slate-600"}`
        },
        /* @__PURE__ */ window.React.createElement("div", { className: `w-4 h-4 rounded-full bg-white shadow-sm absolute transition-transform ${localLoop ? "translate-x-[22px]" : "translate-x-[4px]"}` })
      )),
      store.isFocusActive ? /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: () => {
            focusStore.stopTimer();
            onClose();
          },
          className: "w-full py-2 rounded-lg font-bold transition-all active:scale-95 bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
        },
        t("stop")
      ) : /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: handleStart,
          disabled: localMin === 0 && localSec === 0,
          className: "w-full py-2 rounded-lg font-bold transition-all active:scale-95 bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
        },
        t("start")
      )
    );
  };
  window.KoBarExtensions.registerPanel("focus-mode-plugin-panel", {
    id: "focus-mode-plugin-panel",
    render: (props) => React.createElement(FocusPopupWidget, props)
  });
  focusStore.subscribe(() => {
    const state = focusStore.getState();
    const appState = useAppStore.getState();
    if (state.isFocusPopupOpen && appState.activeExtensionPanelId !== "focus-mode-plugin-panel") {
      appState.closeAllUtilityPopups?.();
      useAppStore.setState({
        activeExtensionPanelId: "focus-mode-plugin-panel",
        activeExtensionAnchorRect: state.focusAnchorRect
      });
    } else if (!state.isFocusPopupOpen && appState.activeExtensionPanelId === "focus-mode-plugin-panel") {
      useAppStore.setState({
        activeExtensionPanelId: null
      });
    }
  });
  useAppStore.subscribe((state, prevState) => {
    if (prevState.activeExtensionPanelId === "focus-mode-plugin-panel" && state.activeExtensionPanelId !== "focus-mode-plugin-panel") {
      if (focusStore.getState().isFocusPopupOpen) {
        focusStore.setState({ isFocusPopupOpen: false });
      }
    }
  });
})();
