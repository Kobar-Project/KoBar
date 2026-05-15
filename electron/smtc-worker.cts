import { parentPort } from 'worker_threads';

let SMTCMonitor: any = null;
let smtcAvailable = false;

const isWin = process.platform === 'win32';

if (isWin) {
    try {
        const smtcModule = require('@coooookies/windows-smtc-monitor');
        SMTCMonitor = smtcModule.SMTCMonitor;
        smtcAvailable = true;
    } catch (e) {
        smtcAvailable = false;
    }
}

if (parentPort) {
    parentPort.on('message', (msg: any) => {
        if (msg.type === 'poll') {
            let mediaData: any = null;
            if (smtcAvailable && SMTCMonitor) {
                try {
                    const session = SMTCMonitor.getCurrentMediaSession();
                    if (session) {
                        let albumArt = null;
                        if (session.media.thumbnail && session.media.thumbnail.length > 0) {
                            albumArt = `data:image/png;base64,${Buffer.from(session.media.thumbnail).toString('base64')}`;
                        }
                        mediaData = {
                            title: session.media.title || '',
                            artist: session.media.artist || '',
                            albumArt,
                            isPlaying: session.playback.playbackStatus === 4
                        };
                    }
                } catch (e) {
                    // Ignore
                }
            }
            parentPort!.postMessage({ type: 'poll-result', data: mediaData });
        }
    });
}
