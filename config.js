// Samma Supabase-projekt som Packlista och Tor-dash. Nycklarna nedan är
// publika med flit -- anon-nyckeln är avsedd att ligga i klienten, all
// åtkomstkontroll sker med RLS i supabase/migrations/.
//
// Fyndindex fungerar utan de här värdena: utan Supabase blir det en ren
// läsvy av data/snapshot-latest.json, vilket är precis vad du vill under
// lokal utveckling. Inloggningen behövs bara för Mina annonser.
window.FYNDINDEX_CONFIG = {
  SUPABASE_URL: "https://ohwalxqwtxtlldalsclj.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_3QbnisCwm0HdoImcMMu7AA_2zrIevZw",
};
