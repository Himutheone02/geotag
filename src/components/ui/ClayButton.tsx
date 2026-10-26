import type { ComponentProps } from "react";

type ClayButtonProps = ComponentProps<"button"> & {
  /** primary: sea-blue call to action. soft: surface-colored (or continent-tinted via data-region). */
  variant?: "primary" | "soft";
  size?: "md" | "sm";
};

/** Pillowy button: lifts on hover, sinks into the surface when pressed (spring-driven). */
export default function ClayButton({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...rest
}: ClayButtonProps) {
  return (
    <button
      type={type}
      className={["clay-button", `clay-button--${variant}`, size === "sm" && "clay-button--sm", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
