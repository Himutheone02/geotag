"use client";

import { useEffect, useRef, useState } from "react";
import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";
import type { Country } from "@/utils/fuzzyMatch";
import ProfilePanel from "./ProfilePanel";

/** How long the closing spring plays before the dialog unmounts. Matches .profile-dialog--closing. */
export const PROFILE_EXIT_MS = 220;

type ProfileDialogProps = {
  countries: Country[];
  onClose: () => void;
};

/**
 * "Profile & Stats", opened from the header: the profile panel in a native modal
 * <dialog> (top layer, focus kept inside, Escape closes it, focus returns to the header
 * button). Same pattern as the QR modal.
 */
export default function ProfileDialog({ countries, onClose }: ProfileDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      ref.current?.close(); // while still in the page, so focus goes back to the header button
      onClose();
    }, PROFILE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  const close = () => setClosing(true);

  return (
    <dialog
      ref={ref}
      className={closing ? "profile-dialog profile-dialog--closing" : "profile-dialog"}
      aria-labelledby="profile-heading"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <ClayCard as="section" className="profile-modal">
        <div className="profile-modal__bar">
          <ClayButton variant="soft" size="sm" onClick={close} autoFocus>
            Close
          </ClayButton>
        </div>
        <ProfilePanel headingId="profile-heading" countries={countries} />
      </ClayCard>
    </dialog>
  );
}
