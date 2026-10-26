import type { HTMLAttributes, ReactNode } from "react";

type ClayCardProps = HTMLAttributes<HTMLElement> & {
  /** Semantic element to render. Defaults to a plain div. */
  as?: "div" | "section" | "article" | "aside";
  children?: ReactNode;
};

/** Extruded clay container: organic radius, layered outer + inset shadows. */
export default function ClayCard({ as: Tag = "div", className, children, ...rest }: ClayCardProps) {
  return (
    <Tag className={["clay-card", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </Tag>
  );
}
