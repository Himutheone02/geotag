"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";

/** How long the closing spring plays before the modal unmounts. Matches .qr-dialog--closing. */
export const QR_EXIT_MS = 220;

/** Hosts another phone can't reach: a QR code pointing at them can't be opened elsewhere. */
export function isLocalOnly(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || hostname === "0.0.0.0" || /^127\./.test(hostname);
}

type QrShareModalProps = {
  /** The full challenge link, e.g. https://example.com/?route=FRA-CHN. */
  url: string;
  /** "France to China", shown above the code. */
  routeName: string;
  onClose: () => void;
};

/**
 * "Share via QR": the challenge link as a QR code, for another phone's camera.
 *
 * A native <dialog> opened with showModal(): it sits in the browser's top layer,
 * fixed to the center of the screen however far the page is scrolled, keeps focus
 * inside, closes on Escape, and hands focus back to "Share via QR" when it closes.
 *
 * The code is one SVG <path> (qrcode.react's QRCodeSVG), drawn once and never animated.
 * This module is loaded on demand, so the QR library costs nothing until it's needed.
 */
export default function QrShareModal({ url, routeName, onClose }: QrShareModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const localOnly = isLocalOnly(new URL(url).hostname);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close(); // e.g. a new round unmounts it mid-way
    };
  }, []);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      // Close while still in the page: that's what hands focus back to "Share via QR".
      // (Removing an open dialog from the page drops focus on the body.)
      ref.current?.close();
      onClose();
    }, QR_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  const close = () => setClosing(true);

  return (
    <dialog
      ref={ref}
      className={closing ? "qr-dialog qr-dialog--closing" : "qr-dialog"}
      aria-labelledby="qr-heading"
      // Escape: play the closing spring instead of vanishing.
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      // A click on the dimmed backdrop lands on the <dialog> itself.
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <ClayCard as="section" className="qr-modal">
        <h2 id="qr-heading" className="card-title">
          Scan to play this route
        </h2>
        <p className="card-lead">{routeName}. Point another phone&apos;s camera at the code.</p>
        {/* The code sits flat and white, pressed into a well in the card. */}
        <div className="qr-well">
          <div className="qr-face">
            <QRCodeSVG
              value={url}
              size={208}
              level="M"
              marginSize={2}
              fgColor="#2d2a4a"
              bgColor="#ffffff"
              title={`QR code for ${url}`}
              className="qr-code"
            />
          </div>
        </div>
        <p className="qr-url">{url}</p>
        {localOnly && (
          <p className="qr-warning" role="note">
            This code points at {new URL(url).host}, which only this computer can open. To share with another phone,
            open the game from your deployed site, or from this computer&apos;s network address.
          </p>
        )}
        <ClayButton className="qr-close" onClick={close} autoFocus>
          Close
        </ClayButton>
      </ClayCard>
    </dialog>
  );
}
