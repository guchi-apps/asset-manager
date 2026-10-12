"use client";

import { useEffect, useState } from "react";

// サーバーではテーマが確定しないため、マウント前は常にライト側の色として扱い、
// ハイドレーション時の DOM 不一致（SSR/CSR での色の食い違い）を防ぐ。
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(query.matches);

    const handleChange = (event: MediaQueryListEvent) => setIsDark(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return isDark;
}
