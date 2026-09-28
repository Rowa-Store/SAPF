'use client';

import { useEffect, useState } from 'react';

/** Consulta /api/saude — status das três integrações (Shopify, Tiny, Supabase). */
export function useSaude() {
  const [saude, setSaude] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    fetch('/api/saude')
      .then((r) => r.json())
      .then(setSaude)
      .catch((e) => setErro(e.message));
  }, []);

  return { saude, erro };
}
