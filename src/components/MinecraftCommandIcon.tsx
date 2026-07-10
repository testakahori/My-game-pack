import React from "react";

type Props = {
  command?: string;
  className?: string;
};

type Kind = "skeleton" | "zombie" | "creeper" | "slime" | "villager" | "cod" | "tnt" | "default";

function commandKind(command = ""): Kind {
  const value = command.toLowerCase();
  if (value.includes("skeleton") || value.includes("スケルトン")) return "skeleton";
  if (value.includes("zombie") || value.includes("ゾンビ")) return "zombie";
  if (value.includes("creeper") || value.includes("クリーパー")) return "creeper";
  if (value.includes("slime") || value.includes("スライム")) return "slime";
  if (value.includes("villager") || value.includes("村人")) return "villager";
  if (value.includes("cod") || value.includes("タラ")) return "cod";
  if (value.includes("tnt")) return "tnt";
  return "default";
}

const MinecraftCommandIcon: React.FC<Props> = ({ command, className = "" }) => {
  const kind = commandKind(command);

  return (
    <svg
      className={`minecraft-command-icon ${className}`.trim()}
      viewBox="0 0 48 48"
      data-command-kind={kind}
      aria-hidden="true"
    >
      {kind === "skeleton" ? (
        <>
          <rect x="12" y="4" width="24" height="22" rx="3" fill="#d9dde0" stroke="#89939a" strokeWidth="2" />
          <path d="M16 10h6v7h-6zm10 0h6v7h-6z" fill="#26323c" />
          <path d="m21 19 3-3 3 3-3 3Z" fill="#4b555c" />
          <path d="M17 24h14v6H17zM20 30h8v13h-8zM10 32h10v4H10zm18 0h10v4H28zM15 40h6v4h-6zm12 0h6v4h-6z" fill="#c7cdd1" stroke="#7f8a91" strokeWidth="1.5" />
          <path d="M20 33h8m-8 4h8" stroke="#58636a" strokeWidth="2" />
        </>
      ) : kind === "zombie" ? (
        <>
          <rect x="8" y="7" width="32" height="28" rx="3" fill="#58a65c" stroke="#286739" strokeWidth="2" />
          <path d="M8 12h12v7H8zm22-5h10v10H30z" fill="#78bd6d" opacity=".7" />
          <rect x="14" y="16" width="7" height="6" fill="#162f29" />
          <rect x="28" y="16" width="7" height="6" fill="#162f29" />
          <path d="M17 28h15" stroke="#2c4b35" strokeWidth="4" />
          <path d="M16 35h16v10H16z" fill="#2d7691" />
        </>
      ) : kind === "creeper" ? (
        <>
          <rect x="7" y="6" width="34" height="34" rx="3" fill="#58b95d" stroke="#257239" strokeWidth="2" />
          <path d="M7 11h10v9H7zm22-5h12v11H29zM18 29h12v11H18z" fill="#79cd67" opacity=".6" />
          <path d="M13 15h8v8h-8zm14 0h8v8h-8zm-9 9h12v6h5v10H13V30h5Z" fill="#123b23" />
        </>
      ) : kind === "slime" ? (
        <>
          <rect x="7" y="9" width="34" height="31" rx="8" fill="#55d86f" stroke="#209a51" strokeWidth="2" />
          <path d="M10 14h28v11H10z" fill="#8df09b" opacity=".55" />
          <rect x="14" y="20" width="6" height="7" rx="2" fill="#164c30" />
          <rect x="28" y="20" width="6" height="7" rx="2" fill="#164c30" />
          <path d="M17 32c5 3 9 3 14 0" fill="none" stroke="#236d43" strokeWidth="3" />
        </>
      ) : kind === "villager" ? (
        <>
          <rect x="10" y="6" width="28" height="34" rx="7" fill="#b9845d" stroke="#70462f" strokeWidth="2" />
          <path d="M10 14h28" stroke="#65402c" strokeWidth="5" />
          <rect x="15" y="18" width="6" height="5" fill="#2a2420" />
          <rect x="28" y="18" width="6" height="5" fill="#2a2420" />
          <path d="m24 20 6 12H18Z" fill="#9a6748" stroke="#70462f" strokeWidth="1.5" />
          <path d="M17 39h14v6H17z" fill="#754f7d" />
        </>
      ) : kind === "cod" ? (
        <>
          <path d="M5 25 15 14l21 3 7 8-7 8-21 2Z" fill="#69b7c9" stroke="#276f86" strokeWidth="2" />
          <path d="m5 25 8-7v14Zm30-8-5 8 5 8" fill="#4192a7" />
          <circle cx="33" cy="22" r="2" fill="#102f3a" />
        </>
      ) : kind === "tnt" ? (
        <>
          <polygon points="24,5 41,14 24,23 7,14" fill="#ff6b5c" />
          <polygon points="7,14 24,23 24,43 7,34" fill="#d43d37" />
          <polygon points="41,14 24,23 24,43 41,34" fill="#a92c2b" />
          <path d="M9 23h15v9H9zm15 0h15v9H24z" fill="#f4e8d3" />
          <text x="11" y="30" fill="#3e302c" fontSize="7" fontWeight="900">TNT</text>
          <text x="26" y="30" fill="#3e302c" fontSize="7" fontWeight="900">TNT</text>
        </>
      ) : (
        <>
          <polygon points="24,5 42,14 24,23 6,14" fill="#65ca59" />
          <polygon points="6,14 24,23 24,43 6,34" fill="#765034" />
          <polygon points="42,14 24,23 24,43 42,34" fill="#563821" />
        </>
      )}
    </svg>
  );
};

export default MinecraftCommandIcon;
