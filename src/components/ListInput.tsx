import React, { useEffect, useState } from "react";
import { formatListInput, parseListInput, sameList } from "../lib/listInput";

/**
 * カンマ区切りで複数の値を入れる欄。入力中の文字列はそのまま保持し、保存する値だけを一覧にして渡す。
 * 値から毎回文字列を作り直すと、打ったカンマがその場で消えて2件目以降を入力できない。
 */
export default function ListInput({ values, onChange, placeholder }: {
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => formatListInput(values));
  const valuesKey = JSON.stringify(values);
  // 読み込み・復元などで外から値が変わったときだけ書き換える（入力中の文字列と同じ内容なら触らない）。
  useEffect(() => {
    setText(current => (sameList(current, values) ? current : formatListInput(values)));
  }, [valuesKey]);
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(event) => { setText(event.target.value); onChange(parseListInput(event.target.value)); }}
      onBlur={() => setText(formatListInput(parseListInput(text)))}
    />
  );
}
