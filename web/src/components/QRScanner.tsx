import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { DecodeHintType, Result, BarcodeFormat } from '@zxing/library';

interface QRScannerProps {
  active: boolean;
  onResult: (text: string) => void;
  onError?: (error: Error) => void;
}

const hints = new Map<DecodeHintType, unknown>();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);

export function QRScanner({ active, onResult, onError }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      BrowserMultiFormatReader.releaseAllStreams();
      return;
    }

    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 500 });

    const start = async () => {
      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoElement,
          (result: Result | undefined, err) => {
            if (result) {
              onResult(result.getText());
            }
            if (err && 'message' in err) {
              const error = err as Error;
              setPermissionError((prev) => {
                if (prev) {
                  return prev;
                }
                onError?.(error);
                return error.message;
              });
            }
          }
        );
        controlsRef.current = controls;
        setPermissionError(null);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setPermissionError(err.message);
        onError?.(err);
      }
    };

    start();

    return () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
      BrowserMultiFormatReader.releaseAllStreams();
    };
  }, [active, onResult, onError]);

  return (
    <div className={`qr-scanner${active ? '' : ' inactive'}`}>
      <video ref={videoRef} autoPlay playsInline muted />
      {!active ? <div className="qr-scanner-overlay">Skener je vypnutý</div> : null}
      {permissionError ? <p className="qr-error">{permissionError}</p> : null}
    </div>
  );
}

export default QRScanner;
