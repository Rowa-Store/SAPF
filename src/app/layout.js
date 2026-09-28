// layout.js — moldura de todas as páginas: cabeçalho, navegação e o CSS global.

import { Inter } from 'next/font/google';
import './globals.css';
import SiteHeader from '@/components/layouts/SiteHeader';

const inter = Inter({ subsets: ['latin'], variable: '--fonte-sans', display: 'swap' });

export const metadata = {
  title: 'SAPF',
  description: 'Protótipo de automação fiscal: pedidos do Shopify viram rascunhos de nota no Tiny.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>
        <div className="envelope">
          <SiteHeader />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
