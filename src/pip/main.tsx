// PiP window entry (ARC-22). Renders only the PiP player: no app store, no persist, no
// localStorage isolation, no extension registry, so this window never writes `kobar-storage`.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/space-grotesk';
import 'material-symbols/outlined.css';
import PipPlayer from '../components/layout/PipPlayer.tsx';
import { setDocumentPlatform } from '../platform';
import { parsePipPlatform } from './params';

// MAC-022: <html data-platform> from the query main appends to pip.html, before the first render.
setDocumentPlatform(parsePipPlatform(window.location.search));

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PipPlayer />
    </StrictMode>
);
