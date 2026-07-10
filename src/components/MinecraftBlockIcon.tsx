import React from "react";

type Props = {
  className?: string;
  variant?: "creeper" | "grass";
};

const MinecraftBlockIcon: React.FC<Props> = ({ className = "", variant = "creeper" }) => (
  <svg className={`minecraft-block-icon ${className}`.trim()} viewBox="0 0 48 48" aria-hidden="true">
    {variant === "grass" ? (
      <>
        <polygon points="24,4 43,14 24,24 5,14" fill="#61cf55" />
        <polygon points="5,14 24,24 24,44 5,34" fill="#755034" />
        <polygon points="43,14 24,24 24,44 43,34" fill="#543720" />
        <path d="m5 14 7 3 4-4 5 4 4-5 6 4 5-5 7 3" fill="none" stroke="#a2eb75" strokeWidth="2" />
        <path d="m9 23 7 4m-5 7 7 4m14-17 7-4m-8 13 8-5" fill="none" stroke="#9b7049" strokeWidth="2" opacity=".75" />
      </>
    ) : (
      <>
        <rect x="6" y="6" width="36" height="36" rx="3" fill="#55b958" stroke="#8ee87a" strokeWidth="2" />
        <path d="M8 8h32v8H8z" fill="#78d56b" opacity=".72" />
        <path d="M34 8h6v32h-6z" fill="#2f7d3d" opacity=".48" />
        <path d="M12 12h7v7h-7zm17 0h7v7h-7z" fill="#70ca63" opacity=".72" />
        <path d="M12 18h8v8h-8zm16 0h8v8h-8zm6 14v8H14v-8h5v-6h10v6Z" fill="#123721" />
        <path d="M19 27h10v7H19z" fill="#123721" />
      </>
    )}
  </svg>
);

export default MinecraftBlockIcon;
