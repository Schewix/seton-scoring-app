import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, DecodeHintType, Result, BarcodeFormat } from '@zxing/library';

interface QRScannerProps {
  active: boolean;
  onResult: (text: string) => void;
  onError?: (error: Error) => void;
}

const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);

export function QRScanner({ active, onResult, onError }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      readerRef.current?.reset();
      return;
    }

    if (!videoRef.current) return;

    const reader = new BrowserMultiFormatReader(hints, 500);
    readerRef.current = reader;

    const start = async () => {
      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result: Result | undefined, err) => {
            if (result) {
              onResult(result.getText());
            }
            if (err && err.message && !permissionError) {
              setPermissionError(err.message);
              onError?.(err);
            }
          }
        );
        controlsRef.current = controls;
        setPermissionError(null);
      } catch (error) {
        const err = error as Error;
        setPermissionError(err.message);
        onError?.(err);
      }
    };

    start();

    return () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
      reader.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="qr-scanner">
      <video ref={videoRef} autoPlay playsInline muted />
      {permissionError ? <p className="qr-error">{permissionError}</p> : null}
    </div>
  );
}

export default QRScanner;
