import React, { useEffect, useState } from "react";
import { formatListInput, listInputOnBlur, parseListInput, sameList } from "../lib/listInput";

/**
 * カンマ区切りで複数の値を入れる欄。入力中の文字列はそのまま保持し、保存する値だけを一覧にして渡す。
 * 値から毎回文字列を作り直すと、打ったカンマがその場で消えて2件目以降を入力できない。
 * separators は区切りに使う文字（1文字ずつ）。省略時は半角カンマ・読点・全角カンマ。
 */
export default function ListInput({ values, onChange, placeholder, separators }: {
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  separators?: string;
}) {
  const [text, setText] = useState(() => formatListInput(values));
  const valuesKey = JSON.stringify(values);
  // 読み込み・復元などで外から値が変わったときだけ書き換える（入力中の文字列と同じ内容なら触らない）。
  useEffect(() => {
    setText(current => (sameList(current, values, separators) ? current : formatListInput(values)));
  }, [valuesKey, separators]);
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(event) => { setText(event.target.value); onChange(parseListInput(event.target.value, separators)); }}
      onBlur={() => {
        const next = listInputOnBlur(text, values, separators);
        setText(next.text);
        if (next.values) onChange(next.values);
      }}
    />
  );
}
