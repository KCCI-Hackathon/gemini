import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 시안과 같은 Noto Sans KR 을 서버에서 한 번 불러온다
const noto = Noto_Sans_KR({ weight: ["400", "500", "700", "800"], subsets: ["latin"], display: "swap", variable: "--font-noto" });

export const metadata: Metadata = {
  title: "PathFinder",
  description: "취업·수료·창업이라는 갈림길에서 달라지는 청년 정책 자격을 공식 공고 근거로 보여주는 서비스",
  icons: { icon: "/pathfinder/robot-face.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={noto.variable}>
      <body>{children}</body>
    </html>
  );
}
