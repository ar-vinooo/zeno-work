"use client";

import { useEffect, useMemo, useState } from "react";

export function isMacPlatform(): boolean {
  const nav = globalThis.navigator;
  if (!nav) return false;
  const typed = nav as Navigator & { userAgentData?: { platform?: string } };
  const platform =
    typed.userAgentData?.platform ?? typed.platform;
  return /mac|iphone|ipad|ipod/i.test(platform ?? "");
}

export function shortcutLabel(keys: string[], mac = isMacPlatform()): string {
  const mapped = keys.map((key) => {
    if (key === "mod") return mac ? "⌘" : "Ctrl";
    if (key === "shift") return mac ? "⇧" : "Shift";
    if (key === "alt") return mac ? "⌥" : "Alt";
    return key;
  });
  return mac ? mapped.join("") : mapped.join("+");
}

export function useShortcutText(): (keys: string[]) => string {
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(isMacPlatform());
  }, []);

  return useMemo(() => (keys: string[]) => shortcutLabel(keys, mac), [mac]);
}
