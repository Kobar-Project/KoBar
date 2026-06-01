(function(react) {
  "use strict";
  const useAppStore = window.useAppStore;
  const TRANSLATIONS = {
    en: {
      noMediaPlaying: "No media playing",
      playSomething: "Play something in Spotify, YouTube, or any media player",
      unknownArtist: "Unknown Artist",
      detectedYouTubeTabs: "Detected YouTube Tabs",
      pasteVideoUrl: "Paste a video URL:",
      openBtn: "Open",
      cancelBtn: "Cancel",
      pipVideo: "PIP Video",
      closePip: "Close PIP",
      videoDetected: "Video detected — open in PiP",
      openPipTooltip: "Open video in Picture-in-Picture"
    },
    tr: {
      noMediaPlaying: "Medya oynatılmıyor",
      playSomething: "Spotify, YouTube veya herhangi bir oynatıcıdan bir şeyler açın",
      unknownArtist: "Bilinmeyen Sanatçı",
      detectedYouTubeTabs: "Algılanan YouTube Sekmeleri",
      pasteVideoUrl: "Bir video URL'si yapıştırın:",
      openBtn: "Aç",
      cancelBtn: "İptal",
      pipVideo: "PIP Video",
      closePip: "PIP Kapat",
      videoDetected: "Video algılandı — PiP'te aç",
      openPipTooltip: "Videoyu Resim-İçinde-Resim modunda aç"
    },
    de: {
      noMediaPlaying: "Keine Medienwiedergabe",
      playSomething: "Spielen Sie etwas in Spotify, YouTube oder einem Mediaplayer ab",
      unknownArtist: "Unbekannter Künstler",
      detectedYouTubeTabs: "Erkannte YouTube-Tabs",
      pasteVideoUrl: "Fügen Sie eine Video-URL ein:",
      openBtn: "Öffnen",
      cancelBtn: "Abbrechen",
      pipVideo: "PIP Video",
      closePip: "PIP schließen",
      videoDetected: "Video erkannt — in PiP öffnen",
      openPipTooltip: "Video in Bild-in-Bild öffnen"
    },
    ar: {
      noMediaPlaying: "لا يوجد وسائط قيد التشغيل",
      playSomething: "قم بتشغيل شيء من Spotify أو YouTube أو أي مشغل",
      unknownArtist: "فنان غير معروف",
      detectedYouTubeTabs: "علامات تبويب YouTube المكتشفة",
      pasteVideoUrl: "ألصق رابط فيديو:",
      openBtn: "فتح",
      cancelBtn: "إلغاء",
      pipVideo: "فيديو PIP",
      closePip: "إغلاق PIP",
      videoDetected: "تم اكتشاف فيديو — فتح في PiP",
      openPipTooltip: "فتح الفيديو في وضع صورة داخل صورة"
    },
    zh: {
      noMediaPlaying: "没有播放媒体",
      playSomething: "在 Spotify、YouTube 或任何媒体播放器中播放内容",
      unknownArtist: "未知艺术家",
      detectedYouTubeTabs: "检测到的 YouTube 标签页",
      pasteVideoUrl: "粘贴视频 URL：",
      openBtn: "打开",
      cancelBtn: "取消",
      pipVideo: "画中画视频",
      closePip: "关闭画中画",
      videoDetected: "检测到视频 — 在画中画中打开",
      openPipTooltip: "在画中画中打开视频"
    },
    fr: {
      noMediaPlaying: "Aucun média en cours",
      playSomething: "Lisez quelque chose sur Spotify, YouTube ou tout autre lecteur",
      unknownArtist: "Artiste inconnu",
      detectedYouTubeTabs: "Onglets YouTube détectés",
      pasteVideoUrl: "Collez une URL de vidéo :",
      openBtn: "Ouvrir",
      cancelBtn: "Annuler",
      pipVideo: "Vidéo PIP",
      closePip: "Fermer PIP",
      videoDetected: "Vidéo détectée — ouvrir en PiP",
      openPipTooltip: "Ouvrir la vidéo en mode Image dans l'image"
    },
    hi: {
      noMediaPlaying: "कोई मीडिया नहीं चल रहा है",
      playSomething: "Spotify, YouTube या किसी मीडिया प्लेयर में कुछ चलाएं",
      unknownArtist: "अज्ञात कलाकार",
      detectedYouTubeTabs: "पता लगाए गए YouTube टैब",
      pasteVideoUrl: "वीडियो URL पेस्ट करें:",
      openBtn: "खोलें",
      cancelBtn: "रद्द करें",
      pipVideo: "पीआईपी वीडियो",
      closePip: "पीआईपी बंद करें",
      videoDetected: "वीडियो का पता चला - PiP में खोलें",
      openPipTooltip: "पिक्चर-इन-पिक्चर में वीडियो खोलें"
    },
    es: {
      noMediaPlaying: "No se reproduce multimedia",
      playSomething: "Reproduce algo en Spotify, YouTube o cualquier reproductor",
      unknownArtist: "Artista desconocido",
      detectedYouTubeTabs: "Pestañas de YouTube detectadas",
      pasteVideoUrl: "Pega una URL de video:",
      openBtn: "Abrir",
      cancelBtn: "Cancelar",
      pipVideo: "Video PIP",
      closePip: "Cerrar PIP",
      videoDetected: "Video detectado — abrir en PiP",
      openPipTooltip: "Abrir video en Picture-in-Picture"
    },
    ja: {
      noMediaPlaying: "メディアが再生されていません",
      playSomething: "Spotify、YouTube、またはメディアプレーヤーで何かを再生",
      unknownArtist: "不明なアーティスト",
      detectedYouTubeTabs: "検出された YouTube タブ",
      pasteVideoUrl: "動画のURLを貼り付け：",
      openBtn: "開く",
      cancelBtn: "キャンセル",
      pipVideo: "PIPビデオ",
      closePip: "PIPを閉じる",
      videoDetected: "動画を検出しました — PiPで開く",
      openPipTooltip: "ピクチャーインピクチャーで動画を開く"
    },
    ru: {
      noMediaPlaying: "Нет воспроизводимого медиа",
      playSomething: "Включите что-нибудь в Spotify, YouTube или другом плеере",
      unknownArtist: "Неизвестный исполнитель",
      detectedYouTubeTabs: "Обнаруженные вкладки YouTube",
      pasteVideoUrl: "Вставьте URL видео:",
      openBtn: "Открыть",
      cancelBtn: "Отмена",
      pipVideo: "PIP Видео",
      closePip: "Закрыть PIP",
      videoDetected: "Видео обнаружено — открыть в PiP",
      openPipTooltip: "Открыть видео в режиме 'Картинка в картинке'"
    }
  };
  function urlShortLabel(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      if (host.includes("youtube") || host === "youtu.be") return `▶ YouTube: ${u.searchParams.get("v") || u.pathname.slice(1)}`;
      if (host.includes("youtu.be")) return `▶ YouTube: ${u.pathname.slice(1)}`;
      return `▶ ${host}${u.pathname.length > 1 ? u.pathname.slice(0, 24) : ""}`;
    } catch {
      return url.slice(0, 36);
    }
  }
  const DetectedTabItem = ({ url, onPick }) => {
    const [title, setTitle] = react.useState(null);
    const [thumbnail, setThumbnail] = react.useState(null);
    react.useEffect(() => {
      let isMounted = true;
      let videoId = null;
      try {
        const u = new URL(url);
        videoId = u.searchParams.get("v") || (u.hostname.includes("youtu.be") ? u.pathname.slice(1) : null);
        if (videoId && isMounted) {
          setThumbnail(`https://i.ytimg.com/vi/${videoId}/default.jpg`);
        }
      } catch {
      }
      const fetchMeta = async () => {
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
          const res = await fetch(oembedUrl);
          if (!res.ok) throw new Error("oEmbed failed");
          const data = await res.json();
          if (isMounted) {
            setTitle(data.title);
            if (data.thumbnail_url) setThumbnail(data.thumbnail_url);
          }
        } catch (e) {
        }
      };
      fetchMeta();
      return () => {
        isMounted = false;
      };
    }, [url]);
    return /* @__PURE__ */ window.React.createElement(
      "button",
      {
        onClick: () => onPick(url),
        className: "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left hover:bg-white/10 transition-colors"
      },
      thumbnail ? /* @__PURE__ */ window.React.createElement("div", { className: "w-12 h-8 rounded overflow-hidden shrink-0 bg-black/40 border border-white/10 relative flex items-center justify-center" }, /* @__PURE__ */ window.React.createElement("img", { src: thumbnail, alt: "", className: "w-full h-full object-cover" }), /* @__PURE__ */ window.React.createElement("div", { className: "absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity" }, /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-white text-[14px]" }, "play_arrow"))) : /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-primary text-[14px] shrink-0 w-12 text-center" }, "play_circle"),
      /* @__PURE__ */ window.React.createElement("span", { className: "text-xs text-slate-300 truncate", title: title || urlShortLabel(url) }, title || urlShortLabel(url))
    );
  };
  const KoPlayerPopup = ({ onClose, anchorRect }) => {
    const edgePosition = useAppStore((state) => state.edgePosition);
    const design = useAppStore((state) => state.design);
    const glassOpacity = useAppStore((state) => state.glassOpacity);
    const currentMedia = useAppStore((state) => state.currentMedia);
    const screenBounds = useAppStore((state) => state.screenBounds);
    const isSmartPositioning = useAppStore((state) => state.isPopupSmartPositioning);
    const isMac = useAppStore((state) => state.isMac);
    const currentLang = useAppStore((state) => state.language) || "en";
    const t = (key) => {
      const langDict = TRANSLATIONS[currentLang] || TRANSLATIONS["en"];
      return langDict[key] || key;
    };
    const popupRef = react.useRef(null);
    const titleRef = react.useRef(null);
    const artistRef = react.useRef(null);
    const [titleOverflows, setTitleOverflows] = react.useState(false);
    const [artistOverflows, setArtistOverflows] = react.useState(false);
    const [pipActive, setPipActive] = react.useState(false);
    const [pipPhase, setPipPhase] = react.useState("idle");
    const [detectedUrls, setDetectedUrls] = react.useState([]);
    const [manualUrl, setManualUrl] = react.useState("");
    const activeVideoUrls = useAppStore((state) => state.activeVideoUrls);
    const currentMediaSourceApp = useAppStore((state) => state.currentMediaSourceApp);
    const BROWSER_IDS = ["chrome", "msedge", "brave", "firefox", "opera", "vivaldi"];
    const isBrowserSource = BROWSER_IDS.some((b) => currentMediaSourceApp.includes(b));
    const filterValidUrls = (urls) => urls.filter((u) => {
      try {
        const parsed = new URL(u);
        const host = parsed.hostname.toLowerCase();
        if (host === "youtube.com" || host.endsWith(".youtube.com")) {
          return parsed.searchParams.has("v");
        }
        if (host === "youtu.be" || host.endsWith(".youtu.be")) {
          return true;
        }
        return true;
      } catch {
        return false;
      }
    });
    const validActiveUrls = filterValidUrls(activeVideoUrls);
    const hasPreCachedVideo = isBrowserSource && validActiveUrls.length > 0;
    react.useEffect(() => {
      if (titleRef.current) setTitleOverflows(titleRef.current.scrollWidth > titleRef.current.clientWidth);
      if (artistRef.current) setArtistOverflows(artistRef.current.scrollWidth > artistRef.current.clientWidth);
    }, [currentMedia?.title, currentMedia?.artist]);
    react.useEffect(() => {
      const unsub = window.api?.onPipClosed?.(() => {
        setPipActive(false);
        setPipPhase("idle");
      });
      return () => unsub?.();
    }, []);
    const sidebarPosition = useAppStore((state) => state.sidebarPosition);
    const orientation = useAppStore((state) => state.orientation);
    const getPopupStyle = () => {
      if (!anchorRect) return { display: "none" };
      const popupHeight = 290;
      const popupWidth = 288;
      const screenHeight = screenBounds?.height ?? 800;
      const screenWidth = screenBounds?.width ?? 1200;
      const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
      const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;
      const style = {
        position: "absolute",
        zIndex: 99999,
        willChange: "transform, opacity",
        transitionProperty: "opacity, transform, filter"
      };
      const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
      const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;
      if (orientation === "horizontal") {
        let adjustedLeft = anchorRect.left - offsetLeft + anchorRect.width / 2 - popupWidth / 2;
        const maxLeft = screenXInViewport + (screenWidth - offsetLeft) - popupWidth - 20;
        const minLeft = screenXInViewport - offsetLeft + 20;
        if (adjustedLeft < minLeft) adjustedLeft = minLeft;
        if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
        if (!isSmartPositioning) {
          style.left = "50%";
          style.transform = "translateX(-50%)";
        } else {
          style.left = adjustedLeft;
        }
        if (edgePosition === "top") {
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
        if (!isSmartPositioning) {
          style.top = "50%";
          style.transform = "translateY(-50%)";
        } else {
          style.top = adjustedTop;
        }
        if (edgePosition === "left") {
          style.left = "100%";
          style.marginLeft = "12px";
        } else {
          style.right = "100%";
          style.marginRight = "12px";
        }
      }
      return style;
    };
    const isSmartRef = react.useRef(isSmartPositioning);
    react.useEffect(() => {
      isSmartRef.current = isSmartPositioning;
    }, [isSmartPositioning]);
    react.useEffect(() => {
      const onDrag = (e) => {
        if (!popupRef.current || !anchorRect || !isSmartRef.current) return;
        const newX = e.detail.x;
        const newY = e.detail.y;
        const popupHeight = 290;
        const popupWidth = 288;
        const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;
        if (orientation === "horizontal") {
          const screenWidth = screenBounds?.width ?? 1200;
          let adjustedLeft = anchorRect.left - newX + anchorRect.width / 2 - popupWidth / 2;
          const maxLeft = screenXInViewport + (screenWidth - newX) - popupWidth - 20;
          const minLeft = screenXInViewport - newX + 20;
          if (adjustedLeft < minLeft) adjustedLeft = minLeft;
          if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
          popupRef.current.style.left = `${adjustedLeft}px`;
        } else {
          const screenHeight = screenBounds?.height ?? 800;
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
    }, [anchorRect, screenBounds, orientation]);
    const handleCommand = (cmd) => {
      window.api?.sendMediaCommand?.(cmd);
    };
    const handlePipClick = react.useCallback(async () => {
      if (pipActive) {
        window.api?.closePip?.();
        setPipActive(false);
        setPipPhase("idle");
        return;
      }
      if (hasPreCachedVideo) {
        setDetectedUrls(validActiveUrls);
        setPipPhase("manual");
        return;
      }
      setPipPhase("detecting");
      setDetectedUrls([]);
      const urls = await window.api?.getActiveVideoUrls?.().catch(() => []) ?? [];
      setDetectedUrls(filterValidUrls(urls));
      setPipPhase("manual");
    }, [pipActive, currentMedia?.title, currentMedia?.albumArt, hasPreCachedVideo, validActiveUrls]);
    const handlePickUrl = (url) => {
      if (currentMedia?.isPlaying) {
        window.api?.sendMediaCommand?.("pause");
      }
      window.api?.openPip?.(url, currentMedia?.title || t("pipVideo"));
      setPipActive(true);
      setPipPhase("idle");
    };
    const handleManualOpen = () => {
      const url = manualUrl.trim();
      if (!url) return;
      if (currentMedia?.isPlaying) {
        window.api?.sendMediaCommand?.("pause");
      }
      window.api?.openPip?.(url, currentMedia?.title || t("pipVideo"));
      setPipActive(true);
      setPipPhase("idle");
      setManualUrl("");
    };
    const hasMedia = currentMedia && currentMedia.title;
    const getPipBtnClass = () => {
      if (pipActive) return "bg-primary/20 text-primary";
      if (pipPhase === "detecting") return "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20";
      return "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10";
    };
    return /* @__PURE__ */ window.React.createElement(
      "div",
      {
        ref: popupRef,
        className: "w-72 border shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col rounded-xl",
        style: {
          ...getPopupStyle(),
          backgroundColor: design === "style2" ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` : "var(--theme-surface)",
          borderColor: design === "style2" ? "rgba(255, 255, 255, 0.1)" : "var(--theme-border)",
          backdropFilter: design === "style2" ? isMac ? "blur(8px)" : "blur(20px)" : "none",
          WebkitBackdropFilter: design === "style2" ? isMac ? "blur(8px)" : "blur(20px)" : "none"
        }
      },
      hasMedia && currentMedia.albumArt && /* @__PURE__ */ window.React.createElement("div", { className: "absolute inset-0 overflow-hidden rounded-xl", style: { zIndex: 0 } }, /* @__PURE__ */ window.React.createElement(
        "img",
        {
          src: currentMedia.albumArt,
          alt: "",
          className: "w-full h-full object-cover",
          style: { filter: "blur(40px) brightness(0.3) saturate(1.5)", transform: "scale(1.5)" },
          draggable: false
        }
      ), /* @__PURE__ */ window.React.createElement("div", { className: "absolute inset-0 bg-black/40" })),
      /* @__PURE__ */ window.React.createElement("div", { className: "relative flex flex-col", style: { zIndex: 1 } }, /* @__PURE__ */ window.React.createElement("div", { className: "flex justify-between items-center px-4 pt-3 pb-1" }, /* @__PURE__ */ window.React.createElement("div", { className: "flex items-center gap-1.5" }, /* @__PURE__ */ window.React.createElement("div", { className: "relative inline-flex items-center justify-center text-[16px] text-primary", style: { width: "1em", height: "1em" } }, /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined absolute left-1/2 top-1/2", style: { fontSize: "0.85em", transform: "translate(-60%, -60%)", opacity: 0.6 } }, "movie"), /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined absolute left-1/2 top-1/2", style: { fontSize: "0.9em", transform: "translate(-40%, -40%)" } }, "music_note")), /* @__PURE__ */ window.React.createElement("span", { className: "text-[10px] uppercase tracking-wider text-slate-400 font-bold ml-1" }, "KoPlayer")), /* @__PURE__ */ window.React.createElement("div", { className: "flex items-center gap-1.5" }, /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: handlePipClick,
          className: `relative w-6 h-6 rounded-full flex items-center justify-center transition-all no-drag-region ${getPipBtnClass()}`,
          title: pipActive ? t("closePip") : hasPreCachedVideo ? t("videoDetected") : t("openPipTooltip")
        },
        pipPhase === "detecting" ? /* @__PURE__ */ window.React.createElement("div", { style: {
          width: 12,
          height: 12,
          borderRadius: "50%",
          border: "1.5px solid rgba(165,180,252,0.3)",
          borderTop: "1.5px solid #a5b4fc",
          animation: "koplayer-spin 0.7s linear infinite"
        } }) : /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[14px]" }, pipActive ? "pip_exit" : "pip"),
        hasPreCachedVideo && !pipActive && pipPhase !== "detecting" && /* @__PURE__ */ window.React.createElement("span", { style: {
          position: "absolute",
          top: 1,
          right: 1,
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "#4ade80",
          boxShadow: "0 0 4px rgba(74,222,128,0.7)"
        } })
      ), /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: onClose,
          className: "w-6 h-6 rounded-full bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[14px]" }, "close")
      ))), (pipPhase === "manual" || pipPhase === "pick") && /* @__PURE__ */ window.React.createElement(
        "div",
        {
          className: "mx-3 mb-2 rounded-lg overflow-hidden no-drag-region",
          style: { border: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.45)", padding: "10px 12px" }
        },
        detectedUrls.length > 0 && /* @__PURE__ */ window.React.createElement("div", { className: "mb-3" }, /* @__PURE__ */ window.React.createElement("span", { className: "text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 block" }, t("detectedYouTubeTabs")), /* @__PURE__ */ window.React.createElement("div", { style: { maxHeight: 120, overflowY: "auto" }, className: "custom-scrollbar pb-1 -mx-2 px-2" }, detectedUrls.map((url, i) => /* @__PURE__ */ window.React.createElement(DetectedTabItem, { key: i, url, onPick: handlePickUrl })))),
        /* @__PURE__ */ window.React.createElement("p", { className: "text-[10px] text-slate-500 mb-2 leading-snug" }, t("pasteVideoUrl")),
        /* @__PURE__ */ window.React.createElement("div", { className: "flex gap-1.5" }, /* @__PURE__ */ window.React.createElement(
          "input",
          {
            type: "text",
            value: manualUrl,
            onChange: (e) => setManualUrl(e.target.value),
            onKeyDown: (e) => e.key === "Enter" && handleManualOpen(),
            placeholder: "https://youtube.com/watch?v=…",
            className: "flex-1 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 outline-none",
            style: {
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              userSelect: "text",
              WebkitUserSelect: "text"
            },
            autoFocus: true
          }
        ), /* @__PURE__ */ window.React.createElement(
          "button",
          {
            onClick: handleManualOpen,
            disabled: !manualUrl.trim(),
            className: "px-2.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40",
            style: { background: "rgba(244,161,37,0.2)", border: "1px solid rgba(244,161,37,0.4)", color: "#f4a125" }
          },
          t("openBtn")
        )),
        /* @__PURE__ */ window.React.createElement(
          "button",
          {
            onClick: () => setPipPhase("idle"),
            className: "mt-2 text-[10px] text-slate-600 hover:text-slate-400 transition-colors w-full text-center"
          },
          t("cancelBtn")
        )
      ), hasMedia ? /* @__PURE__ */ window.React.createElement(window.React.Fragment, null, /* @__PURE__ */ window.React.createElement("div", { className: "flex flex-col items-center px-5 pt-3 pb-2" }, /* @__PURE__ */ window.React.createElement("div", { className: "w-28 h-28 rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.5)] mb-4 border border-white/10 shrink-0" }, currentMedia.albumArt ? /* @__PURE__ */ window.React.createElement(
        "img",
        {
          src: currentMedia.albumArt,
          alt: currentMedia.title,
          className: "w-full h-full object-cover",
          draggable: false
        }
      ) : /* @__PURE__ */ window.React.createElement("div", { className: "w-full h-full bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center" }, /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-primary text-[40px] opacity-60" }, "album"))), /* @__PURE__ */ window.React.createElement("div", { className: "w-full overflow-hidden relative h-6 flex items-center justify-center" }, /* @__PURE__ */ window.React.createElement(
        "div",
        {
          ref: titleRef,
          className: `text-sm font-semibold text-white whitespace-nowrap ${titleOverflows ? "koplayer-marquee" : "text-center w-full truncate"}`
        },
        titleOverflows ? /* @__PURE__ */ window.React.createElement(window.React.Fragment, null, /* @__PURE__ */ window.React.createElement("span", null, currentMedia.title), /* @__PURE__ */ window.React.createElement("span", { className: "mx-8 text-slate-500" }, "•"), /* @__PURE__ */ window.React.createElement("span", null, currentMedia.title)) : currentMedia.title
      )), /* @__PURE__ */ window.React.createElement("div", { className: "w-full overflow-hidden relative h-5 flex items-center justify-center" }, /* @__PURE__ */ window.React.createElement(
        "div",
        {
          ref: artistRef,
          className: `text-xs text-slate-400 whitespace-nowrap ${artistOverflows ? "koplayer-marquee" : "text-center w-full truncate"}`
        },
        artistOverflows ? /* @__PURE__ */ window.React.createElement(window.React.Fragment, null, /* @__PURE__ */ window.React.createElement("span", null, currentMedia.artist), /* @__PURE__ */ window.React.createElement("span", { className: "mx-8 text-slate-600" }, "•"), /* @__PURE__ */ window.React.createElement("span", null, currentMedia.artist)) : currentMedia.artist || t("unknownArtist")
      ))), /* @__PURE__ */ window.React.createElement("div", { className: "flex items-center justify-center gap-3 px-5 pb-4 pt-2" }, /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: () => handleCommand("prev"),
          className: "w-10 h-10 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 no-drag-region"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[22px]" }, "skip_previous")
      ), /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: () => handleCommand(currentMedia.isPlaying ? "pause" : "play"),
          className: "w-14 h-14 rounded-full bg-primary text-slate-900 flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-[0_4px_20px_rgba(244,161,37,0.4)] hover:shadow-[0_4px_25px_rgba(244,161,37,0.6)] no-drag-region"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[28px]" }, currentMedia.isPlaying ? "pause" : "play_arrow")
      ), /* @__PURE__ */ window.React.createElement(
        "button",
        {
          onClick: () => handleCommand("next"),
          className: "w-10 h-10 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 no-drag-region"
        },
        /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-[22px]" }, "skip_next")
      ))) : /* @__PURE__ */ window.React.createElement("div", { className: "flex flex-col items-center justify-center py-10 px-6" }, /* @__PURE__ */ window.React.createElement("div", { className: "w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4" }, /* @__PURE__ */ window.React.createElement("span", { className: "material-symbols-outlined text-slate-500 text-[32px] koplayer-pulse" }, "music_off")), /* @__PURE__ */ window.React.createElement("p", { className: "text-sm text-slate-400 text-center font-medium" }, t("noMediaPlaying")), /* @__PURE__ */ window.React.createElement("p", { className: "text-xs text-slate-600 text-center mt-1" }, t("playSomething")))),
      /* @__PURE__ */ window.React.createElement("style", null, `
                .koplayer-marquee { display:inline-block; animation:koplayer-scroll 12s linear infinite; }
                @keyframes koplayer-scroll { 0%{transform:translateX(0%)} 100%{transform:translateX(-50%)} }
                .koplayer-pulse { animation:koplayer-icon-pulse 2s ease-in-out infinite; }
                @keyframes koplayer-icon-pulse { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:0.7;transform:scale(1.08)} }
                @keyframes koplayer-spin { to{transform:rotate(360deg)} }
            `)
    );
  };
  if (window.KoBarExtensions && window.KoBarExtensions.registerSidebarButton) {
    window.KoBarExtensions.registerSidebarButton({
      id: "koplayer-plugin-panel",
      icon: "music_note",
      label: "KoPlayer",
      onClick: (e, anchorRect) => {
        const store = window.useAppStore.getState();
        if (store.activeExtensionPanelId === "koplayer-plugin-panel") {
          window.useAppStore.setState({ activeExtensionPanelId: null, activeExtensionAnchorRect: null });
        } else {
          store.closeAllUtilityPopups();
          window.useAppStore.setState({
            activeExtensionPanelId: "koplayer-plugin-panel",
            activeExtensionAnchorRect: anchorRect
          });
        }
      }
    });
  }
  if (window.KoBarExtensions && window.KoBarExtensions.registerPanel) {
    window.KoBarExtensions.registerPanel("koplayer-plugin-panel", {
      id: "koplayer-plugin-panel",
      render: (props) => /* @__PURE__ */ window.React.createElement(KoPlayerPopup, { ...props })
    });
  }
})(window.React);
