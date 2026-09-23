import type { Metadata } from "next";
import "../styles/global.css";
import "../styles/presentation.css";

export const metadata: Metadata = {
  title: "Career Quest — развитие сотрудников",
  description: "Карьерные цели, навыки и обучение сотрудников",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
