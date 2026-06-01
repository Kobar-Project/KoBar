(function(react) {
  "use strict";
  const TRANSLATIONS = {
    en: { kobox: "KoBox (Dropzone)", settings: "Settings", cleanupMode: "Cleanup Mode", cleanup24h: "Auto-delete after 24 hours", cleanupQuit: "Delete everything on quit" },
    tr: { kobox: "KoBox (Dropzone)", settings: "Ayarlar", cleanupMode: "Temizleme Modu", cleanup24h: "24 saat sonra otomatik sil", cleanupQuit: "Çıkışta her şeyi sil" }
  };
  const t = (key) => {
    const store = window.useAppStore.getState();
    const lang = store.language || "en";
    const dict = TRANSLATIONS[lang] || TRANSLATIONS["en"];
    return dict[key] || TRANSLATIONS["en"][key] || key;
  };
  let globalCleanupMode = "24h";
  try {
    const saved = localStorage.getItem("kobox-plugin-settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.cleanupMode) {
        globalCleanupMode = parsed.cleanupMode;
      }
    }
  } catch (e) {
  }
  let listeners = /* @__PURE__ */ new Set();
  const notify = () => listeners.forEach((l) => l());
  const usePluginStore = () => {
    const [state, setState] = react.useState({ cleanupMode: globalCleanupMode });
    react.useEffect(() => {
      const listener = () => setState({ cleanupMode: globalCleanupMode });
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []);
    return state;
  };
  const setCleanupMode = (mode) => {
    globalCleanupMode = mode;
    localStorage.setItem("kobox-plugin-settings", JSON.stringify({ cleanupMode: mode }));
    notify();
  };
  const TooltipButton = ({ onClick, onDragOver, onDragLeave, onDrop, className, label, children, style }) => {
    return /* @__PURE__ */ window.React.createElement(
      "button",
      {
        onClick,
        onDragOver,
        onDragLeave,
        onDrop,
        title: label,
        className,
        style
      },
      children
    );
  };
  const KoBoxWidget = () => {
    const [isKoBoxHovered, setIsKoBoxHovered] = react.useState(false);
    react.useEffect(() => {
      window.api?.cleanKoBox?.(globalCleanupMode);
      const handleBeforeUnload = () => {
        if (globalCleanupMode === "quit") {
          window.api?.cleanKoBox?.("quit");
        }
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, []);
    return /* @__PURE__ */ window.React.createElement(
      TooltipButton,
      {
        label: t("kobox"),
        className: `w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${isKoBoxHovered ? "bg-primary/30 text-[var(--theme-primary)] scale-110 shadow-[0_0_15px_rgba(244,161,37,0.4)]" : "bg-white/5 text-slate-400 hover:text-[var(--theme-primary)] hover:bg-white/10 hover:scale-105"}`,
        onClick: () => window.api?.openKoBox?.(),
        onDragOver: (e) => {
          e.preventDefault();
          setIsKoBoxHovered(true);
        },
        onDragLeave: () => setIsKoBoxHovered(false),
        onDrop: (e) => {
          e.preventDefault();
          setIsKoBoxHovered(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const paths = Array.from(e.dataTransfer.files).map((f) => window.api?.getFilePath?.(f) || f.path).filter(Boolean);
            if (paths.length > 0) {
              window.api?.dropToKoBox?.(paths);
            }
          }
        }
      },
      /* @__PURE__ */ window.React.createElement("span", { className: `material-symbols-outlined text-[24px] transition-transform duration-300 ${isKoBoxHovered ? "scale-125 rotate-12" : ""}` }, "inventory_2")
    );
  };
  const SettingsPanelUI = () => {
    const { cleanupMode } = usePluginStore();
    return /* @__PURE__ */ window.React.createElement("div", { className: "flex flex-col gap-4 text-white" }, /* @__PURE__ */ window.React.createElement("h3", { className: "text-lg font-bold border-b border-white/10 pb-2" }, t("kobox"), " ", t("settings")), /* @__PURE__ */ window.React.createElement("div", { className: "flex flex-col gap-2" }, /* @__PURE__ */ window.React.createElement("label", { className: "text-sm text-slate-300" }, t("cleanupMode")), /* @__PURE__ */ window.React.createElement("div", { className: "flex bg-black/40 p-1 rounded-lg border border-white/10" }, /* @__PURE__ */ window.React.createElement(
      "button",
      {
        onClick: () => setCleanupMode("24h"),
        className: `flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${cleanupMode === "24h" ? "bg-[var(--theme-primary)] text-slate-900 shadow-md" : "text-slate-400 hover:text-slate-200"}`
      },
      t("cleanup24h")
    ), /* @__PURE__ */ window.React.createElement(
      "button",
      {
        onClick: () => setCleanupMode("quit"),
        className: `flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${cleanupMode === "quit" ? "bg-[var(--theme-primary)] text-slate-900 shadow-md" : "text-slate-400 hover:text-slate-200"}`
      },
      t("cleanupQuit")
    ))));
  };
  if (window.KoBarExtensions.registerInlineWidget) {
    window.KoBarExtensions.registerInlineWidget("com.kobar.kobox-inline", {
      id: "com.kobar.kobox-inline",
      render: () => window.React.createElement(KoBoxWidget)
    });
  }
  if (window.KoBarExtensions.registerSettingsPanel) {
    window.KoBarExtensions.registerSettingsPanel("com.kobar.kobox", {
      id: "com.kobar.kobox",
      render: () => window.React.createElement(SettingsPanelUI)
    });
  }
})(window.React);
