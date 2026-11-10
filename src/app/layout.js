// layout.js — moldura de todas as páginas: cabeçalho, navegação e o CSS global.

import { Inter } from 'next/font/google';
import './globals.css';
import SiteHeader from '@/components/layouts/SiteHeader';
import { usuarioAtual } from '@/lib/supabase/sessao';

const inter = Inter({ subsets: ['latin'], variable: '--fonte-sans', display: 'swap' });

export const metadata = {
  title: 'Sap',
  description: 'Protótipo de automação fiscal: pedidos do Shopify viram rascunhos de nota no Tiny.',
};

export default async function RootLayout({ children }) {
  const usuario = await usuarioAtual();
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>
        <div className="envelope">
          <SiteHeader usuario={usuario} />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
