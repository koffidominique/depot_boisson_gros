/**
 * supabase.ts — Client Supabase pour GestDepot.
 *
 * Configuration :
 *  - Côté navigateur : clé `anon` (publique, avec RLS côté serveur)
 *  - Côté serveur (Express) : clé `service_role` (bypass RLS, opérations admin)
 *
 * Les valeurs d'URL et de clés doivent être fournies via variables d'environnement.
 * Copiez .env.example vers .env et renseignez vos valeurs.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Client Supabase côté navigateur (utilisé par le frontend React).
 * Les politiques RLS (Row Level Security) de Supabase filtrent les données
 * selon le rôle de l'utilisateur authentifié.
 */
export const supabase: SupabaseClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : (null as unknown as SupabaseClient);

/**
 * Vérifie si Supabase est configuré (variables d'environnement présentes).
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
