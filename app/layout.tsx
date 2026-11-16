import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "갈림길",
  description: "취업·수료·창업이라는 갈림길에서 달라지는 청년 정책 자격을 공식 공고 근거로 보여주는 서비스",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
