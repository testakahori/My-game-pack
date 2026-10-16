// src/components/ToggleSlider.tsx
import React from "react";

interface ToggleSliderProps {
  label: string;
  checked: boolean;
  onChange: () => void;
}

export function ToggleSlider({ label, checked, onChange }: ToggleSliderProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onChange}
      className={`toggle-slider relative inline-flex h-7 w-[4.5rem] flex-shrink-0 cursor-pointer rounded-full border p-0.5 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
        checked
          ? "bg-emerald-600 border-emerald-500"
          : "bg-gray-700 border-gray-600"
      }`}
    >
      {/* 有効・無効を表示するつまみ */}
      <span
        className={`absolute top-0.5 flex h-[calc(100%-4px)] w-[calc(50%-2px)] items-center justify-center rounded-full bg-white shadow-md text-[11px] font-bold transition-all duration-300 ease-in-out ${
          checked ? "left-[calc(50%+1px)] text-emerald-700" : "left-0.5 text-gray-500"
        }`}
      >
        {checked ? "有効" : "無効"}
      </span>
    </button>
  );
}
