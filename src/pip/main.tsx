// PiP window entry (ARC-22). Renders only the PiP player: no app store, no persist, no
// localStorage isolation, no extension registry, so this window never writes `kobar-storage`.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/space-grotesk';
import 'material-symbols/outlined.css';
import PipPlayer from '../components/layout/PipPlayer.tsx';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PipPlayer />
    </StrictMode>
);
