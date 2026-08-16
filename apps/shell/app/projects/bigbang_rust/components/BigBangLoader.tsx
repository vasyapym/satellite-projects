"use client";

import dynamic from "next/dynamic";

const BigBang = dynamic(
  () => import("./BigBang").then((m) => m.BigBang),
  { ssr: false }
);

export function BigBangLoader() {
  return <BigBang />;
}
