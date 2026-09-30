import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '../../lib/hx';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Push-to-talk dictation: records with MediaRecorder and transcribes through
 * Hermes (`/api/audio/transcribe`, the profile's own STT provider).
 * Microphone access needs a secure context (https or localhost).
 */
export function useVoiceInput(onTranscript: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const supported =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType === '' ? undefined : { mimeType });
      chunksRef.current = [];
      cancelledRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        cleanup();
        if (cancelledRef.current || chunksRef.current.length === 0) {
          setState('idle');
          return;
        }
        setState('transcribing');
        const blob = new Blob(chunksRef.current, { type });
        void blobToDataUrl(blob)
          .then((dataUrl) => transcribeAudio(dataUrl, type))
          .then((result) => {
            if (result.transcript.trim() !== '') onTranscript(result.transcript.trim());
            else onError('No speech detected.');
          })
          .catch((error: unknown) =>
            onError(error instanceof Error ? error.message : 'Transcription failed. Check the STT settings in Hermes.'),
          )
          .finally(() => setState('idle'));
      };
      recorderRef.current = recorder;
      recorder.start();
      setElapsed(0);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
      setState('recording');
    } catch (error) {
      cleanup();
      setState('idle');
      onError(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone permission was denied.'
          : 'Could not start the microphone.',
      );
    }
  }, [state, cleanup, onTranscript, onError]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  return { supported, state, elapsed, start, stop, cancel };
}
