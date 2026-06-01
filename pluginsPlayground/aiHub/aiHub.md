# KoBar AI Hub - Technical Documentation

## 1. Overview
The **AI Hub** is a deeply integrated, multi-model artificial intelligence assistant within the KoBar ecosystem. Designed for zero-friction access, it resides alongside the main sidebar and allows users to seamlessly switch between cloud-based models (e.g., Anthropic Claude, OpenAI, Gemini) and offline local models (e.g., Ollama, LM Studio). 

Unlike standard chat interfaces, the AI Hub is fully aware of the desktop context, featuring direct integration with KoBar's Clipboard Manager, drag-and-drop file parsing, and dynamic edge-based smart positioning.

## 2. Core Features & Capabilities

### 2.1. Multi-Model Flexibility
- **Cloud Models**: Native support for Anthropic (Claude 3.5 Sonnet, Haiku, Opus), OpenAI, and Gemini.
- **Local/Offline Models**: Supports local inference engines like Ollama and LM Studio (e.g., Llama 3, LLaVA for vision tasks).
- **Dynamic Switching**: Users can change the active model on the fly per chat session via the top header dropdown.

### 2.2. Chat Session Management
- **Persistent History**: Chat sessions are saved locally across app restarts.
- **Auto-Titling**: The first user message automatically generates a concise title for the chat. Users can also double-click to manually rename titles.
- **CRUD Operations**: Users can create, delete, and switch between multiple chat threads instantly from the expandable left sidebar.

### 2.3. Context & Multimodality
- **Drag-and-Drop Parsing**: Users can drag text documents or images directly into the chat interface. The system extracts the text content or base64 image data and appends it to the LLM's context window.
- **Context Optimization**: To prevent token overflow, only the current prompt's images are sent in full multimodal format; older images in the history are gracefully replaced with a placeholder string `[Image attached previously]`.

### 2.4. KoBar Ecosystem Integration
- **Send to Slot**: An exclusive feature allowing users to send specific AI responses directly to KoBar's Clipboard Manager slots with a single click (using `forceAddClipboardItem`).
- **Quick Copy**: One-click copy functionality for individual messages or specific code blocks.

### 2.5. Rich UI & UX
- **Markdown & Syntax Highlighting**: Messages are parsed using `react-markdown` and `remark-gfm`. Code blocks are rendered with `react-syntax-highlighter` (vscDarkPlus theme), featuring dedicated copy buttons.
- **Smart Positioning**: The popup calculates its position dynamically based on KoBar's orientation (horizontal/vertical), edge positioning, and screen bounds, preventing it from clipping off-screen.
- **Resizable Interface**: Includes edge and corner `ResizerHandle` components, allowing fluid resizing of the AI Hub window.
- **Auto-Scroll**: Automatically scrolls to the bottom during message generation, but smartly pauses if the user scrolls up to read past messages.

## 3. Technical Architecture

### 3.1. Frontend Component (`AiHubPopup.tsx`)
The primary UI is a React Functional Component rendered as an absolute, draggable overlay.
- **Styling**: Tailored with Tailwind CSS, utilizing CSS Backdrop Filters (`blur`) to achieve a glassmorphism effect (adjusting blur intensity based on OS - Windows vs. macOS).
- **Interactions**: Uses custom drag events (`kobar-drag`) to allow moving the popup independently of the main sidebar. It communicates with the backend to disable mouse-through when hovered (`setIgnoreMouseEvents(false)`).

### 3.2. State Management (Zustand)
State is segregated logically using Zustand stores:
- **`useChatStore.ts`**: Manages all chat-related data. It utilizes Zustand's `persist` middleware to save the state (`kobar-chat-storage`) to `localStorage`.
  - **State**: `chats` (array of sessions), `activeChatId`, `apiKeys`, `aiAvatar`, `userAvatar`.
  - **Mutations**: `createChat`, `addMessage`, `appendStreamToMessage`, `updateChatTitle`.
- **`useAppStore.ts`**: Manages global UI states, including the AI Hub's visibility (`isAiHubOpen`), anchor coordinates (`aiHubAnchorRect`), dimensions, and user design preferences.
- **`useClipboardStore.ts`**: Invoked specifically for the "Send to Slot" action.

### 3.3. Inter-Process Communication (IPC) & Backend
All heavy lifting, file parsing, and API network requests are offloaded to the Electron Main Process (`main.cts`) to ensure the React UI thread remains unblocked and secure (Context Isolation).

**IPC Methods exposed via `preload.cts` (`window.api`)**:
- `parseFile(filePath)`: Reads dropped files and returns parsed text or image data.
- `llmRequest(data)`: Initiates the network request to the selected LLM provider.
- `cancelLlmRequest(messageId)`: Sends an abort signal to terminate an ongoing stream.

**Streaming Architecture**:
Instead of waiting for the full response, KoBar uses a continuous event stream architecture:
1. Frontend calls `llmRequest()`.
2. Backend streams chunks via `window.webContents.send('llm-stream-chunk', data)`.
3. Frontend listens via `onLlmStreamChunk` and appends the text sequentially to the message object.
4. Completes with `onLlmStreamEnd` or handles failures via `onLlmStreamError`.

## 4. Data Structures

**ChatMessage Interface**
```typescript
export interface ChatMessage {
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: string;
    attachments?: string[]; // Contains raw text or data URIs for images
}
```

**Chat API Keys Interface**
```typescript
export interface ChatApiKeys {
    openai: string;
    gemini: string;
    anthropic: string;
    localUrl: string; // Defaults to http://localhost:11434 (Ollama)
    systemMessage: string;
    customInstructions: string;
    defaultModel: string;
}
```

## 5. Security & Isolation
- **No Direct Network Calls**: The React frontend never makes HTTP requests directly to OpenAI/Anthropic. All requests are routed through the Electron Main process, protecting API keys from exposure in the renderer process.
- **Context Isolation**: The `ipcRenderer` is completely abstracted behind `contextBridge.exposeInMainWorld`, meaning the frontend can only invoke strict, pre-defined functions.

## 6. Conclusion
The KoBar AI Hub represents a robust implementation of a local-first, multi-model AI assistant. By leveraging Electron's IPC for asynchronous streaming and file handling, paired with Zustand's persistent storage and React's reactive UI, it provides a powerful, contextual, and highly responsive AI experience natively integrated into the user's desktop environment.
