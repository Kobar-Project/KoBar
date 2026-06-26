import { useState, useEffect, useCallback, useRef } from 'react';
import type { LanguageCode } from '../i18n/translations';

// Map KoBar language codes to BCP 47 language tags
const languageMap: Record<LanguageCode, string> = {
    de: 'de-DE',
    ar: 'ar-SA',
    zh: 'zh-CN',
    fr: 'fr-FR',
    hi: 'hi-IN',
    en: 'en-US',
    es: 'es-ES',
    ja: 'ja-JP',
    ru: 'ru-RU',
    tr: 'tr-TR',
};

interface UseSpeechToTextProps {
    onTranscript: (text: string) => void;
    language: LanguageCode;
}

export const useSpeechToText = ({ onTranscript, language }: UseSpeechToTextProps) => {
    const isSupported = !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(isSupported ? null : 'Speech recognition not supported');
    const recognitionRef = useRef<any>(null);
    
    // Store callback in a ref to avoid effect re-runs when onTranscript changes
    const onTranscriptRef = useRef(onTranscript);
    useEffect(() => {
        onTranscriptRef.current = onTranscript;
    }, [onTranscript]);

    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            return;
        }

        const recognition = new SpeechRecognition();
        // Use continuous mode so it doesn't stop after every sentence
        recognition.continuous = true; 
        recognition.interimResults = false;
        recognition.lang = languageMap[language] || 'en-US';

        recognition.onstart = () => {
            console.log('Speech recognition started');
            setIsListening(true);
            setError(null);
        };

        recognition.onresult = (event: any) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    transcript += event.results[i][0].transcript;
                }
            }
            if (transcript) {
                console.log('Transcript received:', transcript);
                onTranscriptRef.current(transcript);
            }
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error event:', event);
            console.error('Error code:', event.error);
            // Ignore 'no-speech' error as it's common in continuous mode
            if (event.error !== 'no-speech') {
                setError(`${event.error}${event.message ? ': ' + event.message : ''}`);
                setIsListening(false);
            }
        };

        recognition.onend = () => {
            console.log('Speech recognition ended');
            setIsListening(false);
        };

        recognitionRef.current = recognition;

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
        };
    }, [language]); // Only recreate when language changes

    const toggleListening = useCallback(() => {
        if (!recognitionRef.current) return;

        if (isListening) {
            recognitionRef.current.stop();
        } else {
            try {
                recognitionRef.current.start();
            } catch (err) {
                console.error('Failed to start speech recognition:', err);
                setIsListening(false);
            }
        }
    }, [isListening]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current && isListening) {
            recognitionRef.current.stop();
        }
    }, [isListening]);

    return {
        isListening,
        toggleListening,
        stopListening,
        error,
        isSupported: !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    };
};
