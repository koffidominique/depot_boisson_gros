import React, { useCallback } from 'react';
import { Share2 } from 'lucide-react';

/**
 * ShareButton — Utilise l'API Web Share native pour partager un contenu
 * (ticket de vente, bon de livraison, etc.) vers WhatsApp, SMS, email, etc.
 * Très utile pour les livreurs terrain qui doivent transmettre un BL client.
 */
interface ShareButtonProps {
  title: string;
  text: string;
  url?: string;
  label?: string;
  className?: string;
}

export function ShareButton({
  title,
  text,
  url,
  label = 'Partager',
  className,
}: ShareButtonProps): React.ReactElement {
  const handleShare = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.share) {
      // Fallback : copier dans le presse-papier
      const shareText = [title, text, url || window.location.href].filter(Boolean).join('\n');
      try {
        await navigator.clipboard?.writeText(shareText);
      } catch {
        // Ignorer
      }
      return;
    }

    try {
      await navigator.share({
        title,
        text,
        url: url || window.location.href,
      });
    } catch {
      // L'utilisateur a annulé ou une erreur est survenue
    }
  }, [title, text, url]);

  return (
    <button
      type="button"
      onClick={handleShare}
      className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 ${className || ''}`}
    >
      <Share2 className="h-3.5 w-3.5 text-emerald-600" />
      <span>{label}</span>
    </button>
  );
}
