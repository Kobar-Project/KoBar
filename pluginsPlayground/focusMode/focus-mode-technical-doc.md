# KoBar Focus Mode - Technical Documentation

## 1. Overview
The **Focus Mode** in KoBar is a Pomodoro-style productivity timer directly integrated into the always-on-top sidebar. It is designed to minimize distractions and help users maintain concentration through structured work sessions and breaks.

This document outlines the technical architecture, state management, UI components, and the lifecycle of the Focus Mode feature.

---

## 2. Core Architecture

The Focus Mode is built upon three main pillars:
1. **Global State Management**: Powered by `Zustand` (`useAppStore.ts`), which holds the timer configuration, remaining time, and active status.
2. **Global Event Loop**: Handled in `App.tsx`, where a `setInterval` tracks time universally regardless of which React components are mounted.
3. **React UI Components**: `FocusButton.tsx` (the trigger and status indicator) and `FocusPopup.tsx` (the configuration panel).
4. **Electron IPC Bridge**: Uses `window.api` for native interactions (fetching audio files, sending desktop notifications).

---

## 3. State Management (`useAppStore.ts`)

The entire state logic resides inside `useAppStore`. This ensures that even if the sidebar is closed or toggled, the timer continues to run without interruption.

### Key State Variables:
- `isFocusPopupOpen` (boolean): Controls the visibility of the popup panel.
- `focusAnchorRect` (object): Coordinates used to correctly align the popup next to the sidebar button.
- `focusSettings` (object): Stores the user's preferred settings: `{ minutes, seconds, melody, loop }`.
- `isFocusActive` (boolean): Flag indicating whether the timer is currently running.
- `focusRemainingTime` (number): The remaining time in seconds.

### Key Methods:
- `startFocusMode()`: Calculates the total seconds from `focusSettings` and sets `isFocusActive` to `true`.
- `stopFocusMode()`: Resets `isFocusActive` to `false` and `focusRemainingTime` to `0`.
- `tickFocusTracker()`: Decrements `focusRemainingTime` by 1. Crucially, when the time hits `1`, it drops to `0` but does **not** immediately set `isFocusActive` to false. This allows the UI components to detect the `0` state while still "active" and trigger alarms.

---

## 4. The Global Timer Loop (`App.tsx`)

The actual passage of time is controlled globally inside the `App.tsx` component using a `useEffect` hook.

```typescript
useEffect(() => {
    let lastTime = useAppStore.getState().focusRemainingTime;
    const interval = setInterval(() => {
        const state = useAppStore.getState();
        const prevTime = lastTime;
        state.tickFocusTracker();
        const currTime = state.focusRemainingTime;
        lastTime = currTime;

        // Trigger notification when timer hits 0
        if (state.isFocusActive && prevTime > 0 && currTime === 0) {
            window.api?.sendNotification?.(
                state.t('focusModeFinished'),
                state.t('focusModeFinishedDesc')
            );
            // Finally stop the focus mode state
            state.stopFocusMode();
        }
    }, 1000);
    return () => clearInterval(interval);
}, []);
```

**Effects:**
1. Calls `tickFocusTracker()` every second.
2. If it detects a transition from `prevTime > 0` to `currTime === 0` while the focus mode is active, it fires a native OS Desktop Notification via the Electron IPC bridge.
3. Once the notification is fired, it gracefully calls `stopFocusMode()`.

---

## 5. UI Components

### 5.1. Focus Button (`FocusButton.tsx`)
This component resides inside the sidebar. It acts as both the toggle for the popup and the visual indicator of the timer.

**Dynamic Rendering:**
- **Idle State:** Displays the default hourglass icon (`hourglass_empty`).
- **Active State:** Hides the icon and displays the remaining time (e.g., `24:59`).
- **Alarm State:** When `isFocusActive` is true and `focusRemainingTime` hits `0`, the button starts pulsing red with an infinite animation (`animate-[pulse_1s_ease-in-out_infinite] bg-red-500/30`).

**Audio Handling:**
The button component itself listens for the `0` state and triggers the alarm melody:
- Fetches the base64 audio payload via `window.api?.getMelodyAudio('Alarm')`.
- Plays the audio on a loop using HTML5 `Audio`.
- If the user clicks the pulsing button, the alarm is stopped (`stopAlarm()`).

### 5.2. Focus Popup (`FocusPopup.tsx`)
This is the configuration panel where users set up their Pomodoro session.

**Features:**
- **Time Inputs:** Custom numeric inputs to set Minutes (0-120) and Seconds (0-59).
- **Melody Selector:** A custom dropdown to choose notification sounds (e.g., *Alarm, Bells, Calming, Cosmic, Guitar, Hiphop, Ringtones*).
- **Audio Preview:** Users can click the play button next to the melody dropdown to preview the selected sound. This also fetches audio from the main process via IPC.
- **Smart Positioning:** Depending on KoBar's orientation (Horizontal or Vertical) and Edge Position (Top, Bottom, Left, Right), the popup calculates its absolute position to stay within screen bounds without overflowing (`isPopupSmartPositioning`).
- **Draggability:** Listens to the `kobar-drag` custom event, allowing users to detach and move the popup around the screen manually.

---

## 6. Localization (i18n)
Focus Mode is fully localized. The translations are fetched from `src/i18n/translations.ts` using the `t()` function from Zustand.

Available keys:
- `focusMode`: "Focus Mode"
- `focusModeFinished`: "Focus Mode Finished"
- `focusModeFinishedDesc`: "Your focus session has ended. Take a break!"
- `minutes`, `seconds`, `start`, `stop`, `loop`.

---

## 7. IPC Dependencies (Electron Main Process)
The feature relies on specific handlers exposed in the `preload.ts` script:
1. `window.api.sendNotification(title: string, body: string)`: Triggers a native system notification.
2. `window.api.getMelodyAudio(melodyName: string)`: Reads audio files from the internal KoBar assets folder and returns them as `base64` strings for the React frontend to play without triggering CORS or local file access restrictions.
