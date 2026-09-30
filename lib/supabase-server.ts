import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { noStoreFetch } from "./no-store-fetch";

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: noStoreFetch },
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch { /* في Server Components لا يمكن الكتابة — يتولاها middleware */ }
        },
      },
    }
  );
}
