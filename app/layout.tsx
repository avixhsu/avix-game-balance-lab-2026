import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AVIX 遊戲數值實驗室',
  description: '以可調式微型遊戲觀察數值如何改變玩家體驗。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
