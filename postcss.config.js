import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import fontSizeOffset from "./scripts/postcss-font-size-offset.cjs";
import FONT_SIZE_OFFSET from "./src/lib/fontSizeOffset.json" with { type: "json" };

export default {
  // 文字の大きさを足すのは Tailwind が text-* を作ったあと（scripts/postcss-font-size-offset.cjs）。
  plugins: [tailwindcss(), fontSizeOffset(FONT_SIZE_OFFSET), autoprefixer()],
};
