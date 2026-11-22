// Relectures qui se croisent : une réponse plus ancienne que celle affichée est ignorée. Pas « la dernière demandée
// seulement » : qui attend une relecture pour naviguer doit trouver sa réponse affichée, même si une autre est partie.
export function newestResponse(): () => () => boolean {
  let sent = 0;
  let shown = 0;
  return () => {
    const n = ++sent;
    return () => {
      if (n < shown) return false;
      shown = n;
      return true;
    };
  };
}
