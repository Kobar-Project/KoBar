# KoCalendar Technical Documentation

## 1. Overview
**KoCalendar** is an interactive, draggable calendar popup integrated natively into the KoBar environment. It allows users to view, manage, and schedule local events, synchronize with KoBar's internal ToDo system to track deadlines, and import bulk events via JSON. The calendar is designed with a heavy focus on quick accessibility, featuring smart screen-boundary positioning and cross-platform UI adaptations (Windows & macOS).

## 2. Architecture & State Management

KoCalendar heavily relies on **Zustand** (`src/store/useAppStore.ts`) for centralized state management, keeping the UI decoupled from business logic and ensuring data persistence.

### Core Data Models
- **`localEvents`**: An array of `CalendarEvent` objects. Each event stores:
  - `id`: Unique identifier.
  - `title`, `description`: Textual information.
  - `startTime`, `endTime`: ISO-8601 formatted date-time strings.
  - `colorId`: The distinct color tag assigned to the event.
  - `meetingLink`: Optional URL to open video conferencing platforms.
  - `notificationEnabled`: Boolean flag for triggering desktop notifications.
  - `notificationMinutes`: Integer representing notification threshold.

### Associated States
- **`koCalendarAnchorRect`**: A DOMRect object used to determine where the popup should logically emerge from (e.g., a sidebar button).
- **`activeExtensionPanelId`**: Managed via Zustand to strictly control the mount/unmount lifecycle of the plugin. Clicking the KoCalendar button safely toggles this state (`null` if open, `'ko-calender-plugin-panel'` if closed) to prevent duplication or unclosable panels.
- **`todos`**: Accessed to cross-reference tasks that have a `dueDate`, visualizing them dynamically in the calendar grid alongside normal events.
- **Theme Variables**: Reads `design`, `glassOpacity`, and `koCalendarColor` to adjust the visual appearance dynamically.

## 3. Core Component: `KoCalendarPopup.tsx`

Located at `src/components/calendar/KoCalendarPopup.tsx`, this component handles rendering the grid, processing logic, and managing local interactions.

### 3.1. Smart Positioning Engine
Because KoBar operates as an always-on-top vertical/horizontal sidebar, the popup needs intelligent boundary-awareness.
- **Dynamic Offset:** The `getPopupStyle()` function reads `orientation` (horizontal/vertical) and `edgePosition` (top, bottom, left, right).
- **Screen Boundary Prevention:** It measures `screenBounds` and dynamically calculates `adjustedLeft` and `adjustedTop` coordinates to ensure the calendar never overflows outside the visible viewport.
- **Glassmorphism:** Leverages conditional OS checks (`isMac`) to apply native Electron blur effects vs. standard CSS `backdrop-filter`.

### 3.2. Drag Mechanism
The component listens for the global `kobar-drag` custom event. As the user drags the popup's top handle, it actively recalibrates coordinates in real-time, respecting the previously mentioned viewport constraints.

## 4. Key Features & Functionality

### 4.1. Interactive Month & Year Picker (Fast Navigation)
To provide rapid navigation across long periods without excessive clicking, the calendar features a custom Month & Year Picker overlay.
- Clicking the Month/Year header triggers an elegant `fade-in`/`zoom-in` animation, hiding the main grid and displaying the picker.
- Users can instantly jump to any year using a direct number input or quick-step chevron arrows.
- A 3-column month selection grid allows instantaneous jumping to specific months.
- Returning to the grid seamlessly updates the global `currentDate` and recalculates the layout.

### 4.2. Flicker-Free Grid Rendering
The calendar grid utilizes the `date-fns` library (`startOfMonth`, `endOfMonth`, `eachDayOfInterval`) to generate an accurate matrix of days.
- **Static 42-Day Layout:** To prevent vertical "flickering" or unwanted layout shifts when switching between months (e.g., from a 4-week month to a 6-week month), the grid forcefully renders exactly 42 slots (6 full weeks) at all times.
- **Dimmed Past/Future Days:** Days outside the current month are visually faded.
- **Visual Indicators:**
  - **Events:** Rendered as miniature colored bars below the date number.
  - **ToDos:** Indicated using an explicit primary-colored divider, indicating a task deadline.

### 4.2. Interactive Agenda View
Clicking on any specific day reveals a time-sorted Agenda view at the bottom half of the popup. 
- It filters `localEvents` matching the selected date.
- Renders the `title`, `description`, and specific time slot.
- Exposes direct Quick Actions (e.g., clicking the "Camera" icon uses the IPC bridge to open the associated `meetingLink`).

### 4.3. Event Management (CRUD)
Double-clicking a day or clicking the "+" icon opens the inline Add/Edit form.
- Users can specify custom hours, minutes, labels, and colors.
- Toggling the "Alert On" bell updates the `notificationEnabled` state.
- Form submissions invoke `addCalendarEvent` or `updateCalendarEvent` in the Zustand store.

### 4.4. JSON Bulk Import Engine
Users can click the bulk-import icon to inject `JSON` files containing arrays of holidays or external events.
- The `FileReader` processes the `.json` asynchronously.
- The system checks for duplicates based on exact `title` and `startTime` combinations.
- Valid, non-duplicate entries are bulk-pushed into `localEvents`.

## 5. Electron IPC Integration (Desktop Native Layer)
To ensure KoCalendar behaves like a native desktop widget rather than just a web component, it leverages KoBar's strict IPC bridge:
- **`window.api.openExternal(link)`**: Triggered directly from the Agenda view to open meeting URLs securely in the user's default native web browser.
- **Desktop Notifications**: Background routines read `localEvents` that have `notificationEnabled: true` to fire OS-level alerts (Windows Action Center or macOS Notification Center) when the timer conditions are met.
