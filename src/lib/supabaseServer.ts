/**
 * supabaseServer.ts — Client Supabase côté serveur (Express).
 *
 * Utilise la clé `service_role` qui contourne le RLS (Row Level Security).
 * À utiliser UNIQUEMENT côté serveur, jamais exposé au navigateur.
 *
 * Variable d'environnement requise : SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Client Supabase côté serveur avec privilèges service_role.
 * Permet toutes les opérations (CRUD) sur toutes les tables sans filtrage RLS.
 */
export const supabaseAdmin: SupabaseClient =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : (null as unknown as SupabaseClient);

/**
 * Vérifie si le client admin est configuré.
 */
export function isSupabaseAdminConfigured(): boolean {
  return Boolean(supabaseUrl && serviceRoleKey);
}
